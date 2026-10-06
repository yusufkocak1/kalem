import type { IpcMainInvokeEvent } from "electron";
import { dialog, ipcMain, net } from "electron";
import type {
	ConfluenceAccount,
	ConfluenceSaveResult,
	ImageFile,
	RemotePage,
} from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format, lossLabel } from "../shared/i18n.js";
import { IMAGE_EXTENSIONS } from "../shared/images.js";
import type { ConfluenceCredentials } from "./confluence-client.js";
import { ConfluenceClient, ConfluenceError } from "./confluence-client.js";
import type { ConfluenceStore } from "./confluence-store.js";
import type { DraftStore } from "./drafts.js";
import type { AppWindow, DocumentTab, WindowManager } from "./windows.js";

export interface ConfluenceIpcContext {
	readonly windows: WindowManager;
	readonly drafts: DraftStore;
	readonly confluence: ConfluenceStore;
	strings(): Strings;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
	tabOf(win: AppWindow, tabId: unknown): DocumentTab;
	toImageFile(raw: unknown): ImageFile;
}

export function confluenceClient(credentials: ConfluenceCredentials): ConfluenceClient {
	return new ConfluenceClient(credentials, (url, init) => net.fetch(url, init));
}

function account(client: ConfluenceClient, username: string): ConfluenceAccount {
	return { site: client.site, username, cloud: client.cloud };
}

const text = (value: unknown, name: string): string => {
	if (typeof value !== "string") throw new Error(`Invalid ${name}`);
	return value;
};

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

	ipcMain.handle(CHANNEL.confluenceConnect, async (_event, raw: unknown) => {
		const login = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const credentials = {
			site: text(login.site, "site").trim(),
			username: text(login.username, "user name").trim(),
			token: text(login.token, "token").trim(),
		};
		if (credentials.site === "" || credentials.token === "") throw new Error("Missing login");
		const client = confluenceClient(credentials);
		await client.verify();
		await ctx.confluence.set({ ...credentials, site: client.site });
		return account(client, credentials.username);
	});

	ipcMain.handle(CHANNEL.confluenceDisconnect, () => ctx.confluence.clear());

	ipcMain.handle(CHANNEL.confluenceSpaces, async () => (await connected()).spaces());

	ipcMain.handle(CHANNEL.confluenceSearch, async (_event, query: unknown, spaceKey: unknown) =>
		(await connected()).search(
			typeof query === "string" ? query.slice(0, 200) : "",
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
		windows.setRemote(win, tab.id, content.page);
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

			if (losses.length > 0) {
				const t = ctx.strings();
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
				windows.setRemote(win, tab.id, saved);
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
}
