import type { ConfluenceFormat } from "./confluence.js";
import type { TextFormat } from "./encoding.js";
import type { Lang } from "./i18n.js";

export type Theme = "system" | "light" | "dark";

export const PAGE_SIZES = ["A4", "A3", "A5", "Letter", "Legal"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const PAGE_MARGINS = ["normal", "narrow", "wide"] as const;
export type PageMargins = (typeof PAGE_MARGINS)[number];

/** Portrait width and height in mm. */
export const PAGE_SIZE_MM: Readonly<Record<PageSize, readonly [number, number]>> = {
	A4: [210, 297],
	A3: [297, 420],
	A5: [148, 210],
	Letter: [215.9, 279.4],
	Legal: [215.9, 355.6],
};

/** Vertical and horizontal margin in cm, as Word's presets. */
export const MARGIN_CM: Readonly<Record<PageMargins, readonly [number, number]>> = {
	normal: [2.5, 2.5],
	narrow: [1.27, 1.27],
	wide: [2.54, 5.08],
};

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
	/** Page setup for printing and PDF export. */
	readonly pageSize: PageSize;
	readonly landscape: boolean;
	readonly margins: PageMargins;
	/** PDF export only: the print dialog has its own header and footer option. */
	readonly pageNumbers: boolean;
	/** What the side pane shows. */
	readonly sidePane: SidePane;
	/** The space the Confluence pane lists; empty for all spaces. */
	readonly confluenceSpace: string;
	/** Starred Confluence pages, shown at the top of the Confluence pane. */
	readonly confluenceFavorites: readonly ConfluenceFavorite[];
	/** Look for a new release once a day (a request to GitHub). */
	readonly checkUpdates: boolean;
	/** A notification-area icon and the system-wide quick note shortcut; the app stays there when its windows close. */
	readonly tray: boolean;
}

export type SidePane = "outline" | "files" | "confluence";

export const DEFAULT_SETTINGS: Settings = {
	theme: "system",
	language: null,
	zoom: 100,
	fullWidth: false,
	navigation: true,
	autoSave: false,
	spellCheck: true,
	pageSize: "A4",
	landscape: false,
	margins: "normal",
	pageNumbers: false,
	sidePane: "outline",
	confluenceSpace: "",
	confluenceFavorites: [],
	checkUpdates: true,
	tray: false,
};

/** The `@page` rule printing and PDF export lay the document out with. */
export function pageRule(settings: Settings): string {
	const [vertical, horizontal] = MARGIN_CM[settings.margins];
	const orientation = settings.landscape ? "landscape" : "portrait";
	return `@page { size: ${settings.pageSize} ${orientation}; margin: ${vertical}cm ${horizontal}cm; }`;
}

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

export interface ConfluenceContent {
	/** File name without extension; the suggested document name. */
	readonly name: string;
	/** Storage format or wiki markup, as read from the file. */
	readonly text: string;
}

/** A Confluence page a tab is bound to: saving the tab updates the page. */
export interface RemotePage {
	/** The site's REST base, e.g. `https://acme.atlassian.net/wiki`. */
	readonly site: string;
	readonly id: string;
	readonly title: string;
	readonly spaceKey: string;
	/** The page version the tab's text is based on. */
	readonly version: number;
	readonly webUrl: string;
}

export interface ConfluencePageContent {
	readonly page: RemotePage;
	/** Storage format (XHTML). */
	readonly storage: string;
}

export interface ConfluenceAccount {
	readonly site: string;
	/** Empty for a personal access token (Server / Data Center). */
	readonly username: string;
	readonly cloud: boolean;
}

export interface ConfluenceLogin {
	readonly site: string;
	readonly username: string;
	readonly token: string;
}

export interface ConfluenceSpace {
	readonly key: string;
	readonly name: string;
}

/** A page in the space's page tree. */
export interface ConfluenceTreePage {
	readonly id: string;
	readonly title: string;
	/** `null` when the server does not say (Cloud): the page may be expanded to find out. */
	readonly hasChildren: boolean | null;
}

/** Where a level of the page tree hangs: a space's top-level pages or a page's children. */
export type ConfluenceTreeParent =
	| { readonly space: string; readonly page?: undefined }
	| { readonly page: string; readonly space?: undefined };

export interface ConfluenceNewPage {
	readonly space: string;
	/** The parent page; `null` for a top-level page. */
	readonly parent: string | null;
	readonly title: string;
}

/** A page the user starred; kept per site in the settings. */
export interface ConfluenceFavorite {
	readonly site: string;
	readonly id: string;
	readonly title: string;
}

export interface ConfluencePageSummary {
	readonly id: string;
	readonly title: string;
	readonly spaceName: string;
	/** ISO date, when the server reports it. */
	readonly modified: string | null;
}

export interface ConfluenceSaveRequest {
	readonly storage: string;
	readonly version: number;
	/** Content of the page that has no Markdown equivalent; the user confirms losing it. */
	readonly losses: readonly string[];
	/** Save over a newer version on the server. */
	readonly overwrite: boolean;
}

export type ConfluenceSaveResult =
	| { readonly ok: true; readonly page: RemotePage }
	| { readonly ok: false; readonly reason: "conflict" | "cancelled" };

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
	readonly remote?: RemotePage;
}

export type DocumentPayload =
	| { readonly kind: "empty" }
	| { readonly kind: "file"; readonly file: OpenedFile }
	| { readonly kind: "word"; readonly word: WordContent }
	| { readonly kind: "confluence"; readonly confluence: ConfluenceContent }
	| { readonly kind: "confluence-page"; readonly content: ConfluencePageContent }
	| { readonly kind: "draft"; readonly draft: Draft }
	/** An empty document that saves to `path` without asking; the file appears on first save. */
	| { readonly kind: "new-file"; readonly path: string; readonly name: string }
	/** A tab moved over from another window, with its unsaved edits. */
	| { readonly kind: "moved"; readonly draft: Draft; readonly dirty: boolean }
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

/** What the renderer knows of a tab that is moving to another window. */
export interface MovedTab {
	readonly text: string;
	readonly format: TextFormat;
	readonly dirty: boolean;
}

export interface WorkspaceEntry {
	readonly path: string;
	readonly name: string;
	/** Nesting below the workspace root, from 0. */
	readonly depth: number;
	readonly folder: boolean;
}

export interface Workspace {
	/** `null` when no folder is open and the active document has never been saved. */
	readonly root: string | null;
	/** Opened with Open Folder, rather than the active document's folder. */
	readonly opened: boolean;
	readonly entries: readonly WorkspaceEntry[];
	readonly truncated: boolean;
}

export interface SearchHit {
	readonly path: string;
	/** Path below the workspace root, with `/`. */
	readonly relative: string;
	/** From 1. */
	readonly line: number;
	readonly column: number;
	readonly text: string;
}

export interface Version {
	/** Opaque; pass back to `readVersion`. */
	readonly id: string;
	/** When it was saved, in ms. */
	readonly time: number;
	/** In bytes. */
	readonly size: number;
}

export interface SearchResult {
	readonly hits: readonly SearchHit[];
	readonly truncated: boolean;
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
	"export-docx",
	"export-confluence",
	"export-confluence-wiki",
	"confluence-open",
	"quick-open",
	"search-folder",
	"version-history",
	"move-tab",
	"case-upper",
	"case-lower",
	"case-title",
	"case-sentence",
	"case-toggle",
	"case-cycle",
	"collapse-spaces",
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
	importConfluence(): Promise<void>;

	confluenceAccount(): Promise<ConfluenceAccount | null>;
	/** Checks the login against the site and remembers it; the token never comes back. */
	confluenceConnect(login: ConfluenceLogin): Promise<ConfluenceAccount>;
	confluenceDisconnect(): Promise<void>;
	confluenceSpaces(): Promise<readonly ConfluenceSpace[]>;
	/** One level of a space's page tree. */
	confluenceTree(parent: ConfluenceTreeParent): Promise<readonly ConfluenceTreePage[]>;
	/** Creates an empty page (under `parent`, or at the top of the space) and opens it in a tab. */
	confluenceCreatePage(request: ConfluenceNewPage): Promise<ConfluenceTreePage>;
	/** Recently changed pages, filtered by title and space when given. */
	confluenceSearch(
		query: string,
		spaceKey: string | null,
	): Promise<readonly ConfluencePageSummary[]>;
	/** Opens the page in a tab of this window. */
	confluenceOpenPage(pageId: string): Promise<void>;
	confluenceReloadPage(tabId: string): Promise<ConfluencePageContent>;
	confluenceSavePage(tabId: string, request: ConfluenceSaveRequest): Promise<ConfluenceSaveResult>;
	/** Attaches the image to the tab's page; resolves with the attachment's file name. */
	confluenceAttachImage(tabId: string, image: ImageFile): Promise<string>;
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
	/** Converts the tab's Markdown to Word; images resolve against the tab's document. */
	writeDocx(tabId: string, suggestedName: string, markdown: string): Promise<boolean>;
	writeConfluence(suggestedName: string, text: string, format: ConfluenceFormat): Promise<boolean>;

	updateSettings(patch: Partial<Settings>): void;
	clipboard(action: "cut" | "copy" | "paste"): void;
	openLink(href: string): void;
	showFileMenu(x: number, y: number): void;
	showTabMenu(tabId: string, x: number, y: number): void;
	showCaseMenu(x: number, y: number): void;
	/** Moves a tab into a new window, placed at the screen point when given. */
	moveTabToWindow(tabId: string, tab: MovedTab, at?: { x: number; y: number }): void;
	/** The tab now lives in another window; drop it without asking. */
	onTabMoved(handler: (tabId: string) => void): () => void;
	/** The tab menu asked for something to be done with a tab. */
	onTabMenu(handler: (tabId: string, action: "move" | "close") => void): () => void;
	pathForFile(file: File): string;

	onCommand(handler: (command: Command) => void): () => void;
	onDocument(handler: (document: TabDocument) => void): () => void;
	onActivateTab(handler: (tabId: string) => void): () => void;
	/** The main process wants a tab saved (while closing the window). */
	onSaveRequest(handler: (tabId: string) => void): () => void;
	onSettings(handler: (settings: Settings) => void): () => void;
	onExternalChange(handler: (tabId: string, modified: number) => void): () => void;

	/** The open folder, or the active document's folder. */
	getWorkspace(): Promise<Workspace>;
	openFolder(): Promise<void>;
	closeFolder(): void;
	searchWorkspace(query: string): Promise<SearchResult>;

	/** Earlier saved states of the tab's document, newest first. */
	listVersions(tabId: string): Promise<readonly Version[]>;
	readVersion(tabId: string, id: string): Promise<string>;
	/** The open folder changed, in this window or another. */
	onWorkspaceChange(handler: () => void): () => void;
}

export const CHANNEL = {
	getStartup: "kalem:get-startup",
	newWindow: "kalem:new-window",
	newTab: "kalem:new-tab",
	showOpenDialog: "kalem:show-open-dialog",
	openPath: "kalem:open-path",
	importWord: "kalem:import-word",
	importConfluence: "kalem:import-confluence",
	confluenceAccount: "kalem:confluence-account",
	confluenceConnect: "kalem:confluence-connect",
	confluenceDisconnect: "kalem:confluence-disconnect",
	confluenceSpaces: "kalem:confluence-spaces",
	confluenceTree: "kalem:confluence-tree",
	confluenceCreatePage: "kalem:confluence-create-page",
	confluenceSearch: "kalem:confluence-search",
	confluenceOpenPage: "kalem:confluence-open-page",
	confluenceReloadPage: "kalem:confluence-reload-page",
	confluenceSavePage: "kalem:confluence-save-page",
	confluenceAttachImage: "kalem:confluence-attach-image",
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
	writeDocx: "kalem:write-docx",
	writeConfluence: "kalem:write-confluence",
	updateSettings: "kalem:update-settings",
	clipboard: "kalem:clipboard",
	openLink: "kalem:open-link",
	showFileMenu: "kalem:show-file-menu",
	showTabMenu: "kalem:show-tab-menu",
	showCaseMenu: "kalem:show-case-menu",
	moveTabToWindow: "kalem:move-tab-to-window",
	tabMoved: "kalem:tab-moved",
	tabMenu: "kalem:tab-menu",
	command: "kalem:command",
	document: "kalem:document",
	activateTab: "kalem:activate-tab",
	saveRequest: "kalem:save-request",
	settings: "kalem:settings",
	externalChange: "kalem:external-change",
	getWorkspace: "kalem:get-workspace",
	openFolder: "kalem:open-folder",
	closeFolder: "kalem:close-folder",
	searchWorkspace: "kalem:search-workspace",
	workspaceChange: "kalem:workspace-change",
	listVersions: "kalem:list-versions",
	readVersion: "kalem:read-version",
} as const;
