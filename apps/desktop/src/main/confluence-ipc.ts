import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IpcMainInvokeEvent } from "electron";
import { app, dialog, ipcMain, net, shell } from "electron";
import type {
	ConfluenceAccount,
	ConfluencePublished,
	ConfluenceSaveResult,
	ConfluenceUpload,
	ImageFile,
	RemotePage,
} from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import { markdownToStorage } from "../shared/confluence.js";
import { describeAtom, jiraUrl } from "../shared/confluence-atoms.js";
import { fileUrl } from "../shared/confluence-common.js";
import type { JiraServer } from "../shared/confluence-insert.js";
import { publishPlan } from "../shared/confluence-publish.js";
import { parseSearchRequest } from "../shared/confluence-search.js";
import { diagramDataName } from "../shared/diagram.js";
import type { Strings } from "../shared/i18n.js";
import { format, lossLabel } from "../shared/i18n.js";
import { fileNameKey, IMAGE_EXTENSIONS, parseDataUrl } from "../shared/images.js";
import {
	freeName,
	isRunnable,
	localFileName,
	MAX_UPLOAD_MB,
	mediaTypeOf,
} from "./confluence-attachments.js";
import type { ConfluenceCredentials, Fetch } from "./confluence-client.js";
import { ConfluenceClient, ConfluenceError } from "./confluence-client.js";
import type { ConfluenceStore } from "./confluence-store.js";
import { checkDiagramBytes, checkDiagramData, diagramFileName } from "./diagram-files.js";
import type { DraftStore } from "./drafts.js";
import type { JiraClient } from "./jira-client.js";
import type { AppWindow, DocumentTab, WindowManager } from "./windows.js";
import { errorMessage } from "./windows.js";

export interface ConfluenceIpcContext {
	readonly windows: WindowManager;
	readonly drafts: DraftStore;
	readonly confluence: ConfluenceStore;
	/** The connected Jira, for a Jira issue's summary and status; `null` when there is none. */
	jira(): Promise<JiraClient | null>;
	strings(): Strings;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
	tabOf(win: AppWindow, tabId: unknown): DocumentTab;
	toImageFile(raw: unknown): ImageFile;
}

/**
 * Requests to Atlassian with the token alone: no cookies (Jira's answers set
 * a session cookie, which Electron would send back) and a user agent that
 * does not read as a browser's. With either, Jira takes a write for one made
 * from a web page and refuses it: "XSRF check failed", a 403.
 */
export const atlassianFetch: Fetch = (url, init) =>
	net.fetch(url, {
		...init,
		credentials: "omit",
		headers: {
			...(init?.headers as Record<string, string> | undefined),
			"User-Agent": `kalem-desktop/${app.getVersion()}`,
		},
	});

export function confluenceClient(credentials: ConfluenceCredentials): ConfluenceClient {
	return new ConfluenceClient(credentials, atlassianFetch);
}

function account(client: ConfluenceClient, username: string): ConfluenceAccount {
	return { site: client.site, username, cloud: client.cloud };
}

const text = (value: unknown, name: string): string => {
	if (typeof value !== "string") throw new Error(`Invalid ${name}`);
	return value;
};

/** Checks the login with Confluence and keeps it. */
export async function connectConfluence(
	store: ConfluenceStore,
	raw: unknown,
): Promise<ConfluenceAccount> {
	const login = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	const credentials = {
		site: text(login.site, "site").trim(),
		username: text(login.username ?? "", "user name").trim(),
		token: text(login.token, "token").trim(),
	};
	if (credentials.site === "" || credentials.token === "") throw new Error("Missing login");
	const client = confluenceClient(credentials);
	await client.verify();
	const username = client.bearer ? "" : credentials.username;
	await store.set({ ...credentials, username, site: client.site });
	return account(client, username);
}

/** A version conflict: Confluence answers 409, some versions 400 with a message about it. */
function isConflict(error: unknown): boolean {
	return (
		error instanceof ConfluenceError &&
		(error.status === 409 || (error.status === 400 && /version/i.test(error.message)))
	);
}

export function registerConfluenceIpc(ctx: ConfluenceIpcContext): void {
	const { windows, senderOf, tabOf } = ctx;

	const connected = async (): Promise<ConfluenceClient> => {
		const credentials = await ctx.confluence.get();
		if (credentials === null) throw new Error(ctx.strings().confluenceNotConnected);
		return confluenceClient(credentials);
	};

	/** The tab's page, which must be on the site the app is connected to. */
	const remoteOf = async (
		win: AppWindow,
		tabId: unknown,
	): Promise<{ client: ConfluenceClient; tab: DocumentTab; page: RemotePage }> => {
		const tab = tabOf(win, tabId);
		const page = tab.remote;
		if (page === null) throw new Error("The tab is not a Confluence page");
		const client = await connected();
		if (client.site !== page.site) throw new Error(ctx.strings().confluenceNotConnected);
		return { client, tab, page };
	};

	ipcMain.handle(CHANNEL.confluenceAccount, async () => {
		const credentials = await ctx.confluence.get();
		if (credentials === null) return null;
		return account(confluenceClient(credentials), credentials.username);
	});

	ipcMain.handle(CHANNEL.confluenceConnect, (_event, raw: unknown) =>
		connectConfluence(ctx.confluence, raw),
	);

	ipcMain.handle(CHANNEL.confluenceDisconnect, () => ctx.confluence.clear());

	ipcMain.handle(CHANNEL.confluenceSpaces, async () => (await connected()).spaces());

	ipcMain.handle(CHANNEL.confluenceTree, async (_event, raw: unknown) => {
		const parent = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const client = await connected();
		return typeof parent.page === "string"
			? client.childPages(parent.page)
			: client.rootPages(text(parent.space, "space"));
	});

	ipcMain.handle(CHANNEL.confluenceCreatePage, async (event, raw: unknown) => {
		const win = senderOf(event);
		const request = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const title = text(request.title, "title").trim().slice(0, 255);
		if (title === "") throw new Error("Missing title");
		const client = await connected();
		const id = await client.create(
			text(request.space, "space"),
			typeof request.parent === "string" ? request.parent : null,
			title,
		);
		windows.openConfluencePage(await client.page(id), win);
		return { id, title, hasChildren: false };
	});

	/**
	 * A local document as a new page: the page is made where the user chose,
	 * the document's local pictures and files become its attachments, and
	 * its Markdown its content. Files that cannot be read are named back.
	 */
	ipcMain.handle(
		CHANNEL.confluencePublish,
		async (event, tabId: unknown, raw: unknown): Promise<ConfluencePublished> => {
			const win = senderOf(event);
			const tab = tabOf(win, tabId);
			const request = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
				string,
				unknown
			>;
			const title = text(request.title, "title").trim().slice(0, 255);
			if (title === "") throw new Error("Missing title");
			const space = text(request.space, "space").trim();
			if (space === "") throw new Error("Missing space");
			const parent = typeof request.parent === "string" ? request.parent : null;
			const plan = publishPlan(text(request.markdown, "document"));
			const client = await connected();

			// The files first: what cannot be read is known before anything is made.
			const base = tab.base ?? tab.path;
			const files: { name: string; type: string; bytes: Uint8Array }[] = [];
			const missing: string[] = [];
			for (const file of plan.files) {
				try {
					if (/^data:/i.test(file.url)) {
						const data = parseDataUrl(file.url);
						if (data === null) throw new Error("unreadable");
						files.push({ name: file.name, type: data.type, bytes: data.bytes });
						continue;
					}
					const path = /^file:/i.test(file.url)
						? fileURLToPath(file.url)
						: base === null
							? null
							: resolve(dirname(base), decodeURIComponent(file.url.split(/[?#]/)[0] ?? ""));
					if (path === null) throw new Error("no folder");
					const info = await stat(path);
					if (!info.isFile() || info.size > MAX_UPLOAD_MB * 1024 * 1024)
						throw new Error("too large");
					files.push({
						name: file.name,
						type: mediaTypeOf(file.name),
						bytes: await readFile(path),
					});
				} catch {
					missing.push(file.url.startsWith("data:") ? file.name : file.url);
				}
			}

			const id = await client.create(space, parent, title);
			for (const file of files) await client.attach(id, file.name, file.type, file.bytes);
			const created = await client.page(id);
			const saved = await client.update(created.page, markdownToStorage(plan.markdown));
			if (request.open === true) windows.openConfluencePage(await client.page(id), win);
			return {
				id,
				title: saved.title,
				url: saved.webUrl,
				spaceKey: saved.spaceKey,
				attached: files.length,
				missing,
			};
		},
	);

	ipcMain.handle(CHANNEL.confluenceFind, async (_event, raw: unknown) => {
		const request = parseSearchRequest(raw);
		if (request === null) throw new Error("Invalid search");
		return (await connected()).find(request);
	});

	/** Jira's address by site and server id, found once a run. */
	const jiraBases = new Map<string, Promise<string | null>>();

	ipcMain.handle(CHANNEL.confluenceAtom, async (event, tabId: unknown, xml: unknown) => {
		const win = senderOf(event);
		if (typeof xml !== "string" || xml.length > 100_000) throw new Error("Invalid atom");
		const { client, page } = await remoteOf(win, tabId);
		const details = describeAtom(xml, {
			site: page.site,
			spaceKey: page.spaceKey,
			pageUrl: page.webUrl,
		});
		if (details === null) return null;
		if (details.user !== undefined) {
			const user = await client.user(details.user).catch(() => null);
			if (user === null) return details;
			return {
				...details,
				title: user.name || details.title,
				subtitle: [user.username, user.email].filter((part) => part !== "").join(" · "),
				url: user.url ?? details.url,
				copy: user.name || details.copy,
			};
		}
		if (details.jira !== undefined) {
			const key = `${client.site}\n${details.jira.serverId}`;
			let base = jiraBases.get(key);
			if (base === undefined) {
				base = client.jiraBase(details.jira.serverId).catch(() => null);
				jiraBases.set(key, base);
			}
			const jira = await ctx.jira().catch(() => null);
			// Not found on the page's site: the Jira the app is connected to.
			const found = (await base) ?? jira?.site ?? null;
			// A failed look-up is tried again next time.
			if ((await base) === null) jiraBases.delete(key);
			const url = found === null ? null : jiraUrl(found, details.jira);
			// The issue's summary and status, when the app reaches that Jira.
			const sameJira =
				jira !== null && found !== null && new URL(found).host === new URL(jira.site).host;
			const issue =
				sameJira && details.jira.key !== ""
					? await jira.row(details.jira.key).catch(() => null)
					: null;
			return { ...details, url, ...(issue === null ? {} : { issue }) };
		}
		return details;
	});

	ipcMain.handle(CHANNEL.confluenceUsers, async (_event, query: unknown) =>
		(await connected()).users(text(query, "query").slice(0, 200)),
	);

	/** The Jira server new Jira macros name, by site and Jira; found once a run. */
	const jiraServers = new Map<string, Promise<JiraServer | null>>();

	ipcMain.handle(CHANNEL.confluenceJiraServer, async () => {
		const client = await connected();
		const jira = await ctx.jira().catch(() => null);
		const host = jira === null ? null : new URL(jira.site).host;
		const key = `${client.site}\n${host ?? ""}`;
		let server = jiraServers.get(key);
		if (server === undefined) {
			server = client.jiraServer(host).catch(() => null);
			jiraServers.set(key, server);
		}
		const found = await server;
		if (found === null) jiraServers.delete(key);
		return found;
	});

	ipcMain.handle(CHANNEL.confluenceAncestors, async (_event, pageId: unknown) =>
		(await connected()).ancestors(text(pageId, "page id")),
	);

	ipcMain.handle(CHANNEL.confluenceSearch, async (_event, query: unknown, spaceKey: unknown) =>
		(await connected()).search(
			typeof query === "string" ? query.slice(0, 2000) : "",
			typeof spaceKey === "string" ? spaceKey : null,
		),
	);

	ipcMain.handle(CHANNEL.confluenceOpenPage, async (event, pageId: unknown) => {
		const win = senderOf(event);
		const content = await (await connected()).page(text(pageId, "page id"));
		windows.openConfluencePage(content, win);
	});

	ipcMain.handle(CHANNEL.confluenceReloadPage, async (event, tabId: unknown) => {
		const win = senderOf(event);
		const { client, tab, page } = await remoteOf(win, tabId);
		const content = await client.page(page.id);
		windows.setRemote(win, tab.id, content.page, content.storage);
		return content;
	});

	ipcMain.handle(
		CHANNEL.confluenceSavePage,
		async (event, tabId: unknown, raw: unknown): Promise<ConfluenceSaveResult> => {
			const win = senderOf(event);
			const { client, tab, page } = await remoteOf(win, tabId);
			const request = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
				string,
				unknown
			>;
			const storage = text(request.storage, "page");
			const losses = Array.isArray(request.losses)
				? request.losses.filter((loss): loss is string => typeof loss === "string")
				: [];

			const t = ctx.strings();
			if (losses.length > 0) {
				const { response } = await dialog.showMessageBox(win.window, {
					type: "warning",
					message: t.confluenceLossConfirm,
					detail: format(
						t.confluenceLossDetail,
						losses.map((loss) => `• ${lossLabel(t, loss)}`).join("\n"),
					),
					buttons: [t.confluenceSaveAnyway, t.cancel],
					defaultId: 1,
					cancelId: 1,
				});
				if (response !== 0) return { ok: false, reason: "cancelled" };
			} else if (request.overwrite !== true && request.reviewed !== true) {
				// Every save is a new version on the shared page, so it is confirmed first.
				// Overwriting after a conflict was already a deliberate choice; losses have their own question.
				const { response } = await dialog.showMessageBox(win.window, {
					type: "question",
					message: t.confluenceSaveConfirm,
					detail: format(t.confluenceSaveDetail, page.title, page.spaceKey),
					buttons: [t.confluenceSaveAnyway, t.cancel],
					defaultId: 0,
					cancelId: 1,
				});
				if (response !== 0) return { ok: false, reason: "cancelled" };
			}

			// The renderer's version is the one its text is based on; overwriting builds on the newest.
			let base: RemotePage = {
				...page,
				version: typeof request.version === "number" ? request.version : page.version,
			};
			if (request.overwrite === true)
				base = { ...page, version: (await client.page(page.id)).page.version };
			try {
				const saved = await client.update(base, storage);
				windows.setRemote(win, tab.id, saved, storage);
				await ctx.drafts.delete(tab.id).catch(() => {});
				return { ok: true, page: saved };
			} catch (error) {
				if (isConflict(error)) return { ok: false, reason: "conflict" };
				throw error;
			}
		},
	);

	ipcMain.handle(CHANNEL.confluenceAttachImage, async (event, tabId: unknown, raw: unknown) => {
		const win = senderOf(event);
		const { client, page } = await remoteOf(win, tabId);
		const image = ctx.toImageFile(raw);
		const extension = IMAGE_EXTENSIONS[image.type];
		if (extension === undefined) throw new Error("Unsupported image type");
		const stem =
			image.name
				.replace(/\.[^.]*$/, "")
				// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in file names
				.replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, " ")
				.replace(/\s+/g, "-")
				.slice(0, 60) || "image";
		// A unique name: an attachment with the same name would be replaced.
		const name = `${stem}-${Date.now().toString(36)}.${extension}`;
		await client.attach(page.id, name, image.type, image.bytes);
		return name;
	});
	// --- Diagrams --------------------------------------------------------------

	/** A new diagram becomes an attachment; an edited one a new version of its attachment. */
	ipcMain.handle(
		CHANNEL.confluenceWriteDiagram,
		async (event, tabId: unknown, raw: unknown): Promise<ConfluenceUpload> => {
			const { client, page } = await remoteOf(senderOf(event), tabId);
			const request = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
				string,
				unknown
			>;
			const bytes = checkDiagramBytes(request.bytes);
			const data = checkDiagramData(request.data);
			let name: string;
			if (typeof request.name === "string") {
				name = request.name;
				if (!/\.png$/i.test(name) || /[\\/]/.test(name)) throw new Error("Invalid diagram name");
			} else {
				const taken = new Set(
					(await client.attachments(page.id)).map((file) => fileNameKey(file.name)),
				);
				name = diagramFileName(typeof request.title === "string" ? request.title : "", taken);
			}
			// The data first: a picture without it could not be edited again.
			await client.attach(
				page.id,
				diagramDataName(name),
				"application/json",
				new TextEncoder().encode(data),
			);
			await client.attach(page.id, name, "image/png", bytes);
			return { name, url: fileUrl(name), image: true };
		},
	);

	// --- Attachments ----------------------------------------------------------

	ipcMain.handle(CHANNEL.confluenceAttachments, async (event, tabId: unknown) => {
		const { client, page } = await remoteOf(senderOf(event), tabId);
		return client.attachments(page.id);
	});

	/**
	 * Uploads files to the tab's page; without paths the user picks them. A
	 * name the page already has is a new version of that attachment or a
	 * second file under a free name, as the user chooses. One bad file does
	 * not stop the rest.
	 */
	ipcMain.handle(
		CHANNEL.confluenceUploadFiles,
		async (event, tabId: unknown, raw: unknown): Promise<ConfluenceUpload[]> => {
			const win = senderOf(event);
			const { client, page } = await remoteOf(win, tabId);
			const t = ctx.strings();
			const paths = Array.isArray(raw)
				? raw.filter((path): path is string => typeof path === "string")
				: await windows.showDialog(win, {
						defaultPath: windows.defaultFolder(win),
						properties: ["openFile", "multiSelections"],
						filters: [{ name: t.allFiles, extensions: ["*"] }],
					});
			if (paths.length === 0) return [];

			const taken = new Set((await client.attachments(page.id)).map((file) => file.name));
			const uploads: ConfluenceUpload[] = [];
			for (const path of paths) {
				let name = basename(path);
				if (taken.has(name)) {
					const { response } = await dialog.showMessageBox(win.window, {
						type: "question",
						message: format(t.confluenceAttachmentExists, name),
						detail: t.confluenceAttachmentExistsDetail,
						buttons: [t.confluenceUploadNewVersion, t.confluenceKeepBoth, t.skip],
						defaultId: 0,
						cancelId: 2,
					});
					if (response === 2) continue;
					if (response === 1) name = freeName(name, taken);
				}
				try {
					if ((await stat(path)).size > MAX_UPLOAD_MB * 1024 * 1024) {
						throw new Error(format(t.confluenceAttachmentTooLarge, MAX_UPLOAD_MB));
					}
					const type = mediaTypeOf(name);
					await client.attach(page.id, name, type, await readFile(path));
					taken.add(name);
					uploads.push({ name, url: fileUrl(name), image: type.startsWith("image/") });
				} catch (error) {
					await dialog.showMessageBox(win.window, {
						type: "error",
						message: t.confluenceUploadFailed,
						detail: `${path}\n\n${errorMessage(error)}`,
					});
				}
			}
			return uploads;
		},
	);

	const download = async (client: ConfluenceClient, page: RemotePage, name: string) => {
		const response = await client.attachment(page.id, name);
		if (response === null) throw new Error(ctx.strings().confluenceAttachmentMissing);
		return new Uint8Array(await response.arrayBuffer());
	};

	/** Opens a copy in the app the system uses for that kind of file. */
	ipcMain.handle(CHANNEL.confluenceOpenAttachment, async (event, tabId: unknown, raw: unknown) => {
		const { client, page } = await remoteOf(senderOf(event), tabId);
		const name = text(raw, "attachment name");
		if (isRunnable(name)) throw new Error(ctx.strings().confluenceAttachmentRisky);
		const folder = join(app.getPath("temp"), "kalem-confluence", page.id);
		await mkdir(folder, { recursive: true });
		const path = join(folder, localFileName(name));
		await writeFile(path, await download(client, page, name));
		const failure = await shell.openPath(path);
		if (failure !== "") throw new Error(failure);
	});

	/** Resolves with the path it was saved to, `null` when the user cancelled. */
	ipcMain.handle(
		CHANNEL.confluenceDownloadAttachment,
		async (event, tabId: unknown, raw: unknown): Promise<string | null> => {
			const win = senderOf(event);
			const { client, page } = await remoteOf(win, tabId);
			const name = text(raw, "attachment name");
			const result = await dialog.showSaveDialog(win.window, {
				defaultPath: join(app.getPath("downloads"), localFileName(name)),
			});
			if (result.canceled || result.filePath === "") return null;
			await writeFile(result.filePath, await download(client, page, name));
			return result.filePath;
		},
	);

	/** Asks first; resolves with whether the attachment was deleted. */
	ipcMain.handle(
		CHANNEL.confluenceDeleteAttachment,
		async (event, tabId: unknown, raw: unknown): Promise<boolean> => {
			const win = senderOf(event);
			const { client } = await remoteOf(win, tabId);
			const request = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
				string,
				unknown
			>;
			const id = text(request.id, "attachment id");
			const name = text(request.name, "attachment name");
			const t = ctx.strings();
			const { response } = await dialog.showMessageBox(win.window, {
				type: "warning",
				message: format(t.confluenceDeleteConfirm, name),
				detail:
					request.used === true
						? `${t.confluenceDeleteUsed}\n\n${t.confluenceDeleteDetail}`
						: t.confluenceDeleteDetail,
				buttons: [t.confluenceAttachmentDelete, t.cancel],
				defaultId: 1,
				cancelId: 1,
			});
			if (response !== 0) return false;
			await client.deleteAttachment(id);
			return true;
		},
	);
}
