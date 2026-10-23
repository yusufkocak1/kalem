/**
 * The text editor: a window of its own for text files that are not Markdown
 * (.txt, .java, .json, .xml…). A file is shown and saved exactly as it is,
 * in its own encoding and line endings; nothing is turned into Markdown.
 */
import { stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { BrowserWindow, dialog, ipcMain } from "electron";
import type { TextDocument, TextEditorStartup } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { LegacyEncoding } from "../shared/encoding.js";
import { encodeText, toTextFormat } from "../shared/encoding.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { pathKey } from "./path-key.js";
import { readTextFile } from "./text-files.js";

export interface TextEditorOptions {
	readonly preloadPath: string;
	readonly devUrl: string | null;
	/** The page's file, next to the main window's `index.html`. */
	readonly pageFile: string;
	readonly icon: string;
	strings(): Strings;
	language(): Lang;
	legacyEncoding(): LegacyEncoding;
	backgroundColor(): string;
	spellCheck(): boolean;
	showContextMenu(contents: WebContents, params: Electron.ContextMenuParams): void;
	/** A file picked in the text editor's Open dialog: documents go to a Kalem window. */
	openPath(path: string): Promise<void>;
}

export class TextEditor {
	readonly #o: TextEditorOptions;
	#window: BrowserWindow | null = null;
	#ready = false;
	#pending: TextDocument[] = [];
	/** The files opened here, by path key, with their modification time when last read or written. */
	readonly #files = new Map<string, { path: string; modified: number }>();

	constructor(options: TextEditorOptions) {
		this.#o = options;
	}

	/** Whether `contents` is the text editor's page. */
	owns(contents: WebContents): boolean {
		return (
			this.#window !== null && !this.#window.isDestroyed() && this.#window.webContents === contents
		);
	}

	/**
	 * Opens a file in the text editor; `false` when it is not text (or too
	 * large), and nothing is opened. A file already open is brought forward.
	 */
	async open(path: string): Promise<boolean> {
		const file = await readTextFile(path, this.#o.legacyEncoding());
		if (file === null) return false;
		const document: TextDocument = {
			path,
			name: basename(path),
			text: file.text,
			format: file.format,
		};
		this.#files.set(pathKey(path), { path, modified: file.modified });
		const window = this.#show();
		if (this.#ready) window.webContents.send(CHANNEL.textOpen, document);
		else this.#pending.push(document);
		return true;
	}

	#show(): BrowserWindow {
		const existing = this.#window;
		if (existing !== null && !existing.isDestroyed()) {
			if (existing.isMinimized()) existing.restore();
			existing.focus();
			return existing;
		}
		const window = new BrowserWindow({
			width: 1000,
			height: 760,
			minWidth: 480,
			minHeight: 320,
			show: false,
			title: this.#o.strings().textEditor,
			icon: this.#o.icon,
			backgroundColor: this.#o.backgroundColor(),
			autoHideMenuBar: true,
			webPreferences: {
				preload: this.#o.preloadPath,
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
				spellcheck: this.#o.spellCheck(),
			},
		});
		// The app's menu acts on Markdown documents; this window has its own keys.
		window.removeMenu();
		this.#window = window;
		this.#ready = false;
		const contents = window.webContents;
		contents.on("will-navigate", (event) => event.preventDefault());
		contents.setWindowOpenHandler(() => ({ action: "deny" }));
		contents.on("context-menu", (_event, params) => this.#o.showContextMenu(contents, params));
		// The page asks before it unloads with unsaved changes; the question is asked here.
		contents.on("will-prevent-unload", (event) => {
			const t = this.#o.strings();
			const answer = dialog.showMessageBoxSync(window, {
				type: "warning",
				message: t.textUnsavedClose,
				buttons: [t.textCloseWithoutSaving, t.cancel],
				defaultId: 1,
				cancelId: 1,
			});
			if (answer === 0) event.preventDefault();
		});
		window.once("ready-to-show", () => window.show());
		window.on("closed", () => {
			if (this.#window === window) {
				this.#window = null;
				this.#ready = false;
				this.#pending = [];
				this.#files.clear();
			}
		});
		if (this.#o.devUrl !== null) {
			void window.loadURL(new URL("text-editor.html", this.#o.devUrl).toString());
		} else void window.loadFile(this.#o.pageFile);
		return window;
	}

	registerIpc(): void {
		const check = (event: IpcMainInvokeEvent | IpcMainEvent): void => {
			if (!this.owns(event.sender)) throw new Error("Not the text editor");
		};

		ipcMain.handle(CHANNEL.textReady, (event): TextEditorStartup => {
			check(event);
			this.#ready = true;
			const documents = this.#pending;
			this.#pending = [];
			return { language: this.#o.language(), documents };
		});

		ipcMain.handle(
			CHANNEL.textSave,
			async (event, path: unknown, text: unknown, rawFormat: unknown): Promise<boolean> => {
				check(event);
				if (typeof path !== "string" || typeof text !== "string") throw new Error("Invalid save");
				// Only files opened here are written.
				const known = this.#files.get(pathKey(path));
				if (known === undefined) throw new Error("This file was not opened in the text editor");
				const now = await stat(path).then(
					(info) => info.mtimeMs,
					() => null,
				);
				if (now !== null && now !== known.modified && this.#window !== null) {
					const t = this.#o.strings();
					const { response } = await dialog.showMessageBox(this.#window, {
						type: "warning",
						message: t.textChangedOnDisk,
						detail: path,
						buttons: [t.textOverwrite, t.cancel],
						defaultId: 1,
						cancelId: 1,
					});
					if (response !== 0) return false;
				}
				await writeFile(path, encodeText(text, toTextFormat(rawFormat)));
				known.modified = (await stat(path)).mtimeMs;
				return true;
			},
		);

		ipcMain.handle(CHANNEL.textOpenDialog, async (event, from: unknown) => {
			check(event);
			if (this.#window === null) return;
			const result = await dialog.showOpenDialog(this.#window, {
				properties: ["openFile", "multiSelections"],
				...(typeof from === "string" && from !== "" ? { defaultPath: dirname(from) } : {}),
			});
			if (result.canceled) return;
			for (const path of result.filePaths) await this.#o.openPath(path);
		});

		ipcMain.on(CHANNEL.textClose, (event, path: unknown) => {
			if (!this.owns(event.sender) || typeof path !== "string") return;
			this.#files.delete(pathKey(path));
		});
	}
}
