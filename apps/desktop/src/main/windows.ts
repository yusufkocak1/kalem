import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { WebContents } from "electron";
import { app, BrowserWindow, dialog, nativeTheme, screen, shell } from "electron";
import type {
	CloseChoice,
	DocumentPayload,
	OpenedFile,
	Settings,
	TabDocument,
	WindowState,
} from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { LegacyEncoding } from "../shared/encoding.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import {
	isEditablePath,
	isPackagePath,
	isWordPath,
	MARKDOWN_EXTENSIONS,
	PACKAGE_EXTENSIONS,
	stripExtension,
	TEXT_EXTENSIONS,
} from "../shared/paths.js";
import type { DraftStore } from "./drafts.js";
import { modifiedTime, readDocument } from "./files.js";
import type { PackageStore } from "./package.js";
import { pathKey } from "./path-key.js";
import type { SettingsStore, WindowBounds } from "./settings.js";
import { readWord, WordError } from "./word.js";

/**
 * Main-process view of one open document. The text itself lives in the
 * renderer; only what is needed to manage the tab is kept here.
 */
export interface DocumentTab {
	/** Also the id of the tab's recovery draft. */
	readonly id: string;
	path: string | null;
	/** What relative links resolve against when it is not `path` (an unpacked package). */
	base: string | null;
	name: string;
	dirty: boolean;
	/** Last known mtime of the file on disk. */
	modified: number | null;
}

export interface AppWindow {
	readonly window: BrowserWindow;
	readonly tabs: Map<string, DocumentTab>;
	activeTabId: string | null;
	/** Paths (as keys) this window may write to. */
	readonly writable: Set<string>;
	/** Documents to hand over once the renderer asks for them. */
	pending: TabDocument[];
	ready: boolean;
	closeConfirmed: boolean;
	/** A close confirmation is in progress. */
	closing: boolean;
	/** Resolvers of save requests sent to the renderer, by tab id. */
	readonly saveRequests: Map<string, (saved: boolean) => void>;
}

export interface WindowManagerOptions {
	readonly store: SettingsStore;
	readonly drafts: DraftStore;
	readonly packages: PackageStore;
	readonly preloadPath: string;
	readonly devUrl: string | null;
	readonly rendererFile: string;
	strings(): Strings;
	language(): Lang;
	onRecentFilesChanged(): void;
	showContextMenu(contents: WebContents, params: Electron.ContextMenuParams): void;
}

export { pathKey } from "./path-key.js";

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const DARK_BACKGROUND = "#17161b";
const LIGHT_BACKGROUND = "#e9e7e3";

export class WindowManager {
	readonly #options: WindowManagerOptions;
	readonly #windows = new Map<number, AppWindow>();
	#quitting = false;

	constructor(options: WindowManagerOptions) {
		this.#options = options;
	}

	get(contents: WebContents): AppWindow | undefined {
		return this.#windows.get(contents.id);
	}

	focused(): AppWindow | undefined {
		const window = BrowserWindow.getFocusedWindow();
		return window === null ? undefined : this.#windows.get(window.webContents.id);
	}

	all(): readonly AppWindow[] {
		return [...this.#windows.values()];
	}

	activeTab(win: AppWindow): DocumentTab | undefined {
		return win.activeTabId === null ? undefined : win.tabs.get(win.activeTabId);
	}

	// --- Windows ------------------------------------------------------------

	/** Opens a window with the given documents as tabs; a single empty tab by default. */
	open(documents: readonly TabDocument[] = []): AppWindow {
		const bounds = this.#initialBounds();
		const window = new BrowserWindow({
			width: bounds.width,
			height: bounds.height,
			...(bounds.x !== null && bounds.y !== null ? { x: bounds.x, y: bounds.y } : {}),
			minWidth: 560,
			minHeight: 400,
			show: false,
			title: this.#options.strings().appName,
			icon: join(__dirname, "icon.png"),
			backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND,
			autoHideMenuBar: true,
			webPreferences: {
				preload: this.#options.preloadPath,
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
				spellcheck: this.#options.store.settings.spellCheck,
			},
		});

		const win: AppWindow = {
			window,
			tabs: new Map(),
			activeTabId: null,
			writable: new Set(),
			pending: [],
			ready: false,
			closeConfirmed: false,
			closing: false,
			saveRequests: new Map(),
		};
		const initial = documents.length > 0 ? documents : [this.#emptyDocument()];
		for (const document of initial) {
			win.tabs.set(document.tabId, this.#tabFor(win, document));
			win.pending.push(document);
			win.activeTabId = document.tabId;
		}
		this.#windows.set(window.webContents.id, win);
		this.#updateTitle(win);

		if (bounds.maximized) window.maximize();
		window.once("ready-to-show", () => window.show());
		this.#attachEvents(win);

		if (this.#options.devUrl !== null) void window.loadURL(this.#options.devUrl);
		else void window.loadFile(this.#options.rendererFile);

		return win;
	}

	#emptyDocument(): TabDocument {
		return { tabId: randomUUID(), payload: { kind: "empty" } };
	}

	#initialBounds(): WindowBounds {
		const reference = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		if (reference !== undefined && !reference.isDestroyed()) {
			const b = reference.getNormalBounds();
			return { width: b.width, height: b.height, x: b.x + 28, y: b.y + 28, maximized: false };
		}

		const saved = this.#options.store.state.window;
		if (saved === null) return { width: 1180, height: 820, x: null, y: null, maximized: false };

		// The saved position may be on a monitor that is no longer attached.
		const { x, y } = saved;
		const visible =
			x !== null &&
			y !== null &&
			screen.getAllDisplays().some(({ workArea: a }) => {
				return x >= a.x - 40 && x < a.x + a.width - 80 && y >= a.y - 40 && y < a.y + a.height - 80;
			});
		return visible ? saved : { ...saved, x: null, y: null };
	}

	#attachEvents(win: AppWindow): void {
		const { window } = win;
		const contents = window.webContents;
		const id = contents.id;

		// The renderer is a single page; links go through `openLink`.
		contents.on("will-navigate", (event) => event.preventDefault());
		contents.setWindowOpenHandler(() => ({ action: "deny" }));
		// The window title is the document name, not the page's <title>.
		window.on("page-title-updated", (event) => event.preventDefault());
		contents.on("context-menu", (_event, params) =>
			this.#options.showContextMenu(contents, params),
		);

		window.on("focus", () => void this.#checkExternalChanges(win));

		window.on("close", (event) => {
			const hasUnsaved = [...win.tabs.values()].some((tab) => tab.dirty);
			if (win.closeConfirmed || !hasUnsaved) {
				this.#saveBounds(window);
				return;
			}
			event.preventDefault();
			void this.#confirmWindowClose(win);
		});

		window.on("closed", () => {
			this.#windows.delete(id);
			for (const tab of win.tabs.values()) {
				void this.#options.drafts.delete(tab.id).catch(() => {});
				this.#releasePackage(tab.path);
			}
			for (const resolveSave of win.saveRequests.values()) resolveSave(false);
			if (this.#quitting && this.#windows.size > 0) app.quit();
		});
	}

	#saveBounds(window: BrowserWindow): void {
		const b = window.getNormalBounds();
		this.#options.store.update({
			window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: window.isMaximized() },
		});
	}

	// --- Closing ------------------------------------------------------------

	beginQuit(): void {
		this.#quitting = true;
	}

	/** Asks what to do with an unsaved tab; a clean tab needs no question. */
	async confirmCloseTab(win: AppWindow, tabId: string): Promise<CloseChoice> {
		const tab = win.tabs.get(tabId);
		if (tab === undefined || !tab.dirty) return "discard";

		const t = this.#options.strings();
		if (win.window.isMinimized()) win.window.restore();
		win.window.focus();
		const { response } = await dialog.showMessageBox(win.window, {
			type: "question",
			message: format(t.saveChangesQuestion, tab.name),
			detail: t.saveChangesDetail,
			buttons: [t.save, t.dontSave, t.cancel],
			defaultId: 0,
			cancelId: 2,
			noLink: true,
		});
		return response === 0 ? "save" : response === 1 ? "discard" : "cancel";
	}

	/** Asks the renderer, which owns the text, to save a tab. */
	#requestSave(win: AppWindow, tabId: string): Promise<boolean> {
		return new Promise((resolveSave) => {
			win.saveRequests.set(tabId, resolveSave);
			win.window.webContents.send(CHANNEL.saveRequest, tabId);
		});
	}

	answerSave(win: AppWindow, tabId: string, saved: boolean): void {
		win.saveRequests.get(tabId)?.(saved);
		win.saveRequests.delete(tabId);
	}

	/** Goes through the unsaved tabs one by one; any "Cancel" keeps the window open. */
	async #confirmWindowClose(win: AppWindow): Promise<void> {
		if (win.closing) return;
		win.closing = true;
		try {
			for (const tab of [...win.tabs.values()]) {
				if (!tab.dirty) continue;
				this.#activate(win, tab.id);
				const choice = await this.confirmCloseTab(win, tab.id);
				if (win.window.isDestroyed()) return;
				const saved = choice === "save" && (await this.#requestSave(win, tab.id));
				if (win.window.isDestroyed()) return;
				if (choice === "cancel" || (choice === "save" && !saved)) {
					this.#quitting = false;
					return;
				}
			}
			win.closeConfirmed = true;
			win.window.close();
		} finally {
			win.closing = false;
		}
	}

	/** The renderer closed a tab; closing the last one closes the window. */
	tabClosed(win: AppWindow, tabId: string): void {
		const tab = win.tabs.get(tabId);
		if (tab === undefined || !win.tabs.delete(tabId)) return;
		this.#releasePackage(tab.path);
		void this.#options.drafts.delete(tabId).catch(() => {});
		if (win.tabs.size === 0) {
			win.closeConfirmed = true;
			win.window.close();
			return;
		}
		if (win.activeTabId === tabId) win.activeTabId = [...win.tabs.keys()].at(-1) ?? null;
		this.#updateTitle(win);
	}

	// --- State --------------------------------------------------------------

	/** The path is never taken from the renderer; only opening and saving set it. */
	updateState(win: AppWindow, tabId: string, state: WindowState): void {
		const tab = win.tabs.get(tabId);
		if (tab === undefined) return;
		tab.dirty = state.dirty;
		tab.name = state.name;
		this.#updateTitle(win);
	}

	setActiveTab(win: AppWindow, tabId: string): void {
		if (!win.tabs.has(tabId)) return;
		win.activeTabId = tabId;
		this.#updateTitle(win);
	}

	/** Makes a tab active in both processes. */
	#activate(win: AppWindow, tabId: string): void {
		this.setActiveTab(win, tabId);
		if (win.ready) win.window.webContents.send(CHANNEL.activateTab, tabId);
	}

	#updateTitle(win: AppWindow): void {
		const { window } = win;
		if (window.isDestroyed()) return;
		const tab = this.activeTab(win);
		const appName = this.#options.strings().appName;
		window.setTitle(
			tab === undefined ? appName : `${tab.dirty ? "● " : ""}${tab.name} – ${appName}`,
		);
		window.setDocumentEdited(tab?.dirty === true);
		window.setRepresentedFilename(tab?.path ?? "");
	}

	markSaved(
		win: AppWindow,
		tabId: string,
		path: string,
		modified: number,
		base: string | null,
	): void {
		const tab = win.tabs.get(tabId);
		if (tab === undefined) return;
		if (tab.path !== null && pathKey(tab.path) !== pathKey(path)) this.#releasePackage(tab.path);
		tab.path = path;
		tab.base = base;
		tab.modified = modified;
		tab.name = stripExtension(basename(path));
		win.writable.add(pathKey(path));
		this.#addRecentFile(path);
		this.#updateTitle(win);
	}

	/** Whether another tab, in any window, already has this path open. */
	isOpenElsewhere(path: string, exceptTabId: string): boolean {
		const key = pathKey(path);
		return this.all().some((win) =>
			[...win.tabs.values()].some(
				(tab) => tab.id !== exceptTabId && tab.path !== null && pathKey(tab.path) === key,
			),
		);
	}

	#addRecentFile(path: string): void {
		const { store } = this.#options;
		const key = pathKey(path);
		store.update({
			recentFiles: [path, ...store.state.recentFiles.filter((p) => pathKey(p) !== key)],
		});
		app.addRecentDocument(path);
		this.#options.onRecentFilesChanged();
	}

	#removeRecentFile(path: string): void {
		const { store } = this.#options;
		const key = pathKey(path);
		const remaining = store.state.recentFiles.filter((p) => pathKey(p) !== key);
		if (remaining.length === store.state.recentFiles.length) return;
		store.update({ recentFiles: remaining });
		this.#options.onRecentFilesChanged();
	}

	broadcastSettings(settings: Settings): void {
		for (const win of this.#windows.values()) {
			win.window.webContents.send(CHANNEL.settings, settings);
		}
	}

	// --- Opening documents --------------------------------------------------

	#tabFor(win: AppWindow, { tabId, payload }: TabDocument): DocumentTab {
		const t = this.#options.strings();
		const tab: DocumentTab = {
			id: tabId,
			path: null,
			base: null,
			name: t.untitled,
			dirty: false,
			modified: null,
		};

		switch (payload.kind) {
			case "file":
				tab.path = payload.file.path;
				tab.base = payload.file.base ?? null;
				tab.name = stripExtension(payload.file.name);
				tab.modified = payload.file.modified;
				win.writable.add(pathKey(payload.file.path));
				break;
			case "word":
				tab.name = payload.word.name;
				tab.dirty = true;
				break;
			case "draft":
				tab.path = payload.draft.path;
				tab.base = payload.draft.base ?? null;
				tab.name = payload.draft.name === "" ? t.untitled : payload.draft.name;
				tab.dirty = true;
				if (payload.draft.path !== null) win.writable.add(pathKey(payload.draft.path));
				break;
			case "welcome":
				tab.name = t.welcomeDocument;
				break;
			default:
				break;
		}
		return tab;
	}

	/**
	 * Adds a document to the window. It takes over the active tab when that
	 * tab is untitled and untouched, so opening a file right after starting
	 * the app does not leave an empty tab behind.
	 */
	addTab(win: AppWindow, payload: DocumentPayload, reuseBlank = true): DocumentTab {
		const active = this.activeTab(win);
		const reuse = reuseBlank && active !== undefined && active.path === null && !active.dirty;
		const document: TabDocument = { tabId: reuse ? active.id : randomUUID(), payload };

		const tab = this.#tabFor(win, document);
		win.tabs.set(tab.id, tab);
		win.activeTabId = tab.id;
		this.#updateTitle(win);

		if (win.ready) {
			win.window.webContents.send(CHANNEL.document, document);
		} else {
			// Still loading: the renderer picks the documents up from `takePending`.
			win.pending = [...win.pending.filter((p) => p.tabId !== tab.id), document];
		}
		return tab;
	}

	#place(payload: DocumentPayload, preferred: AppWindow | undefined): void {
		const candidate = preferred ?? this.focused() ?? this.all()[0];
		const target =
			candidate !== undefined && !candidate.window.isDestroyed() ? candidate : undefined;
		if (target === undefined) {
			this.open([{ tabId: randomUUID(), payload }]);
			return;
		}
		this.addTab(target, payload);
		if (target.window.isMinimized()) target.window.restore();
		target.window.focus();
	}

	/**
	 * Hands the pending documents to the renderer. A second call means the
	 * page was reloaded and lost its documents: saved ones are read again
	 * from disk, the rest start empty.
	 */
	async takePending(win: AppWindow): Promise<readonly TabDocument[]> {
		if (!win.ready) {
			win.ready = true;
			const pending = win.pending;
			win.pending = [];
			return pending;
		}

		const documents: TabDocument[] = [];
		for (const tab of win.tabs.values()) {
			let payload: DocumentPayload = { kind: "empty" };
			if (tab.path !== null) {
				try {
					payload = { kind: "file", file: await this.read(tab.path) };
				} catch {
					// The file is gone: fall back to an empty document.
				}
			}
			const document = { tabId: tab.id, payload };
			win.tabs.set(tab.id, this.#tabFor(win, document));
			documents.push(document);
		}
		this.#updateTitle(win);
		return documents;
	}

	/** Reads a document from disk; a package is unpacked into its working folder. */
	read(path: string): Promise<OpenedFile> {
		return isPackagePath(path)
			? this.#options.packages.open(path, this.#legacyEncoding())
			: readDocument(path, this.#legacyEncoding());
	}

	#releasePackage(path: string | null): void {
		if (path !== null && isPackagePath(path))
			void this.#options.packages.release(path).catch(() => {});
	}

	#legacyEncoding(): LegacyEncoding {
		return this.#options.language() === "tr" ? "windows-1254" : "windows-1252";
	}

	async reload(win: AppWindow, tabId: string): Promise<OpenedFile | null> {
		const tab = win.tabs.get(tabId);
		if (tab === undefined || tab.path === null) return null;
		const file = await this.read(tab.path);
		tab.modified = file.modified;
		tab.base = file.base ?? null;
		return file;
	}

	#showError(win: AppWindow | undefined, message: string, detail: string): void {
		const options = { type: "error" as const, message, detail };
		const window = win?.window;
		if (window !== undefined && !window.isDestroyed()) void dialog.showMessageBox(window, options);
		else void dialog.showMessageBox(options);
	}

	async openPath(path: string, preferred?: AppWindow): Promise<void> {
		const full = resolve(path);
		if (isWordPath(full)) return this.importWord(full, preferred);

		// A document that is already open is brought forward, not opened twice.
		const key = pathKey(full);
		for (const win of this.all()) {
			for (const tab of win.tabs.values()) {
				if (tab.path === null || pathKey(tab.path) !== key) continue;
				this.#activate(win, tab.id);
				if (win.window.isMinimized()) win.window.restore();
				win.window.focus();
				return;
			}
		}

		try {
			const file = await this.read(full);
			this.#place({ kind: "file", file }, preferred);
			this.#addRecentFile(full);
		} catch (error) {
			this.#removeRecentFile(full);
			this.#showError(
				preferred,
				this.#options.strings().openFailed,
				`${full}\n\n${errorMessage(error)}`,
			);
		}
	}

	async importWord(path: string, preferred?: AppWindow): Promise<void> {
		const t = this.#options.strings();
		try {
			const result = await readWord(await readFile(path));
			this.#place(
				{ kind: "word", word: { name: stripExtension(basename(path)), ...result } },
				preferred,
			);
		} catch (error) {
			const detail =
				error instanceof WordError && error.code === "legacy-format"
					? t.legacyWord
					: errorMessage(error);
			this.#showError(preferred, t.wordImportFailed, `${path}\n\n${detail}`);
		}
	}

	async showDialog(
		win: AppWindow | undefined,
		options: Electron.OpenDialogOptions,
	): Promise<string[]> {
		const result =
			win === undefined
				? await dialog.showOpenDialog(options)
				: await dialog.showOpenDialog(win.window, options);
		return result.canceled ? [] : result.filePaths;
	}

	async showOpenDialog(win: AppWindow | undefined): Promise<void> {
		const t = this.#options.strings();
		const paths = await this.showDialog(win, {
			defaultPath: this.defaultFolder(win),
			properties: ["openFile", "multiSelections"],
			filters: [
				{
					name: t.supportedDocuments,
					extensions: [...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS, ...PACKAGE_EXTENSIONS, "docx"],
				},
				{ name: t.markdownDocuments, extensions: [...MARKDOWN_EXTENSIONS] },
				{ name: t.textDocuments, extensions: [...TEXT_EXTENSIONS] },
				{ name: t.packages, extensions: [...PACKAGE_EXTENSIONS] },
				{ name: t.wordDocuments, extensions: ["docx"] },
				{ name: t.allFiles, extensions: ["*"] },
			],
		});
		// Sequential: the first may take over a blank tab, the rest must see it taken.
		for (const path of paths) await this.openPath(path, win);
	}

	async showWordDialog(win: AppWindow | undefined): Promise<void> {
		const paths = await this.showDialog(win, {
			defaultPath: this.defaultFolder(win),
			properties: ["openFile"],
			filters: [{ name: this.#options.strings().wordDocuments, extensions: ["docx"] }],
		});
		const path = paths[0];
		if (path !== undefined) await this.importWord(path, win);
	}

	defaultFolder(win: AppWindow | undefined): string {
		const path = win === undefined ? null : this.activeTab(win)?.path;
		if (path != null) return dirname(path);
		const recent = this.#options.store.state.recentFiles[0];
		return recent === undefined ? app.getPath("documents") : dirname(recent);
	}

	// --- External changes ---------------------------------------------------

	async #checkExternalChanges(win: AppWindow): Promise<void> {
		for (const tab of [...win.tabs.values()]) {
			if (tab.path === null || tab.modified === null) continue;
			const now = await modifiedTime(tab.path);
			if (now === null || now === tab.modified || win.window.isDestroyed()) continue;
			// Remember it so the user is asked only once per change.
			tab.modified = now;
			win.window.webContents.send(CHANNEL.externalChange, tab.id, now);
		}
	}

	// --- Links --------------------------------------------------------------

	/**
	 * Web links open in the browser and relative Markdown files open in the
	 * app. Anything else is only revealed in its folder: clicking a link in a
	 * document must never launch a program.
	 */
	async openLink(win: AppWindow, href: string): Promise<void> {
		if (/^(https?|mailto):/i.test(href)) {
			await shell.openExternal(href);
			return;
		}
		const tab = this.activeTab(win);
		const documentPath = tab?.base ?? tab?.path ?? null;
		if (/^[a-z][a-z0-9+.-]*:/i.test(href) || documentPath === null) return;

		let relative: string;
		try {
			relative = decodeURIComponent(href.replace(/[?#].*$/, ""));
		} catch {
			return;
		}
		if (relative === "") return;
		const target = resolve(dirname(documentPath), relative);
		if ((await modifiedTime(target)) === null) return;
		if (isEditablePath(target)) await this.openPath(target, win);
		else shell.showItemInFolder(target);
	}
}
