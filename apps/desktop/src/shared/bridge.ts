import type { ChatSummary, StoredChat } from "./chats.js";
import type { ClaudeEvent, PromptImage } from "./claude.js";
import type { ConfluenceFormat } from "./confluence.js";
import type { AtomDetails } from "./confluence-atoms.js";
import type { JiraServer, MentionUser } from "./confluence-insert.js";
import type { ConfluenceSearchRequest, ConfluenceSearchResults } from "./confluence-search.js";
import type { CustomMode } from "./custom-modes.js";
import type { TextFormat } from "./encoding.js";
import type { Lang } from "./i18n.js";
import type { JiraAccount, JiraIssue, JiraSearchResults } from "./jira.js";
import type {
	DevelopmentItem,
	DevelopmentKind,
	DevelopmentSummary,
	JiraTransition,
} from "./jira-dev.js";
import type { WorklogContext, WorklogEntry } from "./jira-worklog.js";
import type { LocalNote } from "./local-notes.js";
import type { ModeSettings } from "./mode-config.js";
import type { ModelOption } from "./models.js";
import type { PaletteChoice, PaletteTheme } from "./palette.js";
import { PALETTES } from "./palette.js";
import type { PanePlaces, ToolPane } from "./panes.js";
import { DEFAULT_PANE_PLACES } from "./panes.js";
import type { AssistantConfig, AssistantUpdate, ChatMessage, ProviderId } from "./providers.js";
import type { TemplateInfo } from "./templates.js";
import type { ApprovalAnswer, ApprovalRequest } from "./tool-protocol.js";
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
	/** The app's colours: a made palette, or the user's own (`paletteCustom`). */
	readonly palette: PaletteChoice;
	/** The user's own colours, for each theme. */
	readonly paletteCustom: PaletteTheme;
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
	/** What the side pane (the left dock) shows. */
	readonly sidePane: SidePane;
	/** Where each tool pane is: the left, right or bottom dock, or hidden. */
	readonly panePlaces: PanePlaces;
	/** The right dock: open or not, what it shows, its width. */
	readonly rightDock: boolean;
	readonly rightPane: ToolPane;
	readonly rightWidth: number;
	/** The bottom dock, under the document: open or not, what it shows, its height. */
	readonly bottomDock: boolean;
	readonly bottomPane: ToolPane;
	readonly bottomHeight: number;
	/** The space the Confluence pane lists; empty for all spaces. */
	readonly confluenceSpace: string;
	/** Starred Confluence pages, shown at the top of the Confluence pane. */
	readonly confluenceFavorites: readonly ConfluenceFavorite[];
	/** Saving a Confluence page shows what changed in it first, to check before it is written. */
	readonly confluenceReviewBeforeSave: boolean;
	/** The user's own notes (balloons beside the text, kept on this computer) are shown. */
	readonly localNotes: boolean;
	/** Jira issues the user starred, newest first. */
	readonly jiraFavorites: readonly JiraFavorite[];
	/** Documents pinned to the start page, in the order they were pinned. */
	readonly pinnedFiles: readonly string[];
	/** Look for a new release once a day (a request to GitHub). */
	readonly checkUpdates: boolean;
	/** A notification-area icon and the system-wide quick note shortcut; the app stays there when its windows close. */
	readonly tray: boolean;
	/** Fetch the open folders' repositories in the background now and then. */
	readonly gitAutoFetch: boolean;
	/** The Claude assistant's panel, at the right of the document. */
	readonly assistant: boolean;
	/** Share the active document with Claude along with each question. */
	readonly assistantDocument: boolean;
	/** The Claude Code CLI the user picked; empty to look for it. */
	readonly claudePath: string;
	/** The GitHub Copilot CLI the user picked; empty to look for it. */
	readonly copilotPath: string;
	/** The assistant panel's width in pixels. */
	readonly assistantWidth: number;
	/** The navigation pane's width in pixels. */
	readonly navigationWidth: number;
	/** The kinds of change the user allowed the assistant always (`settings:appearance`, `document`…). */
	readonly assistantPermissions: readonly string[];
	/** How Copilot reaches Kalem's tools: through MCP, in blocks, or whichever works. */
	readonly copilotTools: CopilotTools;
	/** The analysis template new documents start from and reviews check against; empty for the built-in one. */
	readonly defaultTemplate: string;
	/** The assistant's modes as the user shaped them: steps, options; what is missing is the default. */
	readonly assistantModes: ModeSettings;
	/** Modes the user made: their instructions, steps, tools and MCP servers. */
	readonly assistantCustomModes: readonly CustomMode[];
	/** Where the assistant's panel is: at the right (as before), at the left, or under the document. */
	readonly assistantPlace: AssistantPlace;
	/** The assistant panel's height under the document, in pixels. */
	readonly assistantHeight: number;
}

export type AssistantPlace = "right" | "left" | "bottom";

export type CopilotTools = "auto" | "mcp" | "block";

export type SidePane = ToolPane;

export const DEFAULT_SETTINGS: Settings = {
	theme: "system",
	palette: "kalem",
	paletteCustom: PALETTES.kalem,
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
	panePlaces: DEFAULT_PANE_PLACES,
	rightDock: false,
	rightPane: "outline",
	rightWidth: 280,
	bottomDock: false,
	bottomPane: "outline",
	bottomHeight: 240,
	confluenceSpace: "",
	confluenceFavorites: [],
	confluenceReviewBeforeSave: true,
	localNotes: true,
	jiraFavorites: [],
	pinnedFiles: [],
	checkUpdates: true,
	tray: false,
	gitAutoFetch: true,
	assistant: false,
	assistantDocument: true,
	claudePath: "",
	copilotPath: "",
	assistantWidth: 380,
	navigationWidth: 248,
	assistantPermissions: [],
	copilotTools: "auto",
	defaultTemplate: "",
	assistantModes: {},
	assistantCustomModes: [],
	assistantPlace: "right",
	assistantHeight: 320,
};

export const MIN_ASSISTANT_WIDTH = 280;
export const MAX_ASSISTANT_WIDTH = 1200;

export function clampAssistantWidth(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_SETTINGS.assistantWidth;
	return Math.round(Math.min(MAX_ASSISTANT_WIDTH, Math.max(MIN_ASSISTANT_WIDTH, value)));
}

export const MIN_NAVIGATION_WIDTH = 200;
export const MAX_NAVIGATION_WIDTH = 720;

export function clampNavigationWidth(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_SETTINGS.navigationWidth;
	return Math.round(Math.min(MAX_NAVIGATION_WIDTH, Math.max(MIN_NAVIGATION_WIDTH, value)));
}

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

/** A file attached to a Confluence page. */
export interface ConfluenceAttachment {
	readonly id: string;
	readonly name: string;
	/** Bytes; `null` when Confluence did not say. */
	readonly size: number | null;
	readonly mediaType: string;
	/** When this version was uploaded (ms), `null` when unknown. */
	readonly modified: number | null;
	/** Who uploaded this version; empty on Cloud, which only gives an account id. */
	readonly author: string;
	readonly version: number;
}

/** A diagram's PNG and its data file, new or replacing existing files. */
export interface DiagramWrite {
	readonly bytes: Uint8Array;
	/** The diagram's data, written to `<name>.diagram.json` next to the picture. */
	readonly data: string;
	/** For a new diagram. */
	readonly title?: string;
	/** The document's URL of the diagram being replaced. */
	readonly url?: string;
	/** The attachment being replaced, on a Confluence page. */
	readonly name?: string;
}

/** A file uploaded to the page, ready to be linked. */
export interface ConfluenceUpload {
	readonly name: string;
	/** Markdown URL of the attachment. */
	readonly url: string;
	readonly image: boolean;
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

/** A local document published as a new page: where, under which title, and what it says. */
export interface ConfluencePublishRequest {
	readonly space: string;
	/** The parent page; `null` for a top-level page. */
	readonly parent: string | null;
	readonly title: string;
	/** The document's Markdown; its local pictures and files go as attachments. */
	readonly markdown: string;
	/** Open the new page in a tab of this window. */
	readonly open: boolean;
}

export interface ConfluencePublished {
	readonly id: string;
	readonly title: string;
	readonly url: string;
	readonly spaceKey: string;
	/** How many of the document's files were attached. */
	readonly attached: number;
	/** The document's files that could not be read, as it names them. */
	readonly missing: readonly string[];
}

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
	/** The group the user put it in; none when missing. */
	readonly group?: string;
}

/** A Jira issue the user starred: what the list shows of it until Jira says more. */
export interface JiraFavorite {
	readonly site: string;
	readonly key: string;
	readonly summary: string;
	readonly type: string;
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
	/** The user saved from the page's changes, having seen them: no second question. */
	readonly reviewed?: boolean;
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
	/** The page's storage the text was made from; unchanged parts are written back from it. */
	readonly storage?: string;
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

/** One folder of the workspace with what is in it. */
export interface WorkspaceRoot {
	readonly path: string;
	readonly entries: readonly WorkspaceEntry[];
	readonly truncated: boolean;
	/** The git repository the folder is in; `null` when it is in none. */
	readonly git: GitStatus | null;
}

/** Where a git repository stands. */
export interface GitStatus {
	/** The repository's top folder. */
	readonly root: string;
	/** `null` when no branch is checked out (detached HEAD). */
	readonly branch: string | null;
	/** The branch it follows, as `origin/main`; `null` when none. */
	readonly upstream: string | null;
	/** Commits not pushed yet. */
	readonly ahead: number;
	/** Commits not pulled yet. */
	readonly behind: number;
	/** Files changed, added or not tracked. */
	readonly changed: number;
	/** The changed files, at most a few thousand. */
	readonly files: readonly GitFileChange[];
	/** Files with unresolved conflicts. */
	readonly conflicts: number;
	/** A merge, rebase or cherry-pick that stopped half-way (on a conflict). */
	readonly operation: GitOperation | null;
}

export type GitOperation = "merge" | "rebase" | "cherry-pick";

export type GitChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

export interface GitFileChange {
	/** Below the repository's top folder, with `/`. */
	readonly path: string;
	readonly kind: GitChangeKind;
}

export interface GitBranch {
	readonly name: string;
	/** The remote of a branch that is only there, as `origin`; `null` for a local branch. */
	readonly remote: string | null;
	readonly current: boolean;
}

/** What the Files pane can ask git to do in an open folder. */
export type GitAction =
	| { readonly kind: "fetch" | "push" | "init" | "abort" | "continue" }
	/** `how` when the branches went apart: merge them or put ours on top; git's setting otherwise. */
	| { readonly kind: "pull"; readonly how?: "merge" | "rebase" }
	/** Puts back the last commit's version of the files; new files go to the recycle bin. */
	| { readonly kind: "discard"; readonly paths: readonly string[] }
	| { readonly kind: "checkout"; readonly branch: string }
	| { readonly kind: "create-branch"; readonly branch: string }
	/** Without `paths`, every change; with them, only those files. */
	| { readonly kind: "commit"; readonly message: string; readonly paths?: readonly string[] };

export interface Workspace {
	/**
	 * The folders opened with Open Folder; without any, the active document's
	 * folder. Empty when no folder is open and the document was never saved.
	 */
	readonly roots: readonly WorkspaceRoot[];
	/** Opened with Open Folder, rather than the active document's folder. */
	readonly opened: boolean;
}

export interface SearchHit {
	readonly path: string;
	/** Path below the workspace root, with `/`; with several roots, from the root's name. */
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

/** Whether the assistant can be asked, with the service it uses. */
export interface AssistantStatus {
	readonly provider: ProviderId;
	/** The model in use; empty when a CLI chooses. */
	readonly model: string;
	readonly ready: boolean;
	/** Under the panel's title: the CLI's version, or the service and its model. */
	readonly label: string;
	/** The CLI's path or the service's address. */
	readonly detail: string;
	/** What keeps it from being ready: the CLI is not installed, or the service is not set up. */
	readonly missing: "cli" | "setup" | null;
}

/** One question to the assistant; the reply comes through `onAssistantEvent`. */
export interface AssistantRequest {
	/** The chat the reply belongs to. */
	readonly chatId: string;
	readonly prompt: string;
	/** The conversation to continue; `null` starts one. */
	readonly sessionId: string | null;
	/** The active tab: a new conversation runs in its document's folder. */
	readonly tabId: string | null;
	/** The folder a CLI conversation ran in, as the chat remembers it. */
	readonly folder: string | null;
	/** The chat so far, for an API that has not seen it in this run. */
	readonly history: readonly ChatMessage[];
	/** The document's pictures, for the model to look at. */
	readonly images?: readonly PromptImage[];
	/** Files and folders added to the chat, whose text goes with the question. */
	readonly sources?: readonly string[];
	/** The question with the whole document in it, when `prompt` has only its outline. */
	readonly fullPrompt?: string;
	/** The active document, for the tools to read and change; left out when it is not shared. */
	readonly document?: {
		readonly tabId: string;
		readonly name: string;
		readonly text: string;
		readonly selection: string;
	};
	/** What the user is doing with the assistant: asking, writing, reviewing… */
	readonly mode?: string;
}

/** A tool's part that the window runs: the document's change, a command. */
export interface AssistantToolCall {
	readonly id: string;
	readonly chatId: string;
	readonly name: string;
	readonly input: unknown;
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
	"diagram",
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
	"publish-confluence",
	"confluence-changes",
	"note-new",
	"note-next",
	"note-previous",
	"notes-toggle",
	"confluence-open",
	"quick-open",
	"search-folder",
	"version-history",
	"confluence-attachments",
	"jira-open",
	"settings",
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
	"assistant",
	"new-from-template",
	"command-palette",
] as const;

/** A command of the application menu, as the command palette lists it. */
export interface PaletteCommand {
	/** Where it is in the menu; what it is run by. */
	readonly id: string;
	readonly label: string;
	/** The menus it is under: "File › Export". */
	readonly group: string;
	/** As the menu shows it; empty when it has none. */
	readonly accelerator: string;
	/** For a check or radio item, whether it is on; `null` for the rest. */
	readonly checked: boolean | null;
}

export type Command = (typeof COMMANDS)[number];

/** `window.kalem` as seen by the renderer. */
export interface KalemBridge {
	getStartup(): Promise<Startup>;

	newWindow(): void;
	newTab(): void;
	showOpenDialog(): Promise<void>;
	openPath(path: string): Promise<void>;
	/** The documents opened last, newest first. */
	recentFiles(): Promise<readonly string[]>;
	/** The application menu's commands, for the command palette. */
	paletteCommands(): Promise<readonly PaletteCommand[]>;
	/** Runs one of them, in this window. */
	runPaletteCommand(id: string): void;
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
	/** Publishes the tab's document as a new page, with its local files attached. */
	confluencePublish(tabId: string, request: ConfluencePublishRequest): Promise<ConfluencePublished>;
	/** Recently changed pages, filtered by title and space when given. */
	/** The side pane's search: titles or whole pages, with filters, excerpts and more results. */
	confluenceFind(request: ConfluenceSearchRequest): Promise<ConfluenceSearchResults>;
	/** A kept atom of the tab's page described, with what the server knows (a user's name, Jira's address). */
	confluenceAtom(tabId: string, xml: string): Promise<AtomDetails | null>;
	/** Users of the connected site whose name matches, to mention. */
	confluenceUsers(query: string): Promise<readonly MentionUser[]>;
	/** The Jira server new Jira macros on the connected site name; `null` when it lists none. */
	confluenceJiraServer(): Promise<JiraServer | null>;
	/** The ids of the pages above a page, top first. */
	confluenceAncestors(pageId: string): Promise<readonly string[]>;
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
	/**
	 * Uploads a diagram to the tab's page: a new attachment named after
	 * `title`, or a new version of `name`.
	 */
	confluenceWriteDiagram(tabId: string, diagram: DiagramWrite): Promise<ConfluenceUpload>;
	/** The files attached to the tab's page. */
	confluenceAttachments(tabId: string): Promise<readonly ConfluenceAttachment[]>;
	/** Uploads files to the tab's page; without paths the user picks them. */
	confluenceUploadFiles(
		tabId: string,
		paths?: readonly string[],
	): Promise<readonly ConfluenceUpload[]>;
	/** Opens a copy of the attachment in the system's app for it. */
	confluenceOpenAttachment(tabId: string, name: string): Promise<void>;
	/** Saves the attachment where the user picks; resolves with that path, `null` if cancelled. */
	confluenceDownloadAttachment(tabId: string, name: string): Promise<string | null>;
	/** Asks, then deletes; `used` tells the question that the page links to it. */
	confluenceDeleteAttachment(
		tabId: string,
		attachment: { readonly id: string; readonly name: string; readonly used: boolean },
	): Promise<boolean>;
	/** The Jira connection: its own, or Confluence Cloud's login on the same site; `null` when none. */
	jiraAccount(): Promise<JiraAccount | null>;
	/** Checks the login against the site and remembers it; the token never comes back. */
	jiraConnect(login: ConfluenceLogin): Promise<JiraAccount>;
	jiraDisconnect(): Promise<void>;
	/** Jira's address as Confluence knows it (its Jira macro's servers), to fill in the login. */
	jiraSuggestedSite(): Promise<string | null>;
	jiraIssue(key: string): Promise<JiraIssue>;
	/** A search by JQL, an issue key or words; `next` continues an earlier answer. */
	jiraSearch(query: string, next: string | null): Promise<JiraSearchResults>;
	/** The steps the issue can take from its status. */
	jiraTransitions(key: string): Promise<JiraTransition[]>;
	/** Moves the issue along its workflow. */
	jiraTransition(key: string, transitionId: string): Promise<void>;
	/** The issue's Development panel: branches, commits, pull requests; `null` where Jira has none. */
	jiraDevelopment(issueId: string): Promise<DevelopmentSummary | null>;
	jiraDevelopmentDetail(issueId: string, kind: DevelopmentKind): Promise<DevelopmentItem[]>;
	/** What logging work on the issue asks for: Tempo's fields (when it is installed), the time spent and left. */
	jiraWorklogContext(key: string): Promise<WorklogContext>;
	/** Logs work on the issue; `offsetMinutes` is the local time zone's, for Jira's own work log. */
	jiraLogWork(key: string, entry: WorklogEntry & { readonly offsetMinutes: number }): Promise<void>;
	/** `package` proposes a `.kmd`; otherwise Markdown (or the tab's current type) comes first. */
	/** `kind` "text": a text file, saved under any name with its own extension offered. */
	chooseSavePath(
		tabId: string,
		suggestedName: string,
		kind?: "package" | "text",
	): Promise<string | null>;
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
	/**
	 * Writes a diagram next to the document (or into its package): a new file
	 * named after `title`, or over the one at `url`. Resolves with its URL.
	 */
	writeDiagram(documentPath: string, diagram: DiagramWrite): Promise<string>;
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
	/** A tab's file was renamed (or its folder was): it now saves to `path`. */
	onDocumentMoved(handler: (tabId: string, path: string) => void): () => void;
	onActivateTab(handler: (tabId: string) => void): () => void;
	/** The main process wants a tab saved (while closing the window). */
	onSaveRequest(handler: (tabId: string) => void): () => void;
	onSettings(handler: (settings: Settings) => void): () => void;
	onExternalChange(handler: (tabId: string, modified: number) => void): () => void;

	/** The open folder, or the active document's folder. */
	getWorkspace(): Promise<Workspace>;
	openFolder(): Promise<void>;
	/** Closes one of the open folders; all of them without a path. */
	closeFolder(path?: string): void;
	searchWorkspace(query: string): Promise<SearchResult>;
	/** Creates an empty file or a folder in `parent`, one of the shown folders or inside one; returns its path. */
	createInWorkspace(parent: string, name: string, kind: "file" | "folder"): Promise<string>;
	/** Renames a file or folder of the shown folders; returns its new path. */
	renameInWorkspace(path: string, name: string): Promise<string>;
	/** Moves a file or folder of the shown folders to the recycle bin, once the user agrees; `true` when it went. */
	trashInWorkspace(path: string): Promise<boolean>;
	/** Shows a file or folder in the system's file manager. */
	revealInFolder(path: string): void;
	/** Opens a file of the shown folders with the system's app for it (programs are only shown). */
	openWithSystem(path: string): Promise<void>;
	/** The branches of the repository a shown folder is in, local ones first. */
	gitBranches(folder: string): Promise<readonly GitBranch[]>;
	/** Runs git in a shown folder; resolves to what git said it did. */
	gitRun(folder: string, action: GitAction): Promise<string>;
	/** How a changed file of a shown folder's repository differs from the last commit. */
	gitDiff(folder: string, path: string): Promise<string>;
	/** A commit message for the changes (of `paths` only, when given), written by the assistant. */
	gitSuggestMessage(folder: string, paths?: readonly string[]): Promise<string>;
	/** Asks where to clone `url`, clones it and opens the new folder; its path, `null` when cancelled. */
	gitClone(url: string): Promise<string | null>;

	/** Earlier saved states of the tab's document, newest first. */
	listVersions(tabId: string): Promise<readonly Version[]>;
	readVersion(tabId: string, id: string): Promise<string>;
	/** The open folder changed, in this window or another. */
	onWorkspaceChange(handler: () => void): () => void;

	/** The service in use and whether it can be asked; `refresh` looks for the CLI again. */
	assistantStatus(refresh?: boolean): Promise<AssistantStatus>;
	assistantConfig(): Promise<AssistantConfig>;
	/** Changes the model of the service in use; a chat goes on with it. */
	assistantSetModel(model: string): Promise<AssistantStatus>;
	/** Changes a service's settings and makes it the one in use. */
	assistantConfigure(update: AssistantUpdate): Promise<AssistantStatus>;
	/** The models a service offers; without `key`, the kept one is used. */
	/** Kalem's tools the assistant can be given, for choosing a mode's tools. */
	assistantToolCatalog(): Promise<
		readonly { readonly name: string; readonly description: string }[]
	>;
	assistantModels(request: {
		readonly provider: ProviderId;
		readonly baseUrl: string;
		readonly key?: string;
	}): Promise<readonly ModelOption[]>;
	/** Lets the user pick the program of the CLI in use. */
	assistantLocate(): Promise<AssistantStatus>;
	/** The kept chats, newest first. */
	assistantChats(): Promise<readonly ChatSummary[]>;
	assistantChat(id: string): Promise<StoredChat | null>;
	assistantSaveChat(chat: StoredChat): Promise<void>;
	assistantDeleteChat(id: string): Promise<void>;
	/** Asks the assistant; resolves when the reply has ended. */
	assistantAsk(request: AssistantRequest): Promise<void>;
	assistantStop(chatId: string): Promise<void>;
	/** Asks for files or a folder to add to a chat; empty when cancelled. */
	assistantPickSources(kind: "files" | "folder"): Promise<string[]>;
	/** Writes a change the assistant proposed to a workspace file. */
	assistantApplyEdit(id: string): Promise<void>;
	/** The user's answer to a tool that asked before changing something. */
	assistantApprove(id: string, answer: ApprovalAnswer): Promise<void>;
	/** What the window did with a tool call it ran. */
	assistantToolResult(
		id: string,
		answer: { readonly ok: boolean; readonly text: string; readonly document?: string },
	): Promise<void>;
	/** Forgets the kinds of change allowed for this run of the app. */
	assistantForgetPermissions(): Promise<void>;
	/** Summarizes an API chat so far; a CLI compacts its own (`"cli"`). */
	assistantCompact(sessionId: string): Promise<"done" | "cli" | "none">;
	onAssistantApproval(handler: (request: ApprovalRequest) => void): () => void;
	/** The user's own notes on a document (see `local-notes.ts`), by its key. */
	localNotes(key: string): Promise<readonly LocalNote[]>;
	/** Keeps a document's notes; none forgets the document. */
	setLocalNotes(key: string, notes: readonly LocalNote[]): Promise<void>;
	/** The analysis templates: the team's, the user's, and the built-in one. */
	templates(): Promise<readonly TemplateInfo[]>;
	/** A new tab with a document made from the template. */
	templateNew(id: string): Promise<void>;
	/** Opens a template's file in a tab to edit it. */
	templateOpen(id: string): Promise<void>;
	/** A personal copy of the template, opened to edit. */
	templateCopy(id: string): Promise<TemplateInfo>;
	templateDelete(id: string): Promise<void>;
	/** Keeps a document as a template, the user's own or the team's. */
	templateSave(request: {
		readonly name: string;
		readonly text: string;
		readonly where: "personal" | "workspace";
	}): Promise<TemplateInfo>;
	/** Brings a template in from a file; a Word file opens as a document first (`"word"`). */
	templateImport(): Promise<TemplateInfo | "word" | null>;
	onAssistantToolCall(handler: (call: AssistantToolCall) => void): () => void;
	onAssistantEvent(handler: (chatId: string, event: ClaudeEvent) => void): () => void;
}

export const CHANNEL = {
	getStartup: "kalem:get-startup",
	newWindow: "kalem:new-window",
	newTab: "kalem:new-tab",
	showOpenDialog: "kalem:show-open-dialog",
	openPath: "kalem:open-path",
	recentFiles: "kalem:recent-files",
	paletteCommands: "kalem:palette-commands",
	runPaletteCommand: "kalem:run-palette-command",
	importWord: "kalem:import-word",
	importConfluence: "kalem:import-confluence",
	confluenceAccount: "kalem:confluence-account",
	confluenceConnect: "kalem:confluence-connect",
	confluenceDisconnect: "kalem:confluence-disconnect",
	confluenceSpaces: "kalem:confluence-spaces",
	confluenceTree: "kalem:confluence-tree",
	confluenceCreatePage: "kalem:confluence-create-page",
	confluencePublish: "kalem:confluence-publish",
	confluenceSearch: "kalem:confluence-search",
	confluenceFind: "kalem:confluence-find",
	confluenceAncestors: "kalem:confluence-ancestors",
	confluenceAtom: "kalem:confluence-atom",
	confluenceUsers: "kalem:confluence-users",
	confluenceJiraServer: "kalem:confluence-jira-server",
	confluenceOpenPage: "kalem:confluence-open-page",
	confluenceReloadPage: "kalem:confluence-reload-page",
	confluenceSavePage: "kalem:confluence-save-page",
	confluenceAttachImage: "kalem:confluence-attach-image",
	confluenceAttachments: "kalem:confluence-attachments",
	confluenceWriteDiagram: "kalem:confluence-write-diagram",
	writeDiagram: "kalem:write-diagram",
	confluenceUploadFiles: "kalem:confluence-upload-files",
	confluenceOpenAttachment: "kalem:confluence-open-attachment",
	confluenceDownloadAttachment: "kalem:confluence-download-attachment",
	confluenceDeleteAttachment: "kalem:confluence-delete-attachment",
	jiraAccount: "kalem:jira-account",
	jiraConnect: "kalem:jira-connect",
	jiraDisconnect: "kalem:jira-disconnect",
	jiraSuggestedSite: "kalem:jira-suggested-site",
	jiraIssue: "kalem:jira-issue",
	jiraSearch: "kalem:jira-search",
	jiraWorklogContext: "kalem:jira-worklog-context",
	jiraTransitions: "kalem:jira-transitions",
	jiraTransition: "kalem:jira-transition",
	jiraDevelopment: "kalem:jira-development",
	jiraDevelopmentDetail: "kalem:jira-development-detail",
	jiraLogWork: "kalem:jira-log-work",
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
	createInWorkspace: "kalem:create-in-workspace",
	renameInWorkspace: "kalem:rename-in-workspace",
	trashInWorkspace: "kalem:trash-in-workspace",
	revealInFolder: "kalem:reveal-in-folder",
	openWithSystem: "kalem:open-with-system",
	gitBranches: "kalem:git-branches",
	gitRun: "kalem:git-run",
	gitClone: "kalem:git-clone",
	gitDiff: "kalem:git-diff",
	gitSuggestMessage: "kalem:git-suggest-message",
	documentMoved: "kalem:document-moved",
	workspaceChange: "kalem:workspace-change",
	listVersions: "kalem:list-versions",
	readVersion: "kalem:read-version",
	assistantStatus: "kalem:assistant-status",
	assistantConfig: "kalem:assistant-config",
	assistantConfigure: "kalem:assistant-configure",
	assistantSetModel: "kalem:assistant-set-model",
	assistantModels: "kalem:assistant-models",
	assistantToolCatalog: "kalem:assistant-tool-catalog",
	assistantLocate: "kalem:assistant-locate",
	assistantChats: "kalem:assistant-chats",
	assistantChat: "kalem:assistant-chat",
	assistantSaveChat: "kalem:assistant-save-chat",
	assistantDeleteChat: "kalem:assistant-delete-chat",
	assistantAsk: "kalem:assistant-ask",
	assistantStop: "kalem:assistant-stop",
	assistantPickSources: "kalem:assistant-pick-sources",
	assistantApplyEdit: "kalem:assistant-apply-edit",
	assistantEvent: "kalem:assistant-event",
	assistantApproval: "kalem:assistant-approval",
	templates: "kalem:templates",
	localNotes: "kalem:local-notes",
	setLocalNotes: "kalem:set-local-notes",
	templateNew: "kalem:template-new",
	templateOpen: "kalem:template-open",
	templateCopy: "kalem:template-copy",
	templateDelete: "kalem:template-delete",
	templateSave: "kalem:template-save",
	templateImport: "kalem:template-import",
	assistantApprove: "kalem:assistant-approve",
	assistantToolCall: "kalem:assistant-tool-call",
	assistantToolResult: "kalem:assistant-tool-result",
	assistantForgetPermissions: "kalem:assistant-forget-permissions",
	assistantCompact: "kalem:assistant-compact",
} as const;
