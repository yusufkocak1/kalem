import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { app, dialog, ipcMain } from "electron";
import type {
	Attachment,
	DraftRequest,
	ImageFile,
	SaveResult,
	Settings,
	Startup,
	WindowState,
} from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import { toTextFormat } from "../shared/encoding.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { assetsFolderName } from "../shared/images.js";
import {
	extension,
	isEditablePath,
	isPackagePath,
	isWordPath,
	MARKDOWN_EXTENSIONS,
	PACKAGE_EXTENSIONS,
	stripExtension,
	TEXT_EXTENSIONS,
} from "../shared/paths.js";
import type { DraftStore } from "./drafts.js";
import { copyAttachment, MAX_IMAGE_SIZE, writeDocument, writeImage } from "./files.js";
import type { PackageStore } from "./package.js";
import { PACKAGE_ASSETS } from "./package.js";
import { DOCUMENT_SCHEME } from "./protocol.js";
import { relocateLinks } from "./relocate.js";
import type { SettingsStore } from "./settings.js";
import type { AppWindow, WindowManager } from "./windows.js";
import { errorMessage, pathKey } from "./windows.js";

export interface IpcContext {
	readonly windows: WindowManager;
	readonly store: SettingsStore;
	readonly drafts: DraftStore;
	readonly packages: PackageStore;
	strings(): Strings;
	language(): Lang;
	changeSettings(patch: Partial<Settings>): void;
	showFileMenu(win: AppWindow, x: number, y: number): void;
}

const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
};

function toFileName(name: string, fallback: string): string {
	const clean = name
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in file names
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return clean === "" || /^\.+$/.test(clean) ? fallback : clean.slice(0, 120);
}

function toImageFile(raw: unknown): ImageFile {
	const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	if (
		typeof value.name !== "string" ||
		typeof value.type !== "string" ||
		!(value.bytes instanceof Uint8Array)
	) {
		throw new Error("Invalid image payload");
	}
	return { name: value.name, type: value.type, bytes: value.bytes };
}

/**
 * IPC arguments are untyped at runtime and the main process writes to disk,
 * so every handler checks its sender and its arguments.
 */
export function registerIpc(ctx: IpcContext): void {
	const { windows } = ctx;

	const senderOf = (event: IpcMainInvokeEvent | IpcMainEvent): AppWindow => {
		const win = windows.get(event.sender);
		if (win === undefined) throw new Error("Request from an unknown window");
		return win;
	};

	/** The tab must belong to the calling window. */
	const tabOf = (win: AppWindow, tabId: unknown) => {
		const tab = typeof tabId === "string" ? win.tabs.get(tabId) : undefined;
		if (tab === undefined) throw new Error("Unknown tab");
		return tab;
	};

	const on = (channel: string, handler: (win: AppWindow, ...args: unknown[]) => void) => {
		ipcMain.on(channel, (event, ...args: unknown[]) => {
			const win = windows.get(event.sender);
			if (win !== undefined) handler(win, ...args);
		});
	};

	/** Only next to a document this window opened or saved. */
	const writableDocument = (win: AppWindow, documentPath: unknown): string => {
		if (typeof documentPath !== "string" || !win.writable.has(pathKey(documentPath))) {
			throw new Error("This window is not allowed to write next to that document");
		}
		return documentPath;
	};

	/** Where a document's images and attachments go: next to it, or into the package. */
	const assetsTarget = async (
		documentPath: string,
	): Promise<{ contentPath: string; folderName: string }> => {
		if (!isPackagePath(documentPath)) {
			return { contentPath: documentPath, folderName: assetsFolderName(basename(documentPath)) };
		}
		const work = await ctx.packages.workFolder(documentPath);
		return { contentPath: join(work.folder, work.textName), folderName: PACKAGE_ASSETS };
	};

	ipcMain.handle(CHANNEL.getStartup, async (event): Promise<Startup> => {
		const win = senderOf(event);
		return {
			settings: ctx.store.settings,
			language: ctx.language(),
			platform: process.platform,
			version: app.getVersion(),
			documents: await windows.takePending(win),
			documentScheme: DOCUMENT_SCHEME,
		};
	});

	// --- Documents and tabs -------------------------------------------------

	on(CHANNEL.newWindow, () => void windows.open());
	on(CHANNEL.newTab, (win) => void windows.addTab(win, { kind: "empty" }, false));

	ipcMain.handle(CHANNEL.showOpenDialog, (event) => windows.showOpenDialog(senderOf(event)));

	ipcMain.handle(CHANNEL.openPath, async (event, path: unknown) => {
		const win = senderOf(event);
		// Document types only: this channel must not load arbitrary files into the editor.
		if (typeof path !== "string" || !(isEditablePath(path) || isWordPath(path))) return;
		await windows.openPath(path, win);
	});

	ipcMain.handle(CHANNEL.importWord, (event) => windows.showWordDialog(senderOf(event)));

	ipcMain.handle(
		CHANNEL.chooseSavePath,
		async (event, tabId: unknown, suggested: unknown, kind: unknown) => {
			const win = senderOf(event);
			const tab = tabOf(win, tabId);
			const t = ctx.strings();
			const name = toFileName(typeof suggested === "string" ? suggested : "", t.untitled);

			const markdown = { name: t.markdownDocuments, extensions: [...MARKDOWN_EXTENSIONS] };
			const text = { name: t.textDocuments, extensions: [...TEXT_EXTENSIONS] };
			const packaged = { name: t.packages, extensions: [...PACKAGE_EXTENSIONS] };
			const current = tab.path === null ? "md" : extension(tab.path);
			// Markdown unless asked for a package or already something else.
			const wanted =
				kind === "package"
					? "kmd"
					: TEXT_EXTENSIONS.includes(current) || PACKAGE_EXTENSIONS.includes(current)
						? current
						: "md";
			const first = TEXT_EXTENSIONS.includes(wanted)
				? text
				: PACKAGE_EXTENSIONS.includes(wanted)
					? packaged
					: markdown;
			const stem =
				tab.path === null
					? join(windows.defaultFolder(win), name)
					: join(dirname(tab.path), stripExtension(basename(tab.path)));
			const result = await dialog.showSaveDialog(win.window, {
				defaultPath: `${stem}.${wanted}`,
				// The first filter decides the extension the dialog proposes.
				filters: [first, ...[markdown, text, packaged].filter((filter) => filter !== first)],
			});
			if (result.canceled || result.filePath === "") return null;

			const path = isEditablePath(result.filePath)
				? result.filePath
				: `${result.filePath}.${wanted}`;
			if (windows.isOpenElsewhere(path, tab.id)) {
				await dialog.showMessageBox(win.window, {
					type: "warning",
					message: t.saveFailed,
					detail: t.openInAnotherWindow,
				});
				return null;
			}

			// The user picked this path, so this window may now write to it.
			win.writable.add(pathKey(path));
			return path;
		},
	);

	ipcMain.handle(
		CHANNEL.writeDocument,
		async (
			event,
			tabId: unknown,
			path: unknown,
			text: unknown,
			rawFormat: unknown,
		): Promise<SaveResult> => {
			const win = senderOf(event);
			const tab = tabOf(win, tabId);
			if (typeof path !== "string" || typeof text !== "string") {
				throw new Error("Invalid save request");
			}
			if (!win.writable.has(pathKey(path))) {
				throw new Error("This window is not allowed to write to that path");
			}
			const format = toTextFormat(rawFormat);
			// Links in the editor resolve against this until the save completes.
			const from = tab.base ?? tab.path;

			let saved: { modified: number; text: string; changed: boolean; base: string | null };
			if (isPackagePath(path)) {
				saved = await ctx.packages.save(path, text, format, from);
			} else {
				const relocated =
					from === null
						? { text, changed: false }
						: await relocateLinks(text, from, path, assetsFolderName(basename(path)));
				const modified = await writeDocument(path, relocated.text, format);
				saved = { modified, ...relocated, base: null };
			}
			windows.markSaved(win, tab.id, path, saved.modified, saved.base);
			await ctx.drafts.delete(tab.id).catch(() => {});

			const movedBase =
				saved.base !== null && (from === null || pathKey(from) !== pathKey(saved.base));
			if (!saved.changed && !movedBase) return { modified: saved.modified };
			return {
				modified: saved.modified,
				file: {
					path,
					name: basename(path),
					text: saved.text,
					format,
					modified: saved.modified,
					...(saved.base === null ? {} : { base: saved.base }),
				},
			};
		},
	);

	ipcMain.handle(CHANNEL.reloadDocument, (event, tabId: unknown) => {
		const win = senderOf(event);
		return windows.reload(win, tabOf(win, tabId).id);
	});

	on(CHANNEL.reportState, (win, tabId, raw) => {
		if (typeof tabId !== "string") return;
		const state = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<WindowState>;
		windows.updateState(win, tabId, {
			name:
				typeof state.name === "string" && state.name !== "" ? state.name : ctx.strings().untitled,
			dirty: state.dirty === true,
		});
	});

	on(CHANNEL.tabActivated, (win, tabId) => {
		if (typeof tabId === "string") windows.setActiveTab(win, tabId);
	});

	ipcMain.handle(CHANNEL.confirmCloseTab, (event, tabId: unknown) => {
		const win = senderOf(event);
		return windows.confirmCloseTab(win, tabOf(win, tabId).id);
	});

	on(CHANNEL.tabClosed, (win, tabId) => {
		if (typeof tabId === "string") windows.tabClosed(win, tabId);
	});

	on(CHANNEL.answerSave, (win, tabId, saved) => {
		if (typeof tabId === "string") windows.answerSave(win, tabId, saved === true);
	});

	// --- Images and attachments ---------------------------------------------

	ipcMain.handle(CHANNEL.writeImage, async (event, documentPath: unknown, raw: unknown) => {
		const target = await assetsTarget(writableDocument(senderOf(event), documentPath));
		return writeImage(target.contentPath, toImageFile(raw), target.folderName);
	});

	ipcMain.handle(CHANNEL.pickImages, async (event): Promise<ImageFile[]> => {
		const win = senderOf(event);
		const t = ctx.strings();
		const paths = await windows.showDialog(win, {
			defaultPath: windows.defaultFolder(win),
			properties: ["openFile", "multiSelections"],
			filters: [{ name: t.images, extensions: Object.keys(TYPE_BY_EXTENSION) }],
		});

		const images: ImageFile[] = [];
		for (const path of paths) {
			const type = TYPE_BY_EXTENSION[extension(path)];
			if (type === undefined) continue;
			try {
				if ((await stat(path)).size > MAX_IMAGE_SIZE) continue;
				images.push({ name: basename(path), type, bytes: await readFile(path) });
			} catch (error) {
				await dialog.showMessageBox(win.window, {
					type: "error",
					message: t.openFailed,
					detail: `${path}\n\n${errorMessage(error)}`,
				});
			}
		}
		return images;
	});

	/** Copies files next to the document; one bad file does not stop the rest. */
	const attach = async (
		win: AppWindow,
		documentPath: string,
		paths: readonly string[],
	): Promise<Attachment[]> => {
		const attachments: Attachment[] = [];
		const target = await assetsTarget(documentPath);
		for (const path of paths) {
			try {
				attachments.push(await copyAttachment(target.contentPath, path, target.folderName));
			} catch (error) {
				await dialog.showMessageBox(win.window, {
					type: "error",
					message: ctx.strings().attachFailed,
					detail: `${path}\n\n${errorMessage(error)}`,
				});
			}
		}
		return attachments;
	};

	ipcMain.handle(CHANNEL.pickAttachments, async (event, raw: unknown) => {
		const win = senderOf(event);
		const documentPath = writableDocument(win, raw);
		const paths = await windows.showDialog(win, {
			defaultPath: windows.defaultFolder(win),
			properties: ["openFile", "multiSelections"],
			filters: [{ name: ctx.strings().allFiles, extensions: ["*"] }],
		});
		return attach(win, documentPath, paths);
	});

	ipcMain.handle(CHANNEL.attachPaths, async (event, raw: unknown, paths: unknown) => {
		const win = senderOf(event);
		const documentPath = writableDocument(win, raw);
		if (!Array.isArray(paths)) return [];
		return attach(
			win,
			documentPath,
			paths.filter((path): path is string => typeof path === "string"),
		);
	});

	// --- Recovery drafts ----------------------------------------------------

	ipcMain.handle(CHANNEL.writeDraft, async (event, tabId: unknown, raw: unknown) => {
		const win = senderOf(event);
		const tab = tabOf(win, tabId);
		const request = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<DraftRequest>;
		if (typeof request.text !== "string") throw new Error("Invalid draft");
		await ctx.drafts.write(
			tab.id,
			{
				path: tab.path,
				name: typeof request.name === "string" ? request.name : tab.name,
				text: request.text,
				format: toTextFormat(request.format),
			},
			Date.now(),
		);
	});

	ipcMain.handle(CHANNEL.deleteDraft, (event, tabId: unknown) => {
		const win = senderOf(event);
		return ctx.drafts.delete(tabOf(win, tabId).id);
	});

	// --- Export -------------------------------------------------------------

	ipcMain.handle(CHANNEL.writeHtml, async (event, suggestedName: unknown, html: unknown) => {
		const win = senderOf(event);
		if (typeof html !== "string") throw new Error("Invalid export request");
		const t = ctx.strings();
		const name = toFileName(typeof suggestedName === "string" ? suggestedName : "", t.untitled);
		const result = await dialog.showSaveDialog(win.window, {
			defaultPath: join(windows.defaultFolder(win), `${name}.html`),
			filters: [{ name: "HTML", extensions: ["html", "htm"] }],
		});
		if (result.canceled || result.filePath === "") return false;
		await writeFile(result.filePath, html, "utf8");
		return true;
	});

	// --- App ----------------------------------------------------------------

	on(CHANNEL.updateSettings, (_win, patch) => {
		if (typeof patch !== "object" || patch === null) return;
		// Language changes go through the menu flow, which offers a restart.
		const { language: _language, ...rest } = patch as Partial<Settings>;
		ctx.changeSettings(rest);
	});

	on(CHANNEL.clipboard, (win, action) => {
		const contents = win.window.webContents;
		if (action === "cut") contents.cut();
		else if (action === "copy") contents.copy();
		else if (action === "paste") contents.paste();
	});

	on(CHANNEL.openLink, (win, href) => {
		if (typeof href === "string") void windows.openLink(win, href);
	});

	on(CHANNEL.showFileMenu, (win, x, y) => {
		if (typeof x === "number" && typeof y === "number") ctx.showFileMenu(win, x, y);
	});
}
