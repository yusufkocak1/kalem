import type { Root } from "@kalem-editor/core";
import type { BlockType, MarkType } from "@kalem-editor/core/commands";
import type { Caret, EditResult } from "@kalem-editor/editor";
import { indentItem, outdentItem, toggleList } from "@kalem-editor/editor";
import type { Command, KalemBridge, Settings, SidePane, TabDocument } from "../shared/bridge.js";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, pageRule, ZOOM_STEP } from "../shared/bridge.js";
import { attachmentName, linkedAttachment } from "../shared/confluence-common.js";
import { DIAGRAM_SUFFIX } from "../shared/diagram.js";
import { format, stringsFor } from "../shared/i18n.js";
import { isEditablePath, isPackagePath, isWordPath } from "../shared/paths.js";
import { withColumnWidth } from "../shared/table-style.js";
import { changeCase, collapseSpaces, nextCase } from "../shared/text-case.js";
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
import { createNotices } from "./notices.js";
import { Previews } from "./previews.js";
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
	el("div", { class: "body", children: [navigation, deskArea] }),
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
	readOnlyBadge.hidden = !session.editor.isReadOnly();
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
	tab.session.editor.focus();
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
	// Text fields (source view, find box) keep their own native history.
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
	find: () => session.find?.open("find"),
	replace: () => session.find?.open("replace"),
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
	"read-only": () => session.editor.setReadOnly(!session.editor.isReadOnly()),
	focus: toggleFocusMode,
	"zoom-in": () => setZoom(settings.zoom + ZOOM_STEP),
	"zoom-out": () => setZoom(settings.zoom - ZOOM_STEP),
	"zoom-reset": () => setZoom(100),
	"export-html": () => void tools.exportHtml(),
	"export-docx": () => void tools.exportDocx(),
	"export-confluence": () => void tools.exportConfluence("storage"),
	"export-confluence-wiki": () => void tools.exportConfluence("wiki"),
	"format-code": tools.formatCode,
	"format-all-code": tools.formatAllCode,
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
	inCodeBlock: tools.inCodeBlock,
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
		const isDocument = (path: string): boolean => isEditablePath(path) || isWordPath(path);
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

/** Draws a new diagram and puts its picture at the caret. */
function newDiagram(): void {
	const tab = session;
	if (tab.editor.isReadOnly()) {
		tab.notices.show({ id: "edit", kind: "warning", text: t.readOnlyBlocked });
		return;
	}
	const caret = tab.editor.getCaret();
	diagramEditor.open({
		diagram: null,
		title: t.diagramDefaultName,
		titleEditable: true,
		async save(diagram, title) {
			const name = title === "" ? t.diagramDefaultName : title;
			const bytes = await diagramToPng(diagram);
			let url: string;
			if (tab.remote !== null) {
				url = (await bridge.confluenceWriteDiagram(tab.id, { bytes, title: name })).url;
			} else {
				// Its file goes next to the document, so the document needs a place first.
				if (tab.path === null) await tab.save();
				if (tab.path === null) throw new Error(t.diagramNeedsSave);
				url = await bridge.writeDiagram(tab.path, { bytes, title: name });
			}
			tab.insertDiagram(name, url, caret);
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
			const bytes = await diagramToPng(next);
			if (tab.remote !== null) {
				await bridge.confluenceWriteDiagram(tab.id, { bytes, name: file });
			} else {
				if (tab.path === null) throw new Error(t.diagramNeedsSave);
				await bridge.writeDiagram(tab.path, { bytes, url });
				// Inside a package the file only reaches the package when it is saved.
				if (isPackagePath(tab.path)) tab.markAssetsChanged();
			}
			// The file is served uncached: setting the source again loads the new drawing.
			for (const shown of document.querySelectorAll<HTMLImageElement>("#editor img")) {
				if (shown.getAttribute("src") !== url) continue;
				const source = shown.src;
				shown.removeAttribute("src");
				shown.src = source;
			}
			return true;
		},
	});
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
