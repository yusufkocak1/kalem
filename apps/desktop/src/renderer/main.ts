import type { AlignType, Root, Table } from "@kalem-editor/core";
import { replaceAt } from "@kalem-editor/core";
import type { BlockType, MarkType } from "@kalem-editor/core/commands";
import type { Caret, EditResult } from "@kalem-editor/editor";
import { CODE_ATTR, ID_ATTR, indentItem, outdentItem, toggleList } from "@kalem-editor/editor";
import codeCss from "@kalem-editor/themes/plugin-code.css?inline";
import tokensCss from "@kalem-editor/themes/tokens.css?inline";
import viewerCss from "@kalem-editor/themes/viewer.css?inline";
import type { Command, KalemBridge, Settings, TabDocument } from "../shared/bridge.js";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, pageRule, ZOOM_STEP } from "../shared/bridge.js";
import { formatAllCodeBlocks, formatCodeBlock } from "../shared/code-blocks.js";
import { buildHtmlDocument } from "../shared/html-export.js";
import { format, stringsFor } from "../shared/i18n.js";
import { isEditablePath, isWordPath } from "../shared/paths.js";
import type { SortDirection } from "../shared/table.js";
import {
	alignColumn,
	deleteColumn,
	deleteRow,
	insertColumn,
	insertRow,
	sortRows,
} from "../shared/table.js";
import type { TableColor, TableStyle } from "../shared/table-style.js";
import {
	TABLE_COLORS,
	withColumnDeleted,
	withColumnInserted,
	withColumnWidth,
} from "../shared/table-style.js";
import { el, isTextFieldFocused } from "./dom.js";
import type { TableContext } from "./edits.js";
import {
	codeAt,
	insertDivider,
	insertTable,
	replaceTable,
	tableAt,
	toggleTaskList,
} from "./edits.js";
import { icon } from "./icons.js";
import { createNotices } from "./notices.js";
import type { RibbonButton, RibbonTab, RibbonWidget } from "./ribbon.js";
import {
	createColorMenu,
	createRibbon,
	createStyleGallery,
	createSwatches,
	createTablePicker,
} from "./ribbon.js";
import { Session } from "./session.js";
import { enableColumnResize } from "./table-styles.js";
import { createTabStrip } from "./tabs.js";

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
const navigation = el("nav", {
	class: "navigation kalem-theme",
	attrs: { "aria-label": t.navigation },
	children: [
		el("div", {
			class: "navigation-header",
			children: [el("h2", { text: t.navigation }), closeNavigation],
		}),
		outlineArea,
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
	// The main process closes the window when its last tab is gone.
	bridge.tabClosed(id);
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
	zoomSlider.value = String(settings.zoom);
	zoomValue.textContent = `${settings.zoom}%`;
}

function updateSettings(patch: Partial<Settings>): void {
	settings = { ...settings, ...patch };
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

function editTable(
	change: (context: TableContext) => { table: Table | null; row: number; column: number },
): void {
	edit((doc, caret) => {
		const context = tableAt(doc, caret);
		if (context === null) return null;
		const next = change(context);
		return replaceTable(doc, context, next.table, next.row, next.column);
	});
}

const LANGUAGE_NAMES = {
	json: "JSON",
	jsonc: "JSONC",
	xml: "XML",
	html: "HTML",
	yaml: "YAML",
} as const;

interface CodeLocation {
	/** Path of the code node from the document root. */
	readonly path: readonly number[];
	readonly blockId: string;
	/** Value of the holder's `data-kalem-code` attribute. */
	readonly holderKey: string;
}

/**
 * `editor.getCaret()` is null inside code blocks (they are edited as source,
 * not inline content), so the block is located from the DOM selection.
 */
function codeLocation(): CodeLocation | null {
	const selection = document.getSelection();
	if (selection === null || selection.rangeCount === 0) return null;
	const node = selection.getRangeAt(0).startContainer;
	const holder = (node instanceof Element ? node : node.parentElement)?.closest(`[${CODE_ATTR}]`);
	const block = holder?.closest(`[${ID_ATTR}]`);
	if (holder == null || block == null || !canvas.contains(block)) return null;

	const blockId = block.getAttribute(ID_ATTR) ?? "";
	const blockIndex = session.editor.getBlockIds().indexOf(blockId);
	if (blockIndex < 0) return null;
	const holderKey = holder.getAttribute(CODE_ATTR) ?? "";
	const inner = holderKey === "" ? [] : holderKey.split(".").map(Number);
	return { path: [blockIndex, ...inner], blockId, holderKey };
}

/** Pretty-prints the code block at the caret. */
function formatCode(): void {
	const editor = session.editor;
	if (inSource()) return;
	if (editor.isReadOnly()) {
		warn(t.readOnlyBlocked);
		return;
	}
	const location = codeLocation();
	const context = codeAt(editor.getDocument(), location?.path ?? null);
	if (location === null || context === null) {
		warn(t.formatNotCode);
		return;
	}

	const { result, code } = formatCodeBlock(context.code);
	if (!result.ok) {
		warn(
			result.reason === "invalid"
				? format(t.formatInvalid, LANGUAGE_NAMES[result.language], result.message)
				: t.formatUnsupported,
		);
		return;
	}
	session.notices.dismiss("edit");
	if (code === null) return;
	editor.applyEdit({ doc: replaceAt(editor.getDocument(), context.path, code), caret: null });
	restoreCodeCaret(location);
}

/** A formatted block is re-rendered and loses the caret; put it back so the Code tab stays. */
function restoreCodeCaret(location: CodeLocation | null): void {
	if (location === null) return;
	const block = session.editor.getBlockElement(location.blockId);
	const holder = block?.querySelector(`[${CODE_ATTR}="${location.holderKey}"]`);
	if (block === undefined || holder == null) return;
	block.focus({ preventScroll: true });
	document.getSelection()?.setPosition(holder, 0);
}

function formatAllCode(): void {
	const editor = session.editor;
	if (inSource()) return;
	if (editor.isReadOnly()) {
		warn(t.readOnlyBlocked);
		return;
	}
	const location = codeLocation();
	const { doc, formatted, invalid } = formatAllCodeBlocks(editor.getDocument());
	if (formatted > 0) {
		editor.applyEdit({ doc, caret: null });
		restoreCodeCaret(location);
	}
	session.notices.show({
		id: "edit",
		kind: invalid > 0 ? "warning" : "info",
		text:
			invalid > 0
				? format(t.formatAllSkipped, formatted, invalid)
				: formatted > 0
					? format(t.formatAllDone, formatted)
					: t.formatAllNone,
	});
}

async function exportDocx(): Promise<void> {
	try {
		await bridge.writeDocx(session.id, session.name, session.styledMarkdown());
	} catch (error) {
		session.notices.show({
			id: "export",
			kind: "error",
			text: `${t.exportFailed}: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

async function exportHtml(): Promise<void> {
	const html = buildHtmlDocument({
		markdown: session.styledMarkdown(),
		title: session.name,
		lang: startup.language,
		css: [tokensCss, viewerCss, codeCss].join("\n"),
	});
	try {
		await bridge.writeHtml(session.name, html);
	} catch (error) {
		session.notices.show({
			id: "export",
			kind: "error",
			text: `${t.exportFailed}: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

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
	"export-html": () => void exportHtml(),
	"export-docx": () => void exportDocx(),
	"format-code": formatCode,
	"format-all-code": formatAllCode,
};

// The ribbon reads editor state as soon as it is built, so the documents come first.
applySettings();
for (const document of startup.documents) openDocument(document);

// --- Ribbon -----------------------------------------------------------------

const MOD = startup.platform === "darwin" ? "Cmd" : "Ctrl";

function currentBlock(): Root["children"][number] | undefined {
	const caret = session.editor.getCaret();
	return caret === null ? undefined : session.editor.getDocument().children[caret.blockIndex];
}

function currentTable(): TableContext | null {
	return inSource() ? null : tableAt(session.editor.getDocument(), session.editor.getCaret());
}

function inCodeBlock(): boolean {
	return !inSource() && codeLocation() !== null;
}

function isList(ordered: boolean): boolean {
	const block = currentBlock();
	return block?.type === "list" && block.ordered === ordered;
}

function isTaskList(): boolean {
	const block = currentBlock();
	return block?.type === "list" && block.children.every((item) => item.checked !== null);
}

function command(
	id: Command,
	label: string,
	iconName: RibbonButton["icon"],
	extra: Partial<RibbonButton> = {},
): RibbonButton {
	return { id, label, icon: iconName, run: commands[id], enabled: canEdit, ...extra };
}

function markButton(id: Command, label: string, mark: MarkType, shortcut: string): RibbonButton {
	return command(id, label, id === "inline-code" ? "code" : (id as RibbonButton["icon"]), {
		shortcut,
		pressed: () => canEdit() && session.editor.isMarkActive(mark),
	});
}

function styleActive(type: BlockType["type"], depth?: number): () => boolean {
	return () => {
		const current = session.editor.getBlockType();
		if (current === null || current.type !== type) return false;
		return current.type !== "heading" || current.depth === depth;
	};
}

const styleGallery = createStyleGallery(
	t.groupStyles,
	[
		{
			id: "normal",
			label: t.styleNormal,
			shortcut: `${MOD}+Alt+0`,
			active: styleActive("paragraph"),
			apply: commands.paragraph,
		},
		...([1, 2, 3] as const).map((depth) => ({
			id: `heading-${depth}`,
			label: format(t.heading, depth),
			shortcut: `${MOD}+Alt+${depth}`,
			active: styleActive("heading", depth),
			apply: commands[`heading-${depth}`],
		})),
		{ id: "quote", label: t.quote, active: styleActive("blockquote"), apply: commands.quote },
		{ id: "code", label: t.styleCode, active: styleActive("code"), apply: commands["code-block"] },
	],
	canEdit,
);

const tablePicker = createTablePicker({
	label: t.table,
	dialogLabel: t.insertTable,
	sizeLabel: (rows, columns) => (rows === 0 ? t.insertTable : format(t.tableSize, rows, columns)),
	pick: (rows, columns) => edit((doc, caret) => insertTable(doc, caret, rows, columns)),
	enabled: canEdit,
});

const zoomReset = el("button", {
	class: "ribbon-button ribbon-zoom-value",
	attrs: { type: "button", "data-command": "zoom-reset", title: t.zoomReset },
});
zoomReset.addEventListener("mousedown", (event) => event.preventDefault());
zoomReset.addEventListener("click", commands["zoom-reset"]);
const zoomWidget: RibbonWidget = {
	kind: "widget",
	element: zoomReset,
	update() {
		zoomReset.textContent = `${settings.zoom}%`;
	},
};

function toggle(
	id: string,
	label: string,
	iconName: RibbonButton["icon"],
	isOn: () => boolean,
	run: () => void,
	showLabel = true,
): RibbonButton {
	return { id, label, icon: iconName, showLabel, run, pressed: isOn };
}

function themeButton(theme: Settings["theme"], label: string, iconName: RibbonButton["icon"]) {
	return toggle(
		`theme-${theme}`,
		label,
		iconName,
		() => settings.theme === theme,
		() => updateSettings({ theme }),
		false,
	);
}

function tableButton(
	id: string,
	label: string,
	iconName: RibbonButton["icon"],
	change: Parameters<typeof editTable>[0],
	extra: Partial<RibbonButton> = {},
): RibbonButton {
	return { id, label, icon: iconName, run: () => editTable(change), enabled: canEdit, ...extra };
}

function tableId(context: TableContext): string | undefined {
	return session.editor.getBlockIds()[context.blockIndex];
}

/** Column widths are stored by index, so they have to follow inserted and deleted columns. */
function restyle(context: TableContext, change: (style: TableStyle) => TableStyle): void {
	const id = tableId(context);
	if (id !== undefined) session.setTableStyle(id, change(session.tableStyle(id)));
}

const COLUMN_WIDTH_STEP = 24;

/** Changes the width of the caret's column by `delta` pixels; `null` makes it automatic again. */
function resizeColumn(delta: number | null): void {
	if (!canEdit()) return;
	const context = currentTable();
	const id = context === null ? undefined : tableId(context);
	if (context === null || id === undefined) return;

	const style = session.tableStyle(id);
	if (delta === null) {
		session.setTableStyle(id, withColumnWidth(style, context.column, null));
		return;
	}
	const element = session.editor.getBlockElement(id);
	const header =
		element instanceof HTMLTableElement ? element.rows[0]?.cells[context.column] : undefined;
	const measured =
		header === undefined ? 120 : header.getBoundingClientRect().width / (settings.zoom / 100);
	const current = style.widths[context.column] ?? measured;
	session.setTableStyle(id, withColumnWidth(style, context.column, current + delta));
}

function sortButton(direction: SortDirection, label: string, iconName: RibbonButton["icon"]) {
	return tableButton(
		`table-sort-${direction}`,
		label,
		iconName,
		({ table, row, column }) => ({
			table: sortRows(table, column, direction, startup.language),
			row,
			column,
		}),
		{ showLabel: true },
	);
}

const COLOR_LABELS: Record<TableColor, string> = {
	gray: t.colorGray,
	blue: t.colorBlue,
	teal: t.colorTeal,
	green: t.colorGreen,
	orange: t.colorOrange,
	red: t.colorRed,
	purple: t.colorPurple,
};

const tableColors = createSwatches<TableColor>({
	label: t.groupColor,
	noneLabel: t.colorNone,
	options: TABLE_COLORS.map((color) => ({ value: color, label: COLOR_LABELS[color] })),
	current: () => {
		const context = currentTable();
		const id = context === null ? undefined : tableId(context);
		return id === undefined ? null : session.tableStyle(id).color;
	},
	pick: (color) => {
		const context = currentTable();
		if (context !== null && canEdit()) restyle(context, (style) => ({ ...style, color }));
	},
	enabled: canEdit,
});

const textColors = createColorMenu({
	id: "text-color",
	icon: "textColor",
	label: t.textColor,
	noneLabel: t.textColorNone,
	colors: [
		{ value: "#e03131", label: t.colorRed },
		{ value: "#e8590c", label: t.colorOrange },
		{ value: "#f08c00", label: t.colorYellow },
		{ value: "#2f9e44", label: t.colorGreen },
		{ value: "#0c8599", label: t.colorTeal },
		{ value: "#1c7ed6", label: t.colorBlue },
		{ value: "#7950f2", label: t.colorPurple },
		{ value: "#d6336c", label: t.colorPink },
		{ value: "#868e96", label: t.colorGray },
	],
	current: () => session.editor.getColor(),
	customLabel: t.moreColors,
	pick: (color) => {
		if (!session.editor.setColor(color)) warn(t.selectTextFirst);
	},
	enabled: canEdit,
});

function alignButton(
	align: AlignType,
	label: string,
	iconName: RibbonButton["icon"],
): RibbonButton {
	const isActive = (): boolean => {
		const context = currentTable();
		return context !== null && context.table.align[context.column] === align;
	};
	return tableButton(
		`table-align-${align}`,
		label,
		iconName,
		({ table, row, column }) => ({
			// Clicking the active alignment clears it.
			table: alignColumn(table, column, table.align[column] === align ? null : align),
			row,
			column,
		}),
		{ pressed: isActive },
	);
}

const ribbonTabs: RibbonTab[] = [
	{
		id: "home",
		label: t.tabHome,
		groups: [
			{
				label: t.groupClipboard,
				items: [
					{
						id: "paste",
						label: t.paste,
						icon: "paste",
						showLabel: true,
						shortcut: `${MOD}+V`,
						run: () => bridge.clipboard("paste"),
						enabled: canEdit,
					},
					{
						id: "cut",
						label: t.cut,
						icon: "cut",
						shortcut: `${MOD}+X`,
						run: () => bridge.clipboard("cut"),
						enabled: canEdit,
					},
					{
						id: "copy",
						label: t.copy,
						icon: "copy",
						shortcut: `${MOD}+C`,
						run: () => bridge.clipboard("copy"),
					},
				],
			},
			{ label: t.groupStyles, items: [styleGallery] },
			{
				label: t.groupFont,
				items: [
					markButton("bold", t.bold, "strong", `${MOD}+B`),
					markButton("italic", t.italic, "emphasis", `${MOD}+I`),
					markButton("strikethrough", t.strikethrough, "delete", `${MOD}+Shift+X`),
					markButton("inline-code", t.inlineCode, "inlineCode", `${MOD}+E`),
					textColors,
					{ kind: "separator" },
					command("link", t.link, "link", {
						shortcut: `${MOD}+K`,
						pressed: () => canEdit() && session.editor.getActiveLink() !== null,
					}),
				],
			},
			{
				label: t.groupParagraph,
				items: [
					command("bullet-list", t.bulletList, "bulletList", {
						shortcut: `${MOD}+Shift+8`,
						pressed: () => isList(false) && !isTaskList(),
					}),
					command("ordered-list", t.orderedList, "orderedList", {
						shortcut: `${MOD}+Shift+7`,
						pressed: () => isList(true),
					}),
					command("task-list", t.taskList, "taskList", { pressed: isTaskList }),
					{ kind: "separator" },
					command("outdent", t.outdent, "outdent", { shortcut: "Shift+Tab" }),
					command("indent", t.indent, "indent", { shortcut: "Tab" }),
					{ kind: "separator" },
					command("merge-blocks", t.mergeBlocks, "mergeBlocks", {
						shortcut: `${MOD}+Shift+M`,
						enabled: () => canEdit() && session.editor.canMergeBlocks(),
					}),
				],
			},
			{
				label: t.groupEditing,
				items: [
					{
						id: "find",
						label: t.find,
						icon: "find",
						showLabel: true,
						shortcut: `${MOD}+F`,
						run: commands.find,
						enabled: () => !inSource(),
					},
					command("replace", t.replace, "replace", { shortcut: `${MOD}+H` }),
				],
			},
		],
	},
	{
		id: "insert",
		label: t.tabInsert,
		groups: [
			{
				label: t.groupElements,
				items: [
					command("image", t.image, "image", { showLabel: true }),
					command("attach-file", t.attachFile, "attach", { showLabel: true }),
					tablePicker,
					command("link", t.link, "link", { showLabel: true, shortcut: `${MOD}+K` }),
				],
			},
			{
				label: t.groupBlocks,
				items: [
					command("divider", t.divider, "divider", { showLabel: true }),
					command("code-block", t.codeBlock, "codeBlock", { showLabel: true }),
					command("quote", t.quote, "quote", { showLabel: true }),
					command("task-list", t.taskList, "taskList", { showLabel: true }),
				],
			},
			{
				label: t.groupImport,
				items: [
					{
						id: "import-word",
						label: t.wordDocument,
						icon: "word",
						showLabel: true,
						shortcut: `${MOD}+Shift+O`,
						run: () => void bridge.importWord(),
					},
				],
			},
		],
	},
	{
		id: "view",
		label: t.tabView,
		groups: [
			{
				label: t.groupViews,
				items: [
					toggle(
						"navigation",
						t.navigationPane,
						"navigation",
						() => settings.navigation,
						() => updateSettings({ navigation: !settings.navigation }),
					),
					{
						...toggle("source", t.markdownSource, "source", inSource, commands.source),
						shortcut: `${MOD}+Shift+M`,
					},
					toggle(
						"read-only",
						t.readOnly,
						"readOnly",
						() => session.editor.isReadOnly(),
						commands["read-only"],
					),
					{
						...toggle(
							"focus",
							t.focusMode,
							"focus",
							() => app.hasAttribute("data-focus"),
							commands.focus,
						),
						shortcut: `${MOD}+Shift+F`,
					},
				],
			},
			{
				label: t.groupZoom,
				items: [
					{
						id: "zoom-out",
						label: t.zoomOut,
						icon: "zoomOut",
						shortcut: `${MOD}+-`,
						run: commands["zoom-out"],
						enabled: () => settings.zoom > MIN_ZOOM,
					},
					zoomWidget,
					{
						id: "zoom-in",
						label: t.zoomIn,
						icon: "zoomIn",
						shortcut: `${MOD}++`,
						run: commands["zoom-in"],
						enabled: () => settings.zoom < MAX_ZOOM,
					},
					{ kind: "separator" },
					toggle(
						"full-width",
						t.fullWidth,
						"fullWidth",
						() => settings.fullWidth,
						() => updateSettings({ fullWidth: !settings.fullWidth }),
						false,
					),
				],
			},
			{
				label: t.groupTheme,
				items: [
					themeButton("light", t.themeLight, "themeLight"),
					themeButton("dark", t.themeDark, "themeDark"),
					themeButton("system", t.themeSystem, "themeSystem"),
				],
			},
			{
				label: t.groupOptions,
				items: [
					toggle(
						"spell-check",
						t.spellCheck,
						"spellCheck",
						() => settings.spellCheck,
						() => updateSettings({ spellCheck: !settings.spellCheck }),
					),
					toggle(
						"auto-save",
						t.autoSave,
						"autoSave",
						() => settings.autoSave,
						() => updateSettings({ autoSave: !settings.autoSave }),
					),
				],
			},
		],
	},
	{
		id: "table",
		label: t.tabTable,
		visible: () => currentTable() !== null,
		groups: [
			{
				label: t.groupRows,
				items: [
					tableButton("table-row-above", t.rowAbove, "rowAbove", ({ table, row, column }) => ({
						table: insertRow(table, row),
						row,
						column,
					})),
					tableButton("table-row-below", t.rowBelow, "rowBelow", ({ table, row, column }) => ({
						table: insertRow(table, row + 1),
						row: row + 1,
						column,
					})),
					tableButton("table-delete-row", t.deleteRow, "deleteRow", ({ table, row, column }) => ({
						table: deleteRow(table, row),
						row: Math.max(0, row - 1),
						column,
					})),
				],
			},
			{
				label: t.groupColumns,
				items: [
					tableButton("table-column-left", t.columnLeft, "columnLeft", (context) => {
						restyle(context, (style) => withColumnInserted(style, context.column));
						return {
							table: insertColumn(context.table, context.column),
							row: context.row,
							column: context.column,
						};
					}),
					tableButton("table-column-right", t.columnRight, "columnRight", (context) => {
						restyle(context, (style) => withColumnInserted(style, context.column + 1));
						return {
							table: insertColumn(context.table, context.column + 1),
							row: context.row,
							column: context.column + 1,
						};
					}),
					tableButton("table-delete-column", t.deleteColumn, "deleteColumn", (context) => {
						restyle(context, (style) => withColumnDeleted(style, context.column));
						return {
							table: deleteColumn(context.table, context.column),
							row: context.row,
							column: Math.max(0, context.column - 1),
						};
					}),
				],
			},
			{
				label: t.groupColumnWidth,
				items: [
					{
						id: "table-column-narrow",
						label: t.narrowColumn,
						icon: "columnNarrow",
						run: () => resizeColumn(-COLUMN_WIDTH_STEP),
						enabled: canEdit,
					},
					{
						id: "table-column-widen",
						label: t.widenColumn,
						icon: "columnWiden",
						run: () => resizeColumn(COLUMN_WIDTH_STEP),
						enabled: canEdit,
					},
					{
						id: "table-column-auto",
						label: t.autoColumnWidth,
						icon: "columnAuto",
						run: () => resizeColumn(null),
						enabled: canEdit,
					},
				],
			},
			{
				label: t.groupAlignment,
				items: [
					alignButton("left", t.alignLeft, "alignLeft"),
					alignButton("center", t.alignCenter, "alignCenter"),
					alignButton("right", t.alignRight, "alignRight"),
				],
			},
			{
				label: t.groupSort,
				items: [
					sortButton("ascending", t.sortAscending, "sortAscending"),
					sortButton("descending", t.sortDescending, "sortDescending"),
				],
			},
			{ label: t.groupColor, items: [tableColors] },
			{
				label: t.table,
				items: [
					tableButton(
						"table-delete",
						t.deleteTable,
						"deleteTable",
						() => ({ table: null, row: 0, column: 0 }),
						{ showLabel: true },
					),
				],
			},
		],
	},
	{
		id: "code",
		label: t.tabCode,
		visible: inCodeBlock,
		groups: [
			{
				label: t.groupCode,
				items: [
					command("format-code", t.formatCode, "braces", {
						showLabel: true,
						shortcut: "Shift+Alt+F",
					}),
					command("format-all-code", t.formatAllCode, "bracesAll", { showLabel: true }),
				],
			},
		],
	},
];

const ribbon = createRibbon(ribbonHost, {
	label: t.ribbon,
	fileButton: { label: t.file, open: (x, y) => bridge.showFileMenu(x, y) },
	quickAccess: {
		label: t.quickAccess,
		buttons: [
			{ id: "save", label: t.save, icon: "save", shortcut: `${MOD}+S`, run: commands.save },
			{
				id: "undo",
				label: t.undo,
				icon: "undo",
				shortcut: `${MOD}+Z`,
				run: commands.undo,
				enabled: () => canEdit() && session.editor.canUndo(),
			},
			{
				id: "redo",
				label: t.redo,
				icon: "redo",
				shortcut: `${MOD}+Y`,
				run: commands.redo,
				enabled: () => canEdit() && session.editor.canRedo(),
			},
		],
	},
	tabs: ribbonTabs,
	trailing: saveStatus,
});

// The editor reports no selection inside code blocks, so moving into or between
// them would not refresh the contextual Code tab.
document.addEventListener("selectionchange", scheduleRibbonUpdate);

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
bridge.onSettings((next) => {
	settings = next;
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

// Ctrl+click (or any click while read only) follows a link instead of editing it.
deskArea.addEventListener(
	"click",
	(event) => {
		const link = event.target instanceof Element ? event.target.closest("a") : null;
		if (link === null) return;
		if (!(event.ctrlKey || event.metaKey) && !session.editor.isReadOnly()) return;
		event.preventDefault();
		event.stopPropagation();
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
