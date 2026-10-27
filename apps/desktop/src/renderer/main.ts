import type { Root } from "@kalem-editor/core";
import type { BlockType, MarkType } from "@kalem-editor/core/commands";
import type { Caret, EditResult } from "@kalem-editor/editor";
import { holderIn, indentItem, outdentItem, selectRange, toggleList } from "@kalem-editor/editor";
import type { Command, KalemBridge, Settings, SidePane, TabDocument } from "../shared/bridge.js";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, pageRule, ZOOM_STEP } from "../shared/bridge.js";
import type { ContextDiagram, ReplyDiagram } from "../shared/claude.js";
import { splitReply } from "../shared/claude.js";
import { attachmentName, linkedAttachment } from "../shared/confluence-common.js";
import type { Diagram } from "../shared/diagram.js";
import { DIAGRAM_SUFFIX, serializeDiagram } from "../shared/diagram.js";
import { format, stringsFor } from "../shared/i18n.js";
import {
	extension,
	isEditablePath,
	isPackagePath,
	isWordPath,
	TEXT_EXTENSIONS,
} from "../shared/paths.js";
import { withColumnWidth } from "../shared/table-style.js";
import { changeCase, collapseSpaces, nextCase } from "../shared/text-case.js";
import { createAssistantPane } from "./assistant-pane.js";
import { createAttachmentCard } from "./attachment-card.js";
import { createAttachmentsDialog, linkedAttachments } from "./confluence-attachments.js";
import { createConfluenceDialog } from "./confluence-dialog.js";
import { createConfluencePane } from "./confluence-pane.js";
import { createDiagramButton, isDiagramImage } from "./diagram-button.js";
import { createDiagramEditor } from "./diagram-editor.js";
import { diagramFromImage, diagramToPng } from "./diagram-image.js";
import { createDocumentTools } from "./document-tools.js";
import { el, isTextFieldFocused } from "./dom.js";
import type { TableContext, TableEdit } from "./edits.js";
import { insertDivider, insertTable, replaceTable, tableAt, toggleTaskList } from "./edits.js";
import { createFilesPane } from "./files-pane.js";
import { icon } from "./icons.js";
import { createImageViewer } from "./image-viewer.js";
import { createNotices } from "./notices.js";
import { Previews } from "./previews.js";
import { documentImages } from "./prompt-images.js";
import { createQuickOpen } from "./quick-open.js";
import { createAppRibbon } from "./ribbon-layout.js";
import { ipcErrorMessage, Session } from "./session.js";
import { enableColumnResize } from "./table-styles.js";
import { createTabStrip } from "./tabs.js";
import { createVersionHistory } from "./version-history.js";

import "@kalem-editor/themes/tokens.css";
import "@kalem-editor/themes/viewer.css";
import "@kalem-editor/themes/editor.css";
import "@kalem-editor/themes/ui.css";
import "@kalem-editor/themes/plugin-code.css";
import "@kalem-editor/themes/plugin-find.css";
import "@kalem-editor/themes/plugin-image.css";
import "@kalem-editor/themes/plugin-outline.css";
import "@kalem-editor/themes/plugin-word-count.css";
import "@kalem-editor/themes/plugin-source.css";
import "./style.css";

declare global {
	interface Window {
		readonly kalem: KalemBridge;
	}
}

const bridge = window.kalem;
const startup = await bridge.getStartup();
const t = stringsFor(startup.language);
let settings: Settings = startup.settings;

document.documentElement.lang = startup.language;
document.documentElement.dataset.platform = startup.platform;

// --- Shell ------------------------------------------------------------------

const ribbonHost = el("header", { class: "ribbon-host" });
// Each tab brings its own notices, page, outline and word count; these hold them.
const noticeArea = el("div", { class: "notice-area" });
const deskArea = el("div", { class: "desk-area" });
const outlineArea = el("div", { class: "navigation-content" });
const wordCountArea = el("div", { class: "status-counts" });

const closeNavigation = el("button", {
	class: "icon-button",
	attrs: { type: "button", "aria-label": t.closeNavigation, title: t.closeNavigation },
	children: [icon("close")],
});
closeNavigation.addEventListener("click", () => updateSettings({ navigation: false }));

const filesPane = createFilesPane({
	t,
	bridge,
	lang: startup.language,
	activePath: () => session?.path ?? null,
	open: (path, query) => void openFromFolder(path, query),
	notify: (text) => session.notices.show({ id: "files", kind: "error", text }),
});
const versionHistory = createVersionHistory({ t, lang: startup.language });
const attachmentsDialog = createAttachmentsDialog({
	t,
	lang: startup.language,
	pathForFile: (file) => bridge.pathForFile(file),
	errorText: ipcErrorMessage,
});
const previews: Previews = new Previews(() => {
	for (const tab of tabs.values()) previews.decorate(tab.canvas);
});
const confluenceDialog = createConfluenceDialog({
	t,
	lang: startup.language,
	bridge,
	onAccountChange: () => {
		if (settings.navigation && settings.sidePane === "confluence") void confluencePane.refresh();
	},
});
const confluencePane = createConfluencePane({
	t,
	lang: startup.language,
	bridge,
	space: () => settings.confluenceSpace,
	setSpace: (key) => updateSettings({ confluenceSpace: key }),
	favorites: () => settings.confluenceFavorites,
	setFavorites: (favorites) => updateSettings({ confluenceFavorites: favorites }),
	activePage: () => session?.remote?.id ?? null,
	connect: () => void confluenceDialog.show(),
});
const quickOpen = createQuickOpen({
	t,
	lang: startup.language,
	workspace: () => bridge.getWorkspace(),
	open: (path) => void bridge.openPath(path),
});

/** Where the caret last was in each tab's document, and the text last selected in it. */
const lastCarets = new WeakMap<Session, Caret>();
let lastSelection = "";

const assistant = createAssistantPane({
	t,
	lang: startup.language,
	bridge,
	previews,
	shareDocument: () => settings.assistantDocument,
	setShareDocument: (share) => updateSettings({ assistantDocument: share }),
	width: () => settings.assistantWidth,
	setWidth: (width) => updateSettings({ assistantWidth: width }),
	context: () => assistantContext(),
	images: () =>
		documentImages([...canvas.querySelectorAll("img")].filter((image) => !isDiagramImage(image))),
	selection: () => lastSelection,
	workspaceFolders: () => {
		const workspace = filesPane.workspace();
		return workspace?.opened === true ? workspace.roots.map((root) => root.path) : [];
	},
	insert: (text) => insertReply(text),
	insertDiagram: (diagram) => insertReplyDiagram(diagram),
	openDiagram: (diagram) =>
		newDiagram(diagram.diagram, diagram.title, lastCarets.get(session) ?? null),
	hasDiagram: (src) => diagramImages(canvas).some((image) => image.getAttribute("src") === src),
	updateDiagram: (src, diagram) => rewriteDiagram(session, src, diagram.diagram),
	openLink: (href) => bridge.openLink(href),
	runCommand: (command) => {
		// The command acts where the caret was in the document, not in the assistant.
		returnToDocument();
		commands[command]();
	},
	close: () => updateSettings({ assistant: false }),
	errorText: ipcErrorMessage,
});

// Always at the right edge, so the assistant is never hard to find.
const assistantToggle = el("button", {
	class: "assistant-rail-button",
	attrs: {
		type: "button",
		title: `${t.assistantPane} (${startup.platform === "darwin" ? "Cmd" : "Ctrl"}+Shift+L)`,
		"aria-label": t.assistantPane,
		"aria-controls": "assistant-pane",
	},
	children: [
		icon("assistant"),
		el("span", { class: "assistant-rail-label", text: t.assistantTitle }),
	],
});
assistantToggle.addEventListener("click", () => {
	if (settings.assistant) {
		updateSettings({ assistant: false });
		session.focus();
	} else {
		updateSettings({ assistant: true });
		assistant.focus();
	}
});
const assistantRail = el("div", { class: "assistant-rail", children: [assistantToggle] });

function sidePaneTab(pane: SidePane, label: string): HTMLButtonElement {
	const button = el("button", {
		class: "side-pane-tab",
		text: label,
		attrs: { type: "button", role: "tab", "data-pane": pane },
	});
	button.addEventListener("click", () => updateSettings({ sidePane: pane }));
	return button;
}
const sidePaneTabs = [
	sidePaneTab("outline", t.outlineTab),
	sidePaneTab("files", t.filesTab),
	sidePaneTab("confluence", t.confluenceTab),
];
const navigation = el("nav", {
	class: "navigation kalem-theme",
	attrs: { "aria-label": t.navigation },
	children: [
		el("div", {
			class: "navigation-header",
			children: [
				el("div", { class: "side-pane-tabs", attrs: { role: "tablist" }, children: sidePaneTabs }),
				closeNavigation,
			],
		}),
		outlineArea,
		filesPane.element,
		confluencePane.element,
	],
});

const readOnlyBadge = el("span", { class: "status-badge", text: t.statusReadOnly });
const formatBadge = el("span", { class: "status-format" });
const zoomSlider = el("input", {
	class: "zoom-slider",
	attrs: {
		type: "range",
		min: String(MIN_ZOOM),
		max: String(MAX_ZOOM),
		step: String(ZOOM_STEP),
		"aria-label": t.zoom,
	},
});
const zoomValue = el("output", { class: "zoom-value" });
const statusBar = el("footer", {
	class: "statusbar",
	children: [
		wordCountArea,
		el("span", { class: "status-spacer" }),
		readOnlyBadge,
		formatBadge,
		el("div", { class: "zoom", children: [zoomSlider, zoomValue] }),
	],
});

const exitFocus = el("button", {
	class: "focus-exit",
	text: t.exitFocus,
	attrs: { type: "button" },
});
const saveStatus = el("div", { class: "save-status", attrs: { role: "status" } });

const tabStrip = createTabStrip({
	label: t.openDocuments,
	newTabLabel: t.newTab,
	closeLabel: t.closeTab,
	onSelect: (id) => activateTab(id),
	onClose: (id) => void closeTab(id),
	onNew: () => bridge.newTab(),
	onContextMenu: (id, x, y) => bridge.showTabMenu(id, x, y),
	onDragOut: (id, x, y) => moveTab(id, { x, y }),
});

const app = document.getElementById("app") ?? document.body.appendChild(el("div"));
app.className = "app";
app.append(
	ribbonHost,
	tabStrip.element,
	noticeArea,
	el("div", { class: "body", children: [navigation, deskArea, assistant.element, assistantRail] }),
	statusBar,
	exitFocus,
);

// The find panel is pinned below the chrome through this variable (see style.css).
const chromeObserver = new ResizeObserver(() => {
	const top = Math.round(deskArea.getBoundingClientRect().top);
	document.documentElement.style.setProperty("--desk-top", `${top}px`);
});
chromeObserver.observe(ribbonHost);
chromeObserver.observe(tabStrip.element);
chromeObserver.observe(noticeArea);

// --- Tabs -------------------------------------------------------------------

interface Tab {
	readonly session: Session;
	readonly canvas: HTMLElement;
	/** Everything that belongs to this tab and is shown only while it is active. */
	readonly views: readonly HTMLElement[];
}

const tabs = new Map<string, Tab>();

// The active tab. Commands and the ribbon always act on these.
let session: Session;
let canvas: HTMLElement;

let refreshQueued = false;

/** Ribbon state depends on the selection, which changes on every keystroke. */
function scheduleRibbonUpdate(): void {
	if (refreshQueued) return;
	refreshQueued = true;
	requestAnimationFrame(() => {
		refreshQueued = false;
		ribbon.update();
	});
}

const STATUS_TEXT = {
	new: t.statusNew,
	saved: t.statusSaved,
	unsaved: t.statusUnsaved,
	saving: t.statusSaving,
	error: t.statusError,
} as const;

/** Without an open folder the pane follows the active document's folder. */
function refreshFiles(): void {
	if (filesPane.workspace()?.opened === true) filesPane.highlightActive();
	else void filesPane.refresh();
	confluencePane.highlightActive();
}

/** Opens a document picked in the files pane; from search results, its matches are shown. */
async function openFromFolder(path: string, query?: string): Promise<void> {
	await bridge.openPath(path);
	if (query === undefined) return;
	// The document arrives through `onDocument`; give it a frame to load.
	requestAnimationFrame(() => {
		if (session.path !== path) return;
		if (session.isText) {
			session.textView?.openFind(query);
			return;
		}
		session.find?.open("find");
		// Opening the panel focuses its search field.
		const input = document.activeElement;
		if (!(input instanceof HTMLInputElement) || !input.classList.contains("kalem-find-input"))
			return;
		input.value = query;
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function renderState(): void {
	saveStatus.textContent = STATUS_TEXT[session.status];
	saveStatus.dataset.status = session.status;
	saveStatus.title = session.path ?? "";
	formatBadge.textContent = session.formatLabel;
	readOnlyBadge.hidden = !session.readOnly;
}

function createTab(id: string): Tab {
	const noticeHost = el("div", { class: "notices" });
	const tabCanvas = el("div", { class: "kalem-theme" });
	// `kalem-theme` on the page too: the source-mode textarea is a sibling of
	// the editor and would otherwise not inherit the theme tokens.
	const page = el("div", { class: "page kalem-theme", children: [tabCanvas] });
	const desk = el("main", { class: "desk", children: [page] });
	const outline = el("div", { class: "kalem-theme" });
	const wordCount = el("div", { class: "kalem-theme" });
	const views = [noticeHost, desk, outline, wordCount];
	for (const view of views) view.hidden = true;

	noticeArea.append(noticeHost);
	deskArea.append(desk);
	outlineArea.append(outline);
	wordCountArea.append(wordCount);

	const tabSession: Session = new Session({
		id,
		bridge,
		t,
		language: startup.language,
		documentScheme: startup.documentScheme,
		canvas: tabCanvas,
		outline,
		wordCount,
		notices: createNotices(noticeHost, t.dismiss),
		previews,
		settings: () => settings,
		onStateChange: () => {
			tabStrip.update(id, {
				title: tabSession.name,
				dirty: tabSession.dirty,
				path: tabSession.path,
			});
			if (session === tabSession) renderState();
		},
		onEditorChange: scheduleRibbonUpdate,
	});

	enableColumnResize(tabCanvas, {
		enabled: () => session === tabSession && canEdit(),
		zoom: () => settings.zoom / 100,
		resize: (tableId, column, width, done) => {
			const style = withColumnWidth(tabSession.tableStyle(tableId), column, width);
			tabSession.setTableStyle(tableId, style, done);
		},
	});

	const tab: Tab = { session: tabSession, canvas: tabCanvas, views };
	tabs.set(id, tab);
	tabStrip.add(id);
	return tab;
}

function activateTab(id: string): void {
	const tab = tabs.get(id);
	if (tab === undefined || tab.session === session) return;

	for (const other of tabs.values()) {
		if (other === tab) continue;
		for (const view of other.views) view.hidden = true;
		other.session.deactivate();
	}
	session = tab.session;
	canvas = tab.canvas;
	lastSelection = "";
	assistant.refreshSelection();
	for (const view of tab.views) view.hidden = false;
	session.activate();

	tabStrip.select(id);
	bridge.tabActivated(id);
	renderState();
	refreshFiles();
	scheduleRibbonUpdate();
}

/** Loads a document into its tab, creating the tab if it does not exist yet. */
function openDocument({ tabId, payload }: TabDocument): void {
	const tab = tabs.get(tabId) ?? createTab(tabId);
	// Load before activating: the ribbon reads editor state as soon as a tab is active.
	tab.session.load(payload);
	activateTab(tabId);
	tab.session.focus();
}

async function closeTab(id: string): Promise<void> {
	const tab = tabs.get(id);
	if (tab === undefined) return;

	if (tab.session.dirty) {
		activateTab(id);
		const choice = await bridge.confirmCloseTab(id);
		if (choice === "cancel") return;
		if (choice === "save" && !(await tab.session.save())) return;
	}
	if (!tabs.has(id)) return;
	discardTab(id);
	// The main process closes the window when its last tab is gone.
	bridge.tabClosed(id);
}

/** Hands the tab, unsaved edits included, to a new window. */
function moveTab(id: string, at?: { x: number; y: number }): void {
	const tab = tabs.get(id);
	if (tab === undefined || tabs.size < 2) return;
	const moved = {
		text: tab.session.styledMarkdown(),
		format: tab.session.format,
		dirty: tab.session.dirty,
	};
	if (at === undefined) bridge.moveTabToWindow(id, moved);
	else bridge.moveTabToWindow(id, moved, at);
}

/** Removes the tab from this window without asking anything. */
function discardTab(id: string): void {
	const tab = tabs.get(id);
	if (tab === undefined) return;
	if (tab.session === session) {
		const order = tabStrip.order();
		const index = order.indexOf(id);
		const neighbour = order[index + 1] ?? order[index - 1];
		if (neighbour !== undefined) activateTab(neighbour);
	}
	tabs.delete(id);
	tabStrip.remove(id);
	tab.session.dispose();
	for (const view of tab.views) view.remove();
}

function cycleTab(step: 1 | -1): void {
	const order = tabStrip.order();
	const next = order[(order.indexOf(session.id) + step + order.length) % order.length];
	if (next !== undefined) activateTab(next);
}

// --- Settings ---------------------------------------------------------------

const pageSetup = document.head.appendChild(document.createElement("style"));

function applySettings(): void {
	pageSetup.textContent = pageRule(settings);
	app.style.setProperty("--zoom", String(settings.zoom / 100));
	app.toggleAttribute("data-full-width", settings.fullWidth);
	navigation.hidden = !settings.navigation;
	assistant.element.hidden = !settings.assistant;
	assistantToggle.setAttribute("aria-expanded", String(settings.assistant));
	if (settings.assistant) assistant.show();
	outlineArea.hidden = settings.sidePane !== "outline";
	filesPane.element.hidden = settings.sidePane !== "files";
	confluencePane.element.hidden = settings.sidePane !== "confluence";
	for (const tab of sidePaneTabs) {
		tab.setAttribute("aria-selected", String(tab.dataset.pane === settings.sidePane));
	}
	zoomSlider.value = String(settings.zoom);
	zoomValue.textContent = `${settings.zoom}%`;
}

function updateSettings(patch: Partial<Settings>): void {
	const confluenceShown = settings.navigation && settings.sidePane === "confluence";
	settings = { ...settings, ...patch };
	if (!confluenceShown && settings.navigation && settings.sidePane === "confluence") {
		void confluencePane.refresh();
	}
	applySettings();
	scheduleRibbonUpdate();
	bridge.updateSettings(patch);
}

function setZoom(zoom: number): void {
	const next = clampZoom(zoom);
	if (next !== settings.zoom) updateSettings({ zoom: next });
}

zoomSlider.addEventListener("input", () => setZoom(Number(zoomSlider.value)));

deskArea.addEventListener(
	"wheel",
	(event) => {
		if (!event.ctrlKey) return;
		event.preventDefault();
		setZoom(settings.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
	},
	{ passive: false },
);

function toggleFocusMode(): void {
	app.toggleAttribute("data-focus");
	scheduleRibbonUpdate();
}

exitFocus.addEventListener("click", toggleFocusMode);

// --- Commands ---------------------------------------------------------------

function inSource(): boolean {
	return session.source?.isSource() === true;
}

function canEdit(): boolean {
	return !session.editor.isReadOnly() && !inSource();
}

function warn(text: string): void {
	session.notices.show({ id: "edit", kind: "warning", text });
}

/** Applies a structural edit at the caret. */
function edit(change: (doc: Root, caret: Caret) => EditResult | null): void {
	const editor = session.editor;
	if (inSource()) return;
	if (editor.isReadOnly()) {
		warn(t.readOnlyBlocked);
		return;
	}
	const caret = editor.getCaret();
	if (caret === null) {
		warn(t.noCaret);
		return;
	}
	session.notices.dismiss("edit");
	editor.applyEdit(change(editor.getDocument(), caret));
}

/** Rewrites the selection, or the word at the caret, keeping its formatting. */
function rewriteText(transform: (text: string) => string): void {
	if (isTextFieldFocused() || inSource()) return;
	if (session.editor.isReadOnly()) {
		warn(t.readOnlyBlocked);
		return;
	}
	if (session.editor.transformText(transform)) session.notices.dismiss("edit");
	else warn(t.noTextToChange);
}

function setBlock(type: BlockType): void {
	edit(() => {
		session.editor.setBlockType(type);
		return null;
	});
}

function toggleMark(mark: MarkType): void {
	if (canEdit()) session.editor.toggleMark(mark);
}

function history(action: "undo" | "redo"): void {
	// Text fields (source view, find box, a text file's box) keep their own native history.
	if (session.isText && !isTextFieldFocused()) session.focus();
	if (isTextFieldFocused()) document.execCommand(action);
	else if (action === "undo") session.editor.undo();
	else session.editor.redo();
}

function editTable(change: (context: TableContext) => TableEdit): void {
	edit((doc, caret) => {
		const context = tableAt(doc, caret);
		if (context === null) return null;
		const next = change(context);
		return replaceTable(doc, context, next.table, next.row, next.column);
	});
}

const tools = createDocumentTools({
	t,
	bridge,
	lang: startup.language,
	previews,
	session: () => session,
	canvas: () => canvas,
	inSource,
	warn,
});

function heading(depth: 1 | 2 | 3 | 4 | 5 | 6): () => void {
	return () => setBlock({ type: "heading", depth });
}

const commands: Record<Command, () => void> = {
	save: () => void session.save(),
	"save-as": () => void session.save(true),
	"save-as-package": () => void session.save(true, "package"),
	"close-tab": () => void closeTab(session.id),
	"next-tab": () => cycleTab(1),
	"previous-tab": () => cycleTab(-1),
	undo: () => history("undo"),
	redo: () => history("redo"),
	"paste-plain": () => {
		session.editor.pasteWithoutFormatting();
		bridge.clipboard("paste");
	},
	find: () => (session.isText ? session.textView?.openFind() : session.find?.open("find")),
	replace: () => (session.isText ? session.textView?.openFind() : session.find?.open("replace")),
	image: () => void session.insertImages(),
	"attach-file": () => void session.attachFiles(),
	diagram: () => newDiagram(),
	table: () => edit((doc, caret) => insertTable(doc, caret, 3, 3)),
	link: () => {
		if (canEdit()) session.ui?.linkPopover?.open();
	},
	divider: () => edit(insertDivider),
	"code-block": () => setBlock({ type: "code" }),
	quote: () => setBlock({ type: "blockquote" }),
	"task-list": () => edit(toggleTaskList),
	bold: () => toggleMark("strong"),
	italic: () => toggleMark("emphasis"),
	strikethrough: () => toggleMark("delete"),
	"inline-code": () => toggleMark("inlineCode"),
	paragraph: () => setBlock({ type: "paragraph" }),
	"heading-1": heading(1),
	"heading-2": heading(2),
	"heading-3": heading(3),
	"heading-4": heading(4),
	"heading-5": heading(5),
	"heading-6": heading(6),
	"bullet-list": () => edit((doc, caret) => toggleList(doc, caret, false)),
	"ordered-list": () => edit((doc, caret) => toggleList(doc, caret, true)),
	indent: () => edit(indentItem),
	outdent: () => edit(outdentItem),
	"merge-blocks": () => {
		if (canEdit() && !session.editor.mergeBlocks()) warn(t.mergeBlocksBlocked);
	},
	source: () => session.source?.toggle(),
	"read-only": () => session.toggleReadOnly(),
	focus: toggleFocusMode,
	"zoom-in": () => setZoom(settings.zoom + ZOOM_STEP),
	"zoom-out": () => setZoom(settings.zoom - ZOOM_STEP),
	"zoom-reset": () => setZoom(100),
	"export-html": () => void tools.exportHtml(),
	"export-docx": () => void tools.exportDocx(),
	"export-confluence": () => void tools.exportConfluence("storage"),
	"export-confluence-wiki": () => void tools.exportConfluence("wiki"),
	// In a text file, formatting acts on the whole file.
	"format-code": () => (session.isText ? session.textView?.beautify() : tools.formatCode()),
	"format-all-code": () => (session.isText ? session.textView?.beautify() : tools.formatAllCode()),
	"quick-open": () => void quickOpen.show(),
	"confluence-open": () => void confluenceDialog.show(),
	"move-tab": () => moveTab(session.id),
	"case-upper": () => rewriteText((text) => changeCase(text, "upper", session.editor.getLang())),
	"case-lower": () => rewriteText((text) => changeCase(text, "lower", session.editor.getLang())),
	"case-title": () => rewriteText((text) => changeCase(text, "title", session.editor.getLang())),
	"case-sentence": () =>
		rewriteText((text) => changeCase(text, "sentence", session.editor.getLang())),
	"case-toggle": () => rewriteText((text) => changeCase(text, "toggle", session.editor.getLang())),
	"case-cycle": () =>
		rewriteText((text) => {
			const lang = session.editor.getLang();
			return changeCase(text, nextCase(text, lang), lang);
		}),
	"collapse-spaces": () => rewriteText(collapseSpaces),
	assistant: () => toggleAssistant(),
	"version-history": () => {
		const tab = session;
		void versionHistory.show({
			saved: tab.path !== null,
			list: () => bridge.listVersions(tab.id),
			read: (id) => bridge.readVersion(tab.id, id),
			restore: (text, label) => {
				if (!tab.replaceText(text)) return false;
				tab.notices.show({ id: "version", text: format(t.versionRestored, label) });
				return true;
			},
		});
	},
	"confluence-attachments": () => showAttachments(),
	"search-folder": () => {
		if (!settings.navigation || settings.sidePane !== "files") {
			updateSettings({ navigation: true, sidePane: "files" });
		}
		filesPane.focusSearch();
	},
};

// The ribbon reads editor state as soon as it is built, so the documents come first.
applySettings();
for (const document of startup.documents) openDocument(document);
if (settings.navigation && settings.sidePane === "confluence") void confluencePane.refresh();

const ribbon = createAppRibbon(ribbonHost, saveStatus, {
	t,
	bridge,
	platform: startup.platform,
	language: startup.language,
	commands,
	session: () => session,
	settings: () => settings,
	updateSettings,
	canEdit,
	inSource,
	inCodeBlock: () => session.isText || tools.inCodeBlock(),
	focusMode: () => app.hasAttribute("data-focus"),
	warn,
	edit,
	editTable,
});

// The editor reports no selection inside code blocks, so moving into or between
// them would not refresh the contextual Code tab.
document.addEventListener("selectionchange", scheduleRibbonUpdate);

// Shift+F3 cycles the case, as in Word; the menu only shows the shortcut.
document.addEventListener("keydown", (event) => {
	if (event.key !== "F3" || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)
		return;
	event.preventDefault();
	commands["case-cycle"]();
});

// --- Events from the main process -------------------------------------------

bridge.onCommand((name) => commands[name]?.());
bridge.onDocument(openDocument);
bridge.onDocumentMoved((tabId, path) => {
	tabs.get(tabId)?.session.movedTo(path);
	refreshFiles();
});
bridge.onActivateTab(activateTab);
bridge.onExternalChange((tabId) => void tabs.get(tabId)?.session.handleExternalChange());
// The window is closing and the user chose to save this tab first.
bridge.onSaveRequest((tabId) => {
	const tab = tabs.get(tabId);
	const saving = tab === undefined ? Promise.resolve(false) : tab.session.save();
	void saving.then((saved) => bridge.answerSave(tabId, saved));
});
bridge.onWorkspaceChange(() => void filesPane.refresh());
bridge.onTabMoved((id) => discardTab(id));
bridge.onTabMenu((id, action) => {
	if (action === "move") moveTab(id);
	else void closeTab(id);
});
// Files may have been added or renamed elsewhere.
window.addEventListener("focus", () => {
	if (settings.navigation && settings.sidePane === "files") void filesPane.refresh();
});

bridge.onSettings((next) => {
	const confluenceShown = settings.navigation && settings.sidePane === "confluence";
	const favoritesChanged =
		JSON.stringify(next.confluenceFavorites) !== JSON.stringify(settings.confluenceFavorites);
	settings = next;
	if (favoritesChanged) confluencePane.render();
	if (!confluenceShown && settings.navigation && settings.sidePane === "confluence") {
		void confluencePane.refresh();
	}
	applySettings();
	scheduleRibbonUpdate();
});

// --- Dropped files ----------------------------------------------------------

// Documents open in tabs, other files are attached. A drop of images only is
// left to the image plugin. Capture phase: the plugin would otherwise treat
// every dropped file as an image.
window.addEventListener(
	"drop",
	(event) => {
		// The attachments dialog uploads what is dropped on it.
		if (event.target instanceof Element && event.target.closest(".attachments") !== null) return;
		const files = Array.from(event.dataTransfer?.files ?? [])
			.map((file) => ({ path: bridge.pathForFile(file), image: file.type.startsWith("image/") }))
			.filter((file) => file.path !== "");
		// Documents and plain text files open; other files are attached to the document.
		const isDocument = (path: string): boolean =>
			isEditablePath(path) || isWordPath(path) || TEXT_EXTENSIONS.includes(extension(path));
		const documents = files.filter((file) => isDocument(file.path));
		const others = files.filter((file) => !isDocument(file.path));
		if (documents.length === 0 && others.every((file) => file.image)) return;

		event.preventDefault();
		event.stopPropagation();
		for (const { path } of documents) void bridge.openPath(path);
		if (others.length > 0) void session.attachFiles(others.map((file) => file.path));
	},
	true,
);
window.addEventListener("dragover", (event) => {
	if (event.dataTransfer?.types.includes("Files") === true) event.preventDefault();
});
window.addEventListener("drop", (event) => event.preventDefault());

// --- Links ------------------------------------------------------------------

// --- Diagrams -----------------------------------------------------------------

const diagramEditor = createDiagramEditor(t);

/**
 * Writes a new diagram's picture and data next to the document (or to its
 * Confluence page); resolves with the picture's URL for the document.
 */
async function storeDiagram(tab: Session, diagram: Diagram, name: string): Promise<string> {
	const bytes = await diagramToPng(diagram);
	const data = serializeDiagram(diagram);
	if (tab.remote !== null) {
		return (await bridge.confluenceWriteDiagram(tab.id, { bytes, data, title: name })).url;
	}
	// Its file goes next to the document, so the document needs a place first.
	if (tab.path === null) await tab.save();
	if (tab.path === null) throw new Error(t.diagramNeedsSave);
	return bridge.writeDiagram(tab.path, { bytes, data, title: name });
}

/** Writes over the files of the document's diagram at `url`, and shows the new drawing. */
async function rewriteDiagram(tab: Session, url: string, next: Diagram): Promise<void> {
	const bytes = await diagramToPng(next);
	const data = serializeDiagram(next);
	if (tab.remote !== null) {
		await bridge.confluenceWriteDiagram(tab.id, { bytes, data, name: attachmentName(url) ?? url });
	} else {
		if (tab.path === null) throw new Error(t.diagramNeedsSave);
		await bridge.writeDiagram(tab.path, { bytes, data, url });
		// Inside a package the file only reaches the package when it is saved.
		if (isPackagePath(tab.path)) tab.markAssetsChanged();
	}
	await showNewDrawing(url);
}

/** Draws a new diagram (from `initial`, when given) and puts its picture at the caret. */
function newDiagram(
	initial: Diagram | null = null,
	title = "",
	at: Caret | null = session.editor.getCaret(),
): void {
	const tab = session;
	if (tab.editor.isReadOnly()) {
		tab.notices.show({ id: "edit", kind: "warning", text: t.readOnlyBlocked });
		return;
	}
	diagramEditor.open({
		diagram: initial,
		title: title === "" ? t.diagramDefaultName : title,
		titleEditable: true,
		async save(diagram, name) {
			const chosen = name === "" ? t.diagramDefaultName : name;
			tab.insertDiagram(chosen, await storeDiagram(tab, diagram, chosen), at);
			return true;
		},
	});
}

/** Opens the diagram an image of the document was drawn from; saving rewrites that file. */
async function editDiagram(image: HTMLImageElement): Promise<void> {
	const tab = session;
	const url = image.getAttribute("src") ?? "";
	const fail = (text: string): void => tab.notices.show({ id: "diagram", kind: "warning", text });
	let diagram: Awaited<ReturnType<typeof diagramFromImage>>;
	try {
		diagram = await diagramFromImage(image.src);
	} catch (error) {
		fail(format(t.diagramLoadFailed, ipcErrorMessage(error)));
		return;
	}
	if (diagram === null) {
		fail(t.diagramNotEditable);
		return;
	}
	const file = attachmentName(url) ?? url;
	diagramEditor.open({
		diagram,
		title: file.slice(0, file.length - DIAGRAM_SUFFIX.length) || file,
		titleEditable: false,
		async save(next) {
			await rewriteDiagram(tab, url, next);
			return true;
		},
	});
}

/**
 * Makes the document's pictures of a rewritten diagram show the new drawing.
 * Chromium reuses an image URL within the page whatever its cache headers;
 * fetching the URL again replaces that entry, so setting the source again
 * then loads the file as it is now.
 */
async function showNewDrawing(url: string): Promise<void> {
	const shown = [...document.querySelectorAll<HTMLImageElement>("#editor img")].filter(
		(image) => image.getAttribute("src") === url,
	);
	const source = shown[0]?.src;
	if (source === undefined) return;
	await fetch(source, { cache: "no-store" }).catch(() => {});
	for (const image of shown) {
		// The document's own (relative) URL goes back, not the resolved one: the
		// next edit finds the diagram's file by it.
		image.removeAttribute("src");
		image.setAttribute("src", url);
	}
}

createDiagramButton({
	host: deskArea,
	label: t.diagramEdit,
	edit: (image) => void editDiagram(image),
});
deskArea.addEventListener(
	"dblclick",
	(event) => {
		if (!isDiagramImage(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		void editDiagram(event.target);
	},
	true,
);

// A click on a picture shows it large; with Alt (or from the viewer) it edits its description.
let editingAlt = false;
const imageViewer = createImageViewer({
	t,
	readOnly: () => session.editor.isReadOnly(),
	editAlt(image) {
		editingAlt = true;
		try {
			image.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		} finally {
			editingAlt = false;
		}
	},
});
deskArea.addEventListener(
	"click",
	(event) => {
		const image = event.target;
		if (!(image instanceof HTMLImageElement) || !canvas.contains(image)) return;
		if (editingAlt || isDiagramImage(image) || event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		imageViewer.open(
			image,
			[...canvas.querySelectorAll("img")].filter((shown) => !isDiagramImage(shown)),
		);
	},
	true,
);

// --- Claude assistant ---------------------------------------------------------

// Typing in the assistant moves the selection out of the document; what was
// selected there, and where its caret was, are kept for the next question.
document.addEventListener("selectionchange", () => {
	const selection = document.getSelection();
	const anchor = selection?.anchorNode ?? null;
	if (selection === null || anchor === null || !canvas.contains(anchor)) return;
	const caret = session.editor.getCaret();
	if (caret !== null) lastCarets.set(session, caret);
	const text = selection.isCollapsed ? "" : selection.toString();
	if (text !== lastSelection) {
		lastSelection = text;
		assistant.refreshSelection();
	}
});

/** Puts the focus back in the document, the caret where it last was there. */
function returnToDocument(): void {
	if (session.isText) {
		session.focus();
		return;
	}
	const editor = session.editor;
	const caret = lastCarets.get(session);
	const block = caret === undefined ? undefined : editor.getDocument().children[caret.blockIndex];
	const element = block === undefined ? undefined : editor.getBlockElement(block.id as string);
	const holder =
		caret === undefined || element === undefined ? null : holderIn(element, caret.path);
	if (caret === undefined || holder === null) {
		editor.focus();
		return;
	}
	selectRange(holder, caret.offset, caret.offset);
	(holder.closest("[contenteditable]") as HTMLElement | null)?.focus({ preventScroll: true });
}

function toggleAssistant(): void {
	if (!settings.assistant) {
		updateSettings({ assistant: true });
		assistant.focus();
	} else if (!assistant.element.contains(document.activeElement)) {
		assistant.focus();
	} else {
		updateSettings({ assistant: false });
		session.focus();
	}
}

function diagramImages(root: HTMLElement): HTMLImageElement[] {
	return [...root.querySelectorAll("img")].filter((image) => isDiagramImage(image));
}

const MAX_CONTEXT_DIAGRAMS = 10;

async function assistantContext() {
	const tab = session;
	const diagrams: ContextDiagram[] = [];
	const seen = new Set<string>();
	for (const image of diagramImages(canvas)) {
		const src = image.getAttribute("src") ?? "";
		if (seen.has(src) || diagrams.length >= MAX_CONTEXT_DIAGRAMS) continue;
		seen.add(src);
		const diagram = await diagramFromImage(image.src).catch(() => null);
		if (diagram !== null) diagrams.push({ src, diagram });
	}
	// The file's own name, with its extension, tells Claude what kind of text it is.
	const name = tab.path?.split(/[\\/]/).pop() ?? tab.name;
	return { tabId: tab.id, name, text: tab.styledMarkdown(), diagrams };
}

function editableTab(): Session {
	const tab = session;
	if (tab.readOnly) throw new Error(t.readOnlyBlocked);
	if (inSource()) throw new Error(t.assistantSourceMode);
	return tab;
}

/** A reply's Markdown at the caret, each of its Kalem diagrams drawn as a picture. */
async function insertReply(text: string): Promise<void> {
	const tab = editableTab();
	let markdown = "";
	for (const part of splitReply(text)) {
		if (part.kind === "markdown") {
			markdown += part.text;
			continue;
		}
		const name = part.title === "" ? t.diagramDefaultName : part.title;
		// The URL comes percent-encoded, so it needs no brackets.
		const url = await storeDiagram(tab, part.diagram, name);
		markdown += `\n\n![${name.replace(/[[\]\\]/g, "\\$&")}](${url})\n\n`;
	}
	if (session !== tab) throw new Error(t.assistantTabChanged);
	const caret = tab.insertMarkdown(markdown, lastCarets.get(tab) ?? tab.editor.getCaret());
	if (caret !== null) lastCarets.set(tab, caret);
}

async function insertReplyDiagram(diagram: ReplyDiagram): Promise<void> {
	const tab = editableTab();
	const name = diagram.title === "" ? t.diagramDefaultName : diagram.title;
	const url = await storeDiagram(tab, diagram.diagram, name);
	tab.insertDiagram(name, url, lastCarets.get(tab) ?? null);
}

// --- Confluence attachments -------------------------------------------------

/** The attachments dialog for the active Confluence page, optionally filtered to one name. */
function showAttachments(filter = ""): void {
	const tab = session;
	const page = tab.remote;
	if (page === null) {
		tab.notices.show({ id: "edit", kind: "warning", text: t.confluenceAttachmentsNeedPage });
		return;
	}
	void attachmentsDialog.show(
		{
			title: page.title,
			list: () => bridge.confluenceAttachments(tab.id),
			upload: (paths) => bridge.confluenceUploadFiles(tab.id, paths),
			open: (name) => bridge.confluenceOpenAttachment(tab.id, name),
			download: (name) => bridge.confluenceDownloadAttachment(tab.id, name),
			remove: (file, used) =>
				bridge.confluenceDeleteAttachment(tab.id, { id: file.id, name: file.name, used }),
			insert: (upload) => session === tab && tab.insertAttachment(upload),
			linked: () => linkedAttachments(tab.editor.getDocument()),
			// Relative to the document's base, which is this page's attachments.
			preview: (name) => encodeURIComponent(name),
		},
		filter,
	);
}

/** Runs an attachment request for the active page; a failure becomes a notice. */
function attachmentRequest(run: (tabId: string) => Promise<string | undefined>): void {
	const tab = session;
	run(tab.id).then(
		(text) => {
			if (text !== undefined) tab.notices.show({ id: "attach", text });
		},
		(error: unknown) =>
			tab.notices.show({
				id: "attach",
				kind: "error",
				text: format(t.confluenceRequestFailed, ipcErrorMessage(error)),
			}),
	);
}

const openAttachment = (name: string): void =>
	attachmentRequest(async (tabId) => {
		await bridge.confluenceOpenAttachment(tabId, name);
		return undefined;
	});

/** A link in a Confluence page to one of its attachments. */
const attachmentOf = (link: HTMLAnchorElement): string | null =>
	session.remote === null ? null : linkedAttachment(link.getAttribute("href") ?? "");

createAttachmentCard({
	t,
	host: deskArea,
	attachmentOf,
	open: openAttachment,
	download: (name) =>
		attachmentRequest(async (tabId) => {
			const path = await bridge.confluenceDownloadAttachment(tabId, name);
			return path === null ? undefined : format(t.confluenceAttachmentSaved, path);
		}),
	manage: (name) => showAttachments(name),
});

// Ctrl+click (or any click while read only) follows a link instead of editing it.
deskArea.addEventListener(
	"click",
	(event) => {
		const link = event.target instanceof Element ? event.target.closest("a") : null;
		if (link === null) return;
		if (!(event.ctrlKey || event.metaKey) && !session.editor.isReadOnly()) return;
		event.preventDefault();
		event.stopPropagation();
		// A Confluence page's attachment opens in the system's app for it.
		const attachment = attachmentOf(link);
		if (attachment !== null) {
			openAttachment(attachment);
			return;
		}
		const href = link.getAttribute("href");
		if (href !== null && href !== "") bridge.openLink(href);
	},
	true,
);

// --- Loading screen -----------------------------------------------------------

const boot = document.getElementById("boot");
if (boot !== null) {
	boot.classList.add("done");
	setTimeout(() => boot.remove(), 200);
}
