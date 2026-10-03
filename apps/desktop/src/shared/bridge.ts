import type { TextFormat } from "./encoding.js";
import type { Lang } from "./i18n.js";

export type Theme = "system" | "light" | "dark";

export interface Settings {
	readonly theme: Theme;
	/** `null` follows the operating system. */
	readonly language: Lang | null;
	/** Document zoom in percent. */
	readonly zoom: number;
	readonly fullWidth: boolean;
	readonly navigation: boolean;
	readonly autoSave: boolean;
	readonly spellCheck: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	theme: "system",
	language: null,
	zoom: 100,
	fullWidth: false,
	navigation: true,
	autoSave: false,
	spellCheck: true,
};

export const MIN_ZOOM = 50;
export const MAX_ZOOM = 200;
export const ZOOM_STEP = 10;

export function clampZoom(value: number): number {
	if (!Number.isFinite(value)) return 100;
	const snapped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, snapped));
}

export interface OpenedFile {
	readonly path: string;
	readonly name: string;
	/** LF line endings, no BOM. */
	readonly text: string;
	readonly format: TextFormat;
	/** mtime in ms, used to detect external changes. */
	readonly modified: number;
	/** What relative links resolve against when it is not `path`: a package's unpacked text. */
	readonly base?: string;
}

export interface WordContent {
	/** File name without extension; the suggested document name. */
	readonly name: string;
	readonly html: string;
	readonly warnings: readonly string[];
	readonly skippedImages: number;
}

/** An unsaved document left over from a session that did not exit cleanly. */
export interface Draft {
	readonly id: string;
	readonly path: string | null;
	readonly name: string;
	readonly text: string;
	readonly format: TextFormat;
	readonly time: number;
	/** See `OpenedFile.base`. */
	readonly base?: string;
}

export type DocumentPayload =
	| { readonly kind: "empty" }
	| { readonly kind: "file"; readonly file: OpenedFile }
	| { readonly kind: "word"; readonly word: WordContent }
	| { readonly kind: "draft"; readonly draft: Draft }
	| { readonly kind: "welcome" };

/** A document and the tab it belongs to. An existing tab id means "load into that tab". */
export interface TabDocument {
	readonly tabId: string;
	readonly payload: DocumentPayload;
}

export interface Startup {
	readonly settings: Settings;
	readonly language: Lang;
	readonly platform: string;
	readonly version: string;
	/** One entry per tab; the last one is the active tab. */
	readonly documents: readonly TabDocument[];
	/** URL scheme that serves document-relative images. */
	readonly documentScheme: string;
}

export interface WindowState {
	readonly name: string;
	readonly dirty: boolean;
}

export type CloseChoice = "save" | "discard" | "cancel";

export interface SaveResult {
	/** New mtime of the file. */
	readonly modified: number;
	/**
	 * Set when the saved document differs from what the editor shows: its links
	 * were moved along with the files, or it became a package. Load it.
	 */
	readonly file?: OpenedFile;
}

export interface ImageFile {
	readonly name: string;
	readonly type: string;
	readonly bytes: Uint8Array;
}

/** A file copied next to the document, ready to be linked. */
export interface Attachment {
	readonly name: string;
	/** Relative URL for the Markdown link. */
	readonly url: string;
}

export interface DraftRequest {
	readonly name: string;
	readonly text: string;
	readonly format: TextFormat;
}

export const COMMANDS = [
	"save",
	"save-as",
	"save-as-package",
	"close-tab",
	"next-tab",
	"previous-tab",
	"undo",
	"redo",
	"paste-plain",
	"find",
	"replace",
	"image",
	"attach-file",
	"table",
	"link",
	"divider",
	"code-block",
	"quote",
	"task-list",
	"bold",
	"italic",
	"strikethrough",
	"inline-code",
	"paragraph",
	"heading-1",
	"heading-2",
	"heading-3",
	"heading-4",
	"heading-5",
	"heading-6",
	"bullet-list",
	"ordered-list",
	"indent",
	"outdent",
	"merge-blocks",
	"source",
	"read-only",
	"focus",
	"zoom-in",
	"zoom-out",
	"zoom-reset",
	"export-html",
	"format-code",
	"format-all-code",
] as const;

export type Command = (typeof COMMANDS)[number];

/** `window.kalem` as seen by the renderer. */
export interface KalemBridge {
	getStartup(): Promise<Startup>;

	newWindow(): void;
	newTab(): void;
	showOpenDialog(): Promise<void>;
	openPath(path: string): Promise<void>;
	importWord(): Promise<void>;
	/** `package` proposes a `.kmd`; otherwise Markdown (or the tab's current type) comes first. */
	chooseSavePath(tabId: string, suggestedName: string, kind?: "package"): Promise<string | null>;
	writeDocument(tabId: string, path: string, text: string, format: TextFormat): Promise<SaveResult>;
	reloadDocument(tabId: string): Promise<OpenedFile | null>;
	reportState(tabId: string, state: WindowState): void;
	tabActivated(tabId: string): void;
	/** Asks the user what to do with an unsaved tab that is about to close. */
	confirmCloseTab(tabId: string): Promise<CloseChoice>;
	tabClosed(tabId: string): void;
	/** Reply to `onSaveRequest`. */
	answerSave(tabId: string, saved: boolean): void;

	/** Writes the image next to the document; resolves with the relative URL for Markdown. */
	writeImage(documentPath: string, image: ImageFile): Promise<string>;
	pickImages(): Promise<readonly ImageFile[]>;
	/** Lets the user pick files and copies them next to the document. */
	pickAttachments(documentPath: string): Promise<readonly Attachment[]>;
	/** Copies the given files (dropped onto the window) next to the document. */
	attachPaths(documentPath: string, paths: readonly string[]): Promise<readonly Attachment[]>;

	writeDraft(tabId: string, request: DraftRequest): Promise<void>;
	deleteDraft(tabId: string): Promise<void>;

	writeHtml(suggestedName: string, html: string): Promise<boolean>;

	updateSettings(patch: Partial<Settings>): void;
	clipboard(action: "cut" | "copy" | "paste"): void;
	openLink(href: string): void;
	showFileMenu(x: number, y: number): void;
	pathForFile(file: File): string;

	onCommand(handler: (command: Command) => void): () => void;
	onDocument(handler: (document: TabDocument) => void): () => void;
	onActivateTab(handler: (tabId: string) => void): () => void;
	/** The main process wants a tab saved (while closing the window). */
	onSaveRequest(handler: (tabId: string) => void): () => void;
	onSettings(handler: (settings: Settings) => void): () => void;
	onExternalChange(handler: (tabId: string, modified: number) => void): () => void;
}

export const CHANNEL = {
	getStartup: "kalem:get-startup",
	newWindow: "kalem:new-window",
	newTab: "kalem:new-tab",
	showOpenDialog: "kalem:show-open-dialog",
	openPath: "kalem:open-path",
	importWord: "kalem:import-word",
	chooseSavePath: "kalem:choose-save-path",
	writeDocument: "kalem:write-document",
	reloadDocument: "kalem:reload-document",
	reportState: "kalem:report-state",
	tabActivated: "kalem:tab-activated",
	confirmCloseTab: "kalem:confirm-close-tab",
	tabClosed: "kalem:tab-closed",
	answerSave: "kalem:answer-save",
	writeImage: "kalem:write-image",
	pickImages: "kalem:pick-images",
	pickAttachments: "kalem:pick-attachments",
	attachPaths: "kalem:attach-paths",
	writeDraft: "kalem:write-draft",
	deleteDraft: "kalem:delete-draft",
	writeHtml: "kalem:write-html",
	updateSettings: "kalem:update-settings",
	clipboard: "kalem:clipboard",
	openLink: "kalem:open-link",
	showFileMenu: "kalem:show-file-menu",
	command: "kalem:command",
	document: "kalem:document",
	activateTab: "kalem:activate-tab",
	saveRequest: "kalem:save-request",
	settings: "kalem:settings",
	externalChange: "kalem:external-change",
} as const;
