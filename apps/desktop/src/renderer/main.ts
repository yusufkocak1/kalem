import type { Root } from "@kalem-editor/core";
import type { BlockType, MarkType } from "@kalem-editor/core/commands";
import type { Caret, EditResult } from "@kalem-editor/editor";
import { holderIn, indentItem, outdentItem, selectRange, toggleList } from "@kalem-editor/editor";
import { outlineOf } from "@kalem-editor/plugin-outline";
import { countWords } from "@kalem-editor/plugin-word-count";
import type { DocumentAction } from "../shared/actions.js";
import { applyActions } from "../shared/actions.js";
import type {
	Command,
	ExtensionStatusItem,
	KalemBridge,
	SessionTab,
	Settings,
	TabDocument,
} from "../shared/bridge.js";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, pageRule, ZOOM_STEP } from "../shared/bridge.js";
import type { ContextDiagram, ProposedEdit, ReplyDiagram } from "../shared/claude.js";
import { splitReply } from "../shared/claude.js";
import { displayUrl } from "../shared/confluence-atoms.js";
import { attachmentName, linkedAttachment } from "../shared/confluence-common.js";
import type { Diagram } from "../shared/diagram.js";
import { DIAGRAM_SUFFIX, serializeDiagram } from "../shared/diagram.js";
import { keptProposals, placeProposals } from "../shared/edit-review.js";
import { format, stringsFor } from "../shared/i18n.js";
import { noteKey } from "../shared/local-notes.js";
import { paletteCss, systemAccentCss } from "../shared/palette.js";
import type { BuiltinPane, ToolPane } from "../shared/panes.js";
import {
	extensionPaneId,
	isExtensionPane,
	isPaneShown,
	oneOnEachSide,
	revealPane,
	togglePane,
} from "../shared/panes.js";
import {
	extension,
	isEditablePath,
	isPackagePath,
	isWordPath,
	TEXT_EXTENSIONS,
} from "../shared/paths.js";
import { rolePreset } from "../shared/roles.js";
import type { SettingPage } from "../shared/settings-pages.js";
import { withColumnWidth } from "../shared/table-style.js";
import { changeCase, collapseSpaces, nextCase } from "../shared/text-case.js";
import { typographyVars } from "../shared/typography.js";
import { createAssistantPane } from "./assistant-pane.js";
import { createAttachmentCard } from "./attachment-card.js";
import { createChangesDialog } from "./changes-dialog.js";
import type { CodeReviewUi } from "./code-review.js";
import { createCodeReview } from "./code-review.js";
import { createCommandPalette } from "./command-palette.js";
import { createAttachmentsDialog, linkedAttachments } from "./confluence-attachments.js";
import { createConfluenceDialog } from "./confluence-dialog.js";
import { createConfluencePane } from "./confluence-pane.js";
import { createPublishDialog } from "./confluence-publish-dialog.js";
import { createDiagramButton, isDiagramImage } from "./diagram-button.js";
import { createDiagramEditor } from "./diagram-editor.js";
import { diagramFromImage, diagramToPng } from "./diagram-image.js";
import { createDocks } from "./docks.js";
import type { MapMark } from "./document-map.js";
import { createDocumentMap } from "./document-map.js";
import { markQuotes, revealQuote } from "./document-marks.js";
import { createDocumentTools } from "./document-tools.js";
import { el, isTextFieldFocused } from "./dom.js";
import type { EditReviewUi } from "./edit-review.js";
import { createEditReview } from "./edit-review.js";
import type { TableContext, TableEdit } from "./edits.js";
import { insertDivider, insertTable, replaceTable, tableAt, toggleTaskList } from "./edits.js";
import type { ExtensionPanes } from "./extension-panes.js";
import { createExtensionPanes } from "./extension-panes.js";
import { createFilesPane } from "./files-pane.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";
import { createImageViewer } from "./image-viewer.js";
import { createJiraDialog } from "./jira-dialog.js";
import { createJiraPane } from "./jira-pane.js";
import type { LineNumbers } from "./line-numbers.js";
import { createLineNumbers } from "./line-numbers.js";
import { createLinkCard } from "./link-card.js";
import type { NotesTarget } from "./local-notes.js";
import { createLocalNotes } from "./local-notes.js";
import { createMergeDialog } from "./merge-dialog.js";
import { createNetworkPanel } from "./network-panel.js";
import { createNotices } from "./notices.js";
import { createPathBar } from "./path-bar.js";
import { Previews } from "./previews.js";
import { documentImages } from "./prompt-images.js";
import { createQuickOpen, workspaceItems } from "./quick-open.js";
import { createAppRibbon } from "./ribbon-layout.js";
import { createRolePicker } from "./role-picker.js";
import { createSelectionAssistant } from "./selection-assistant.js";
import type { ConfluenceMergePlan } from "./session.js";
import { ipcErrorMessage, Session } from "./session.js";
import { createSettingsDialog } from "./settings-dialog.js";
import type { StartAction } from "./start-page.js";
import { createStartPage } from "./start-page.js";
import { enableColumnResize } from "./table-styles.js";
import { createTabStrip } from "./tabs.js";
import { createTemplatePicker } from "./template-picker.js";
import { measureDiagramText } from "./text-measure.js";
import { attachTip } from "./tip.js";
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
measureDiagramText();
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

/** The note kinds' highlights (local-notes.ts), read for the document map. */
const NOTE_HIGHLIGHTS = ["question", "attention", "later", "note"] as const;

/**
 * The document's map beside the scrollbar (`documentMap`): where the
 * headings, the notes, the assistant's changes and what was found are.
 */
const documentMap = createDocumentMap({
	t,
	desk: () => {
		if (!settings.documentMap || app.hasAttribute("data-focus")) return null;
		const tab = tabs.get(session.id);
		return tab === undefined || tab.session.isText ? null : tab.desk;
	},
	extent: (desk) => {
		const tab = tabs.get(session.id);
		if (tab === undefined) return 0;
		return (
			tab.canvas.getBoundingClientRect().bottom - desk.getBoundingClientRect().top + desk.scrollTop
		);
	},
	marks: (desk) => {
		const tab = tabs.get(session.id);
		if (tab === undefined) return [];
		const origin = desk.getBoundingClientRect().top - desk.scrollTop;
		const at = (box: DOMRect): number => box.top - origin;
		const marks: MapMark[] = [];
		for (const heading of tab.canvas.querySelectorAll<HTMLElement>(
			".kalem-editor > :is(h1, h2, h3)",
		)) {
			const text = heading.textContent?.trim() ?? "";
			if (text === "") continue;
			marks.push({
				kind: "heading",
				top: at(heading.getBoundingClientRect()),
				label: text,
				detail: heading.localName,
			});
		}
		for (const changed of tab.canvas.querySelectorAll<HTMLElement>(
			"[data-ai-change], [data-ai-was], [data-ai-gone]",
		)) {
			marks.push({
				kind: "change",
				top: at(changed.getBoundingClientRect()),
				label: t.documentMapChange,
			});
		}
		const registry = (CSS as { highlights?: Map<string, Iterable<AbstractRange>> }).highlights;
		for (const kind of NOTE_HIGHLIGHTS) {
			for (const range of registry?.get(`kalem-note-${kind}`) ?? []) {
				if (!(range instanceof Range)) continue;
				marks.push({
					kind: "note",
					top: at(range.getBoundingClientRect()),
					label: range.toString(),
					detail: kind,
				});
			}
		}
		// The canvas is the editor's element itself, or holds it.
		const editor = tab.canvas.matches(".kalem-editor")
			? tab.canvas
			: tab.canvas.querySelector(".kalem-editor");
		const blocks = editor?.children;
		const found = new Set((tab.session.find?.matches() ?? []).map((match) => match.blockIndex));
		for (const index of found) {
			const block = blocks?.[index];
			if (block !== undefined)
				marks.push({
					kind: "found",
					top: at(block.getBoundingClientRect()),
					label: t.documentMapFound,
				});
		}
		return marks;
	},
});
deskArea.append(documentMap.element);
window.addEventListener("resize", () => documentMap.refresh());

/** Where the active document is, above its page: `project › specs › payment.md`. */
const pathBar = createPathBar({
	t,
	lang: startup.language,
	where: () => {
		const tab = tabs.get(session.id);
		// A text file's own toolbar is at the top of its view, and names it.
		if (tab === undefined || tab.session.isText) return null;
		return { path: tab.session.path, remote: tab.session.remote };
	},
	workspace: () => bridge.getWorkspace(),
	open: (path) => void bridge.openPath(path),
});
deskArea.append(pathBar.element);
/** The path last shown, so a state change that keeps it does not ask for the workspace again. */
let pathShown: string | undefined;
function refreshPathBar(force = false): void {
	const where = `${session.path ?? ""}|${session.remote?.id ?? ""}`;
	if (!force && where === pathShown) return;
	pathShown = where;
	pathBar.refresh();
}
// What the search finds changes as it is typed in its box.
document.addEventListener("input", (event) => {
	if (event.target instanceof Element && event.target.closest(".kalem-find") !== null)
		documentMap.refresh();
});
const outlineArea = el("div", { class: "navigation-content" });
const wordCountArea = el("div", { class: "status-counts" });

const filesPane = createFilesPane({
	t,
	bridge,
	lang: startup.language,
	activePath: () => session?.path ?? null,
	open: (path, query) => void openFromFolder(path, query),
	notify: (text) => session.notices.show({ id: "files", kind: "error", text }),
	inform: (text) => session.notices.show({ id: "files", kind: "info", text }),
	// The open folders are the assistant's workspace.
	listed: () => assistant.workspaceChanged(),
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
		void refreshAccounts();
	},
});
const publishDialog = createPublishDialog({
	t,
	bridge,
	space: () => settings.confluenceSpace,
	setSpace: (key) => updateSettings({ confluenceSpace: key }),
	connect: () => void confluenceDialog.show(),
});
const mergeDialog = createMergeDialog(t);
const changesDialog = createChangesDialog({
	t,
	reviewBeforeSave: () => settings.confluenceReviewBeforeSave,
	setReviewBeforeSave: (value) => updateSettings({ confluenceReviewBeforeSave: value }),
});
/**
 * The counts on the edges' buttons follow the notes and the assistant's
 * changes; set once the buttons are built (the notes come first).
 */
let refreshBadges: () => void = () => undefined;
let showAssistantBusy: (busy: boolean) => void = () => undefined;

// The user's own notes beside the text: on this computer only, never in the document.
const localNotes = createLocalNotes({
	t,
	bridge,
	lang: startup.language,
	visible: () => settings.localNotes,
	shown: () => docks.shown().has("notes"),
	reveal: () => {
		const before = docks.shown();
		updateSettings(revealPane(settings, "notes"));
		refreshShown(before);
	},
	notify: (text, actions) =>
		session.notices.show({ id: "notes", text, ...(actions === undefined ? {} : { actions }) }),
	changed: () => {
		documentMap.refresh();
		refreshBadges();
	},
	// Beside the lines while the pane is at the page's side (not under it) and the setting is on.
	aligned: () => {
		if (!settings.notesAligned || !docks.shown().has("notes")) return null;
		if (settings.panePlaces.notes === "bottom") return null;
		return tabs.get(session.id)?.desk ?? null;
	},
});
const jiraDialog = createJiraDialog({
	t,
	lang: startup.language,
	bridge,
	openLink: (url) => bridge.openLink(url),
	onAccountChange: () => void refreshAccounts(),
	favorites: () => settings.jiraFavorites,
	setFavorites: (favorites) => {
		updateSettings({ jiraFavorites: favorites });
		jiraPane.favoritesChanged();
	},
	layout: () => settings.jiraIssueLayout,
	setLayout: (layout) => updateSettings({ jiraIssueLayout: layout }),
	onIssueChange: () => {
		if (docks.shown().has("jira")) void jiraPane.refresh();
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
	activeSpace: () => session?.remote?.spaceKey ?? null,
	connect: () => void confluenceDialog.show(),
});
const quickOpen = createQuickOpen({
	t,
	lang: startup.language,
	workspace: () => bridge.getWorkspace(),
	open: (path) => void bridge.openPath(path),
	commands: (query) => void commandPalette.show(query, "commands"),
});
/** The empty chat's suggestions follow the document, once its typing pauses. */
let suggestTimer: ReturnType<typeof setTimeout> | undefined;
function suggestSoon(): void {
	clearTimeout(suggestTimer);
	suggestTimer = setTimeout(() => assistant.documentChanged(), 600);
}

/** Who the app is set up for: asked at its first start, and from the View menu. */
const rolePicker = createRolePicker({
	t,
	pick: (role) => updateSettings(rolePreset(role, settings)),
});

/**
 * Home is an empty, untitled tab: its start page is it. One open already is
 * brought forward; else a new one is opened.
 */
function openHome(): void {
	for (const [id, tab] of tabs) {
		const doc = tab.session;
		const empty =
			!doc.isText &&
			doc.path === null &&
			doc.remote === null &&
			!doc.dirty &&
			doc.styledMarkdown().trim() === "";
		if (empty) {
			activateTab(id);
			return;
		}
	}
	bridge.newTab();
}

/** The assistant where the text is: in the selection's bubble, and under the caret (Ctrl+J). */
const selectionAssistant = createSelectionAssistant({
	t,
	ask: (prompt) => {
		if (!settings.assistant) updateSettings({ assistant: true });
		// Asked about the document's text: the document goes with it.
		assistant.ask(prompt, { document: true });
	},
});

/** The menu's commands by name (F1, or `>` in Quick Open). */
const commandPalette = createCommandPalette({
	t,
	lang: startup.language,
	commands: () => bridge.paletteCommands(),
	run: (id) => bridge.runPaletteCommand(id),
	files: async () => workspaceItems(await bridge.getWorkspace()),
	openFile: (path) => void bridge.openPath(path),
	headings: () =>
		session.headings().map((heading) => ({ text: heading.text, level: heading.level })),
	goToHeading: (index) => session.goToHeading(index),
	ask: (question) => {
		if (!settings.assistant) updateSettings({ assistant: true });
		assistant.ask(question);
	},
});

/** Where the caret last was in each tab's document, and the text last selected in it. */
const lastCarets = new WeakMap<Session, Caret>();
let lastSelection = "";

/** Shows the active document's changes waiting for review in the chat's list of changes. */
function syncEdits(): void {
	const tab = [...tabs.values()].find((each) => each.session === session);
	const review = tab?.review;
	const summary = review?.summary() ?? null;
	showAssistantEdits(summary?.items.length ?? 0);
	assistant.documentEdits(
		review === undefined || summary === null
			? null
			: {
					name: session.path?.split(/[\\/]/).pop() ?? session.name,
					summary,
					acceptAll: () => review.acceptAll(),
					rejectAll: () => review.rejectAll(),
					select: (index) => review.select(index),
				},
	);
}

/** The files whose proposed changes are reviewed in their tab, by the first change's id. */
const codeReviews = new Map<string, Tab>();

/** The tab of a file, once it is open (opening one is asked of the main process). */
async function tabOfPath(path: string): Promise<Tab | undefined> {
	// kalem-locale-ok: a file path, compared as Windows does (case does not matter)
	const key = (value: string | null): string => (value ?? "").replace(/\\/g, "/").toLowerCase();
	for (let tries = 0; tries < 60; tries++) {
		const found = [...tabs.values()].find((each) => key(each.session.path) === key(path));
		if (found !== undefined && (found.session.textView !== null || !found.session.isText)) {
			return found;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return undefined;
}

/** The tab a file's proposed changes are reviewed in, while it is open and the review waits. */
function codeReviewTab(id: string): Tab | undefined {
	const tab = codeReviews.get(id);
	if (tab === undefined) return undefined;
	if (![...tabs.values()].includes(tab) || !tab.codeReview.active()) {
		codeReviews.delete(id);
		return undefined;
	}
	return tab;
}

/** Opens a file's proposed changes in its tab, a line at a time, to accept or reject there. */
async function reviewEdits(
	edits: readonly ProposedEdit[],
	settle: (kept: readonly boolean[]) => void,
): Promise<boolean> {
	const first = edits[0];
	if (first === undefined || first.oldText === "") return false;
	const path = await bridge.assistantEditPath(first.id).catch(() => null);
	if (path === null) return false;
	const reviewing = codeReviewTab(first.id);
	if (reviewing !== undefined) {
		activateTab([...tabs.entries()].find(([, each]) => each === reviewing)?.[0] ?? "");
		return true;
	}
	await bridge.openPath(path);
	const tab = await tabOfPath(path);
	if (tab === undefined || !tab.session.isText || tab.session.textView === null) return false;
	const before = tab.session.textView.value();
	const placed = placeProposals(before, edits);
	if (placed === null) return false;
	const count = tab.codeReview.start(before, placed.text, ({ text, steps, decisions }) => {
		codeReviews.delete(first.id);
		const changed = text !== before.replace(/\r\n?/g, "\n");
		if (changed && tab.session.replaceText(text)) void tab.session.save();
		// Each proposal as decided: one whose every line was rejected was not applied.
		const kept = keptProposals(placed.text, placed.ranges, steps, decisions);
		settle(changed ? kept : kept.map(() => false));
	});
	if (count === 0) return false;
	codeReviews.set(first.id, tab);
	return true;
}

/** Set once the first tab is shown: before it, `session` is not there to read. */
let firstTabShown = false;

/** The assistant at work on an answer: a click shows its panel. */
const assistantChip = statusChip("status-assistant", t.statusAssistantBusy, "assistant", () => {
	if (!settings.assistant) updateSettings({ assistant: true });
	assistant.focus();
});

const assistant = createAssistantPane({
	activity: (busy) => {
		assistantChip.hidden = !busy;
		showAssistantBusy(busy);
		bridge.assistantActivity(busy);
	},
	// Built before the first tab (and before `session` exists): nothing to suggest about till then.
	documentText: () => {
		if (!firstTabShown || session.isText) return "";
		return session.styledMarkdown();
	},
	reviewEdits: (edits, settle) => reviewEdits(edits, settle),
	decideReview: (id, accept) => {
		// Not when its tab was closed meanwhile: the list applies it to the file as it does any other.
		const tab = codeReviewTab(id);
		if (tab === undefined) return false;
		if (accept) tab.codeReview.acceptAll();
		else tab.codeReview.rejectAll();
		return true;
	},
	reviewCounts: (id) => codeReviewTab(id)?.codeReview.remaining() ?? null,
	t,
	lang: startup.language,
	bridge,
	previews,
	autoDocument: () => settings.assistantDocumentAuto,
	documentId: () => (session as Session | undefined)?.id ?? "",
	documentOf: (id) => {
		const tab = tabs.get(id);
		if (tab === undefined) return null;
		const doc = tab.session;
		return {
			name: doc.path?.split(/[\\/]/).pop() ?? doc.name,
			text: () => doc.styledMarkdown(),
		};
	},
	// Empty until the first tab is open.
	documentName: () =>
		(session as Session | undefined) === undefined
			? ""
			: (session.path?.split(/[\\/]/).pop() ?? session.name),
	width: () => settings.assistantWidth,
	setWidth: (width) => updateSettings({ assistantWidth: width }),
	place: () => settings.assistantPlace,
	height: () => settings.assistantHeight,
	setHeight: (height) => updateSettings({ assistantHeight: height }),
	context: () => assistantContext(),
	images: () =>
		documentImages([...canvas.querySelectorAll("img")].filter((image) => !isDiagramImage(image))),
	selection: () => lastSelection,
	workspaceFolders: () => {
		const workspace = filesPane.workspace();
		return workspace?.opened === true ? workspace.roots.map((root) => root.path) : [];
	},
	insert: (text) => insertReply(text),
	applyActions: (actions, review) => applyAssistantActions(actions, review === true),
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
	changeSettings: (patch) => updateSettings(patch),
	accountsChanged: () => void refreshAccounts(),
	markQuotes: (quotes) => markQuotes(canvas, quotes),
	revealQuote: (quote) => revealQuote(canvas, quote),
	errorText: ipcErrorMessage,
	modes: () => settings.assistantModes,
	customModes: () => settings.assistantCustomModes,
	openModeSettings: () => openSettings("modes"),
	approvalMode: () => settings.assistantApprovals,
	setApprovalMode: (mode) => updateSettings({ assistantApprovals: mode }),
});

// On the edge of the side the assistant is on, after that side's panes' buttons, as one of them.
const assistantToggle = el("button", {
	class: "stripe-button assistant-rail-button",
	attrs: {
		type: "button",
		title: `${t.assistantPane} (${startup.platform === "darwin" ? "Cmd" : "Ctrl"}+Shift+L)`,
		"aria-label": t.assistantPane,
		"aria-controls": "assistant-pane",
	},
	children: [
		icon("assistant"),
		el("span", { class: "stripe-label assistant-rail-label", text: t.assistantTitle }),
	],
});
assistantToggle.addEventListener("click", () => {
	if (settings.assistant) {
		updateSettings({ assistant: false });
		// Back to where the caret was; a plain focus would jump to the document's top.
		returnToDocument();
	} else {
		updateSettings({ assistant: true });
		assistant.focus();
	}
});
const assistantRail = el("div", { class: "assistant-rail" });
const assistantShortcut = `${startup.platform === "darwin" ? "Cmd" : "Ctrl"}+Shift+L`;
attachTip(
	assistantToggle,
	() => `${assistantToggle.getAttribute("aria-label") ?? t.assistantPane} (${assistantShortcut})`,
	"left",
);
const assistantBadge = el("span", {
	class: "stripe-badge",
	attrs: { "aria-hidden": "true", hidden: "" },
});
assistantToggle.append(assistantBadge);
showAssistantBusy = (busy) => assistantToggle.toggleAttribute("data-busy", busy);
/** The assistant's changes waiting in the document, on its button. */
function showAssistantEdits(count: number): void {
	assistantBadge.hidden = count <= 0;
	// Nothing in the button's text without a count: its name is its label.
	assistantBadge.textContent = count <= 0 ? "" : count > 99 ? "99+" : String(count);
	assistantToggle.setAttribute(
		"aria-label",
		count > 0 ? `${t.assistantPane} (${count})` : t.assistantPane,
	);
}

// --- Docks: the tool panes on the left, on the right and under the document ---------

/** Which services are set up: their panes show only then. */
const accounts = { confluence: false, jira: false };
let extensionPanes: ExtensionPanes | null = null;
const paneAvailable = (pane: ToolPane): boolean =>
	isExtensionPane(pane)
		? (extensionPanes?.has(pane) ?? false)
		: pane === "confluence"
			? accounts.confluence
			: pane === "jira"
				? accounts.jira
				: true;
const extensionPaneLabels = {
	get: (pane: ToolPane): string | undefined =>
		isExtensionPane(pane) ? extensionPanes?.label(pane) : undefined,
};
const PANE_LABELS: Readonly<Record<BuiltinPane, string>> = {
	outline: t.outlineTab,
	files: t.filesTab,
	confluence: t.confluenceTab,
	jira: t.jiraTab,
	notes: t.notesTitle,
};
const jiraPane = createJiraPane({
	t,
	bridge,
	openIssue: (key) => void jiraDialog.showIssue(key),
	logWork: (key) => void jiraDialog.logWork(key),
	favorites: () => settings.jiraFavorites,
	setFavorites: (favorites) => updateSettings({ jiraFavorites: favorites }),
});
const docks = createDocks({
	t,
	panes: [
		{ id: "outline", label: t.outlineTab, icon: "navigation", element: outlineArea },
		{ id: "files", label: t.filesTab, icon: "open", element: filesPane.element },
		{
			id: "confluence",
			label: t.confluenceTab,
			icon: "confluence",
			element: confluencePane.element,
		},
		{ id: "jira", label: t.jiraTab, icon: "target", element: jiraPane.element },
		{ id: "notes", label: t.notesTitle, icon: "note", element: localNotes.element },
	],
	settings: () => settings,
	update: (patch) => updateSettings(patch),
	available: paneAvailable,
	openLayout: () => openSettings("panels"),
	reveal: (pane) => {
		if (pane !== "outline" || app.dataset.fold === undefined) return false;
		outlineWanted = session;
		foldEmptyOutline();
		fitSidePanes();
		return true;
	},
	badge: (pane) => (pane === "notes" ? localNotes.count() : null),
	// The assistant takes a side as a pane does: its button there, and one panel open on that side.
	side: {
		button: assistantToggle,
		place: () => settings.assistantPlace,
		move: (place) => updateSettings({ assistantPlace: place }),
	},
});
refreshBadges = () => docks.refreshBadges();
extensionPanes = createExtensionPanes({
	bridge,
	language: startup.language,
	panePlaces: () => settings.panePlaces,
	place: (places) => updateSettings({ panePlaces: { ...settings.panePlaces, ...places } }),
	changed: (panes) => docks.setExtensionPanes(panes),
	editorsGone: (ids) => {
		for (const id of ids) closeExtensionEditor(id);
	},
});
void extensionPanes.refresh();
bridge.onExtensionShowPane((extension, pane) => {
	const id = extensionPaneId(extension, pane);
	if (!isPaneShown(settings, id, paneAvailable)) updateSettings(revealPane(settings, id));
});
const deskColumn = el("div", { class: "desk-column", children: [deskArea, docks.elements.bottom] });

/**
 * An extension's editor (a diff, a commit) is a tab beside the documents, as
 * Settings is: its page takes the documents' place while it is chosen.
 */
const editorHost = el("div", { class: "ext-editor-host", attrs: { hidden: "" } });
deskArea.append(editorHost);
const editorTabs = new Map<string, HTMLElement>();
let editorShown: string | null = null;

function showExtensionEditor(id: string): void {
	const element = editorTabs.get(id);
	if (element === undefined) return;
	leaveSettingsTab();
	for (const [other, each] of editorTabs) each.hidden = other !== id;
	editorShown = id;
	deskArea.toggleAttribute("data-ext-editor", true);
	editorHost.hidden = false;
	tabStrip.select(id);
}

function leaveExtensionEditor(): void {
	if (editorShown === null) return;
	editorShown = null;
	deskArea.removeAttribute("data-ext-editor");
	editorHost.hidden = true;
	tabStrip.select(session.id);
}

function closeExtensionEditor(id: string): void {
	if (!editorTabs.has(id)) return;
	const wasShown = editorShown === id;
	const order = [...editorTabs.keys()];
	editorTabs.delete(id);
	extensionPanes?.closeEditor(id);
	tabStrip.removePage(id);
	if (!wasShown) return;
	const next = order[order.indexOf(id) + 1] ?? order[order.indexOf(id) - 1];
	if (next !== undefined && editorTabs.has(next)) showExtensionEditor(next);
	else {
		leaveExtensionEditor();
		session.focus();
	}
}

bridge.onExtensionOpenEditor((tab) => {
	const opened = extensionPanes?.openEditor(tab) ?? null;
	if (opened === null) return;
	if (opened.created) {
		editorTabs.set(opened.id, opened.element);
		editorHost.append(opened.element);
	}
	tabStrip.addPage({
		id: opened.id,
		title: tab.title,
		tooltip: tab.tooltip,
		icon: "extension",
		onSelect: () => showExtensionEditor(opened.id),
		onClose: () => closeExtensionEditor(opened.id),
	});
	showExtensionEditor(opened.id);
});
bridge.onExtensionCloseEditor((extension, key) => {
	if (extensionPanes !== null) closeExtensionEditor(extensionPanes.editorId(extension, key));
});

/** The assistant's panel where the settings put it; its button stays at the right edge. */
function placeAssistant(): void {
	const place = settings.assistantPlace;
	if (assistant.element.dataset.place === place && assistant.element.isConnected) return;
	if (place === "bottom") deskColumn.append(assistant.element);
	else if (place === "left") docks.elements.left.after(assistant.element);
	else assistantRail.before(assistant.element);
	assistant.element.dataset.place = place;
}
assistantRail.prepend(docks.stripes.right);

/**
 * Settings is a tab beside the documents: its page takes the documents'
 * place while it is chosen, and the panes stay where they are. A document's
 * tab brings that document back; Settings' own tab, or the menu, Settings.
 */
const settingsHost = el("div", { class: "settings-host", attrs: { hidden: "" } });
deskArea.append(settingsHost);
/** Whether Settings' tab is open, and whether it is the one shown. */
let settingsOpen = false;
let settingsShown = false;

function showSettingsTab(): void {
	leaveExtensionEditor();
	if (!settingsOpen) {
		settingsOpen = true;
		tabStrip.page({
			id: "settings",
			title: t.settingsTitle,
			icon: "settings",
			onSelect: showSettingsTab,
			onClose: () => settingsDialog.close(),
		});
	}
	settingsShown = true;
	deskArea.toggleAttribute("data-settings", true);
	settingsHost.hidden = false;
	tabStrip.select("settings");
}

/** The active document comes back in Settings' place; its tab stays open. */
function leaveSettingsTab(): void {
	if (!settingsShown) return;
	settingsShown = false;
	deskArea.removeAttribute("data-settings");
	settingsHost.hidden = true;
	tabStrip.select(session.id);
}

function openSettings(page?: SettingPage): void {
	showSettingsTab();
	void settingsDialog.show(page);
}

const settingsDialog = createSettingsDialog({
	host: settingsHost,
	closed: () => {
		if (!settingsOpen) return;
		leaveSettingsTab();
		settingsOpen = false;
		tabStrip.page(null);
		session.focus();
	},
	t,
	bridge,
	settings: () => settings,
	update: (patch) => updateSettings(patch),
	paneLabel: (pane) =>
		isExtensionPane(pane) ? (extensionPaneLabels.get(pane) ?? pane) : PANE_LABELS[pane],
	connectConfluence: () => void confluenceDialog.show(),
	connectJira: () => void jiraDialog.showLogin(),
	onAccountChange: () => void refreshAccounts(),
	assistantConfigured: (status, changed) => assistant.configured(status, changed),
	openLink: (href) => bridge.openLink(href),
	errorText: ipcErrorMessage,
	activeDocument: async () => {
		const context = await assistantContext();
		return { name: context.name, text: context.text };
	},
	version: startup.version,
	unlockDebug: () => {
		if (!debugMode) {
			void bridge.setDebugMode(true);
			session.notices.show({ id: "debug", text: t.debugModeOn });
		}
		networkPanel.show();
	},
});

/**
 * The hidden debug mode: seven clicks on the version in Settings turn it
 * on; then F12 (View › Network Log) opens the app's requests.
 */
let debugMode = startup.debugMode;
const networkPanel = createNetworkPanel({
	t,
	bridge,
	lang: startup.language,
	errorText: ipcErrorMessage,
	notify: (text) => session.notices.show({ id: "debug", kind: "error", text }),
	turnOff: () => {
		void bridge.setDebugMode(false);
		session.notices.show({ id: "debug", text: t.debugModeOffDone });
	},
});
bridge.onDebugMode((on) => {
	debugMode = on;
	if (!on) networkPanel.hide();
});
const templatePicker = createTemplatePicker({
	t,
	bridge,
	defaultTemplate: () => settings.defaultTemplate,
	errorText: ipcErrorMessage,
});

/** The panes that came into view are filled: Confluence's tree, Jira's issues, the files. */
function refreshShown(before: ReadonlySet<ToolPane>): void {
	const now = docks.shown();
	if (now.has("confluence") && !before.has("confluence")) void confluencePane.refresh();
	if (now.has("jira") && !before.has("jira")) void jiraPane.refresh();
	if (now.has("notes") && !before.has("notes")) localNotes.refresh();
}

/** Asks which services are connected; a pane appears or goes with its connection. */
async function refreshAccounts(): Promise<void> {
	const before = docks.shown();
	const [confluence, jira] = await Promise.all([
		bridge.confluenceAccount().catch(() => null),
		bridge.jiraAccount().catch(() => null),
	]);
	accounts.confluence = confluence !== null;
	accounts.jira = jira !== null;
	confluenceChip.hidden = !accounts.confluence;
	jiraChip.hidden = !accounts.jira;
	for (const tab of tabs.values()) tab.session.connectionsChanged();
	updatePublishButton();
	docks.apply();
	refreshShown(before);
	void settingsDialog.refresh();
}

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
// --- Status bar: what changes as one works, each a way to it -----------------

/** Saved, unsaved, saving, failed: at the status bar's right, as a click saves. */
const saveStatus = el("div", { class: "save-status", attrs: { role: "status" } });
// Unsaved or failed: a click saves, as Ctrl+S does.
saveStatus.addEventListener("click", () => {
	if (session.status === "unsaved" || session.status === "error") commands.save();
});

/** A chip of the status bar that does something when clicked. */
function statusChip(
	className: string,
	label: string,
	glyph: IconName,
	run: () => void,
): HTMLButtonElement {
	const chip = el("button", {
		class: `status-chip ${className}`,
		attrs: { type: "button", title: label },
		children: [icon(glyph), el("span", { class: "status-chip-text", text: label })],
	});
	chip.addEventListener("click", run);
	chip.hidden = true;
	return chip;
}

/** Confluence and Jira while connected: a click shows their pane. */
const confluenceChip = statusChip("status-confluence", "Confluence", "confluence", () => {
	if (!docks.shown().has("confluence")) updateSettings(revealPane(settings, "confluence"));
});
const jiraChip = statusChip("status-jira", "Jira", "target", () => {
	if (!docks.shown().has("jira")) updateSettings(revealPane(settings, "jira"));
});

/** The selection's words, while there is one. */
const selectionCount = el("span", { class: "status-selection" });
selectionCount.hidden = true;
function showSelectionCount(text: string): void {
	const words = text.trim() === "" ? 0 : countWords(text, startup.language);
	selectionCount.hidden = words === 0;
	selectionCount.textContent = format(t.statusSelection, words);
}

/**
 * A goal in words for the document, kept on this computer by its path (or
 * its Confluence page); its progress is a ring. A click sets or removes it.
 */
const GOALS_KEY = "kalem.wordGoals";
function readGoals(): Record<string, number> {
	try {
		const kept = JSON.parse(localStorage.getItem(GOALS_KEY) ?? "{}") as unknown;
		return typeof kept === "object" && kept !== null ? (kept as Record<string, number>) : {};
	} catch {
		return {};
	}
}
/** Goals of documents not saved yet, for as long as the window is open. */
const unsavedGoals = new WeakMap<Session, number>();
function goalKey(tab: Session): string | null {
	if (tab.path !== null) return `path:${tab.path}`;
	if (tab.remote !== null) return `confluence:${tab.remote.site}#${tab.remote.id}`;
	return null;
}
function goalOf(tab: Session): number | null {
	const key = goalKey(tab);
	const goal = key === null ? unsavedGoals.get(tab) : readGoals()[key];
	return typeof goal === "number" && goal > 0 ? goal : null;
}
function setGoal(tab: Session, goal: number | null): void {
	const key = goalKey(tab);
	if (key === null) {
		if (goal === null) unsavedGoals.delete(tab);
		else unsavedGoals.set(tab, goal);
	} else {
		const goals = readGoals();
		if (goal === null) delete goals[key];
		else goals[key] = goal;
		try {
			localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
		} catch {
			// Storage may be unavailable: the goal lasts as long as the window.
			unsavedGoals.set(tab, goal ?? 0);
		}
	}
	showGoal();
}

const goalRing = el("span", { class: "status-goal-ring", attrs: { "aria-hidden": "true" } });
const goalText = el("span", { class: "status-goal-text" });
const goalButton = el("button", {
	class: "status-chip status-goal",
	attrs: { type: "button", "aria-haspopup": "dialog" },
	children: [goalRing, goalText],
});
const goalInput = el("input", {
	class: "status-goal-input",
	attrs: { type: "number", min: "1", step: "50", "aria-label": t.goalLabel },
});
const goalSave = el("button", {
	class: "status-goal-save",
	text: t.goalSave,
	attrs: { type: "button" },
});
const goalRemove = el("button", {
	class: "status-goal-remove",
	text: t.goalRemove,
	attrs: { type: "button" },
});
// Not a <form>: the page's policy (form-action 'none') stops a form's submission.
const goalForm = el("div", {
	class: "status-popover status-goal-form",
	attrs: { role: "dialog", "aria-label": t.goalLabel, hidden: "" },
	children: [
		el("label", { text: t.goalLabel, attrs: { for: "status-goal-input" } }),
		goalInput,
		goalSave,
		goalRemove,
	],
});
goalInput.id = "status-goal-input";
document.body.append(goalForm);

function showGoal(): void {
	const tab = session as Session | undefined;
	if (tab === undefined) return;
	goalButton.hidden = tab.isText;
	const goal = goalOf(tab);
	const words = tab.wordCounts()?.words ?? 0;
	goalButton.toggleAttribute("data-goal", goal !== null);
	if (goal === null) {
		goalRing.style.removeProperty("--goal");
		goalText.textContent = t.goalSet;
		goalButton.title = t.goalSet;
		return;
	}
	const share = Math.min(1, words / goal);
	goalRing.style.setProperty("--goal", `${Math.round(share * 100)}%`);
	goalButton.toggleAttribute("data-reached", words >= goal);
	goalText.textContent = `${words.toLocaleString(startup.language)} / ${goal.toLocaleString(startup.language)}`;
	goalButton.title = format(t.goalTitle, words, goal, Math.round(share * 100));
}
let goalTimer: ReturnType<typeof setTimeout> | undefined;
/** The counter counts a moment after a change: the ring follows it. */
function showGoalSoon(): void {
	clearTimeout(goalTimer);
	goalTimer = setTimeout(showGoal, 400);
}

goalButton.addEventListener("click", () => {
	if (!goalForm.hidden) {
		goalForm.hidden = true;
		return;
	}
	goalInput.value = String(goalOf(session) ?? "");
	goalRemove.hidden = goalOf(session) === null;
	goalForm.hidden = false;
	const box = goalButton.getBoundingClientRect();
	goalForm.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - goalForm.offsetWidth - 8))}px`;
	goalForm.style.top = `${box.top - goalForm.offsetHeight - 6}px`;
	goalInput.focus();
	goalInput.select();
});
function saveGoal(): void {
	const goal = Math.round(Number(goalInput.value));
	setGoal(session, Number.isFinite(goal) && goal > 0 ? goal : null);
	goalForm.hidden = true;
}
goalSave.addEventListener("click", saveGoal);
goalInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		saveGoal();
	}
});
goalRemove.addEventListener("click", () => {
	setGoal(session, null);
	goalForm.hidden = true;
});
goalForm.addEventListener("keydown", (event) => {
	if (event.key === "Escape") goalForm.hidden = true;
});
document.addEventListener(
	"mousedown",
	(event) => {
		const target = event.target as Node;
		if (!goalForm.hidden && !goalForm.contains(target) && !goalButton.contains(target))
			goalForm.hidden = true;
	},
	true,
);

/** The zoom's value opens the usual sizes. */
// On the zoom's steps (ZOOM_STEP): another would be rounded to one.
const ZOOM_PRESETS = [80, 90, 100, 110, 120, 150, 200] as const;
const zoomMenu = el("div", {
	class: "status-popover zoom-menu",
	attrs: { role: "menu", hidden: "" },
});
document.body.append(zoomMenu);
zoomValue.setAttribute("role", "button");
zoomValue.setAttribute("tabindex", "0");
zoomValue.setAttribute("aria-haspopup", "menu");
zoomValue.title = t.zoom;
function openZoomMenu(): void {
	zoomMenu.replaceChildren(
		...ZOOM_PRESETS.filter((zoom) => zoom >= MIN_ZOOM && zoom <= MAX_ZOOM).map((zoom) => {
			const item = el("button", {
				class: "zoom-menu-item",
				text: `${zoom}%`,
				attrs: {
					type: "button",
					role: "menuitemradio",
					"aria-checked": String(zoom === settings.zoom),
				},
			});
			item.addEventListener("click", () => {
				zoomMenu.hidden = true;
				setZoom(zoom);
			});
			return item;
		}),
	);
	zoomMenu.hidden = false;
	const box = zoomValue.getBoundingClientRect();
	zoomMenu.style.left = `${Math.min(box.left, window.innerWidth - zoomMenu.offsetWidth - 8)}px`;
	zoomMenu.style.top = `${box.top - zoomMenu.offsetHeight - 6}px`;
	zoomMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
}
zoomValue.addEventListener("click", () => {
	if (zoomMenu.hidden) openZoomMenu();
	else zoomMenu.hidden = true;
});
zoomValue.addEventListener("keydown", (event) => {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		openZoomMenu();
	}
});
document.addEventListener(
	"mousedown",
	(event) => {
		const target = event.target as Node;
		if (!zoomMenu.hidden && !zoomMenu.contains(target) && target !== zoomValue)
			zoomMenu.hidden = true;
	},
	true,
);
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") zoomMenu.hidden = true;
});

const extensionStatus = el("span", { class: "ext-status-items" });
function showExtensionStatus(items: readonly ExtensionStatusItem[]): void {
	extensionStatus.replaceChildren(
		...items.map((item) => {
			const button = el("button", {
				class: "status-chip ext-status-item",
				text: item.text,
				attrs: {
					type: "button",
					title: item.tooltip || item.text,
					"data-extension": item.extension,
					"data-key": item.key,
				},
			});
			if (item.command === null) button.disabled = true;
			else {
				const command = item.command;
				button.addEventListener("click", () => bridge.extensionRunCommand(item.extension, command));
			}
			return button;
		}),
	);
}
bridge.onExtensionStatusItems(showExtensionStatus);
void bridge.extensionStatusItems().then(showExtensionStatus);
const statusBar = el("footer", {
	class: "statusbar",
	children: [
		docks.stripes.bottom,
		confluenceChip,
		jiraChip,
		extensionStatus,
		wordCountArea,
		selectionCount,
		goalButton,
		el("span", { class: "status-spacer" }),
		assistantChip,
		saveStatus,
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
// Publishing to Confluence, always at hand next to the save status while Confluence is connected.
const publishButton = el("button", {
	class: "ribbon-publish",
	attrs: { type: "button", title: t.publishTitleBar },
	children: [icon("confluence"), el("span", { text: t.publishButton })],
});
publishButton.firstElementChild?.classList.add("ribbon-publish-mark");
publishButton.hidden = true;
publishButton.addEventListener("click", () => commands["publish-confluence"]());
// A Confluence page's changes since it was opened or saved, as a diff: there while the page has some.
const changesButton = el("button", {
	class: "ribbon-changes",
	attrs: { type: "button", title: t.changesCommand },
	children: [icon("diff"), el("span", { text: t.changesButton })],
});
changesButton.firstElementChild?.classList.add("ribbon-publish-mark");
changesButton.hidden = true;
changesButton.addEventListener("click", () => commands["confluence-changes"]());
const ribbonTrailing = el("div", {
	class: "ribbon-trailing",
	children: [publishButton, changesButton],
});

/** The publish button is there for a local document, once Confluence is connected. */
function updatePublishButton(): void {
	publishButton.hidden = !accounts.confluence || session.remote !== null || session.isText;
	changesButton.hidden = session.remote === null || !session.dirty;
}

/** Shows what changed in the active Confluence page; `false` for a tab that is not one. */
/** Merges a tab's edits with the newer version someone saved on Confluence meanwhile. */
async function showConfluenceMerge(tab: Session): Promise<void> {
	const remote = tab.remote;
	if (remote === null) return;
	let plan: ConfluenceMergePlan | null;
	try {
		plan = await tab.confluenceMergePlan();
	} catch (error) {
		tab.notices.show({
			id: "save",
			kind: "error",
			text: format(t.confluenceRequestFailed, ipcErrorMessage(error)),
		});
		return;
	}
	if (plan === null) {
		tab.notices.show({ id: "save", kind: "warning", text: t.mergeTooBig });
		return;
	}
	const merging = plan;
	mergeDialog.show({
		title: remote.title,
		merge: merging.merge,
		apply: async (text, save) => {
			const applied = await tab.applyConfluenceMerge(merging, text);
			if (applied === "edited") return t.mergeEdited;
			if (applied === "stale") return t.mergeStale;
			if (applied === "read-only") return t.mergeReadOnly;
			// The merge was seen and decided here: saving asks nothing more. The
			// text is in the document either way; a failed save says why in its notice.
			if (save) await tab.saveReviewed();
			// The notice that opened the dialog is gone: writing goes on in the document.
			setTimeout(() => {
				if (session === tab) tab.focus();
			});
			return null;
		},
	});
}

function showConfluenceChanges(): boolean {
	const tab = session;
	const remote = tab.remote;
	const base = tab.remoteBaseline();
	if (remote === null || base === null) return false;
	changesDialog.show({
		title: remote.title,
		base: () => tab.remoteBaseline() ?? base,
		current: () => tab.styledMarkdown(),
		editable: () => !tab.readOnly && tab.source?.isSource() !== true,
		replace: (text) => tab.replaceText(text),
		save: () => tab.saveReviewed(),
	});
	return true;
}

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

/**
 * The window's title bar, when Kalem draws it (`tabsInTitleBar`): the
 * documents' tabs, in the row the system's title bar took, which drags the
 * window; the system's window buttons are over its right end (Windows,
 * Linux) or its traffic lights at its left (macOS).
 */
const titleBar =
	startup.titleBar === null
		? null
		: el("div", {
				class: "title-bar",
				attrs: { "data-kind": startup.titleBar },
				children: [tabStrip.element],
			});

/** The system's window buttons take the title bar's colours, the theme's and the palette's. */
let titleBarColors = "";
function syncTitleBar(): void {
	if (titleBar === null || startup.titleBar !== "overlay") return;
	const style = getComputedStyle(titleBar);
	const colors = `${style.backgroundColor}|${style.color}`;
	if (colors === titleBarColors) return;
	titleBarColors = colors;
	bridge.titleBarColors(style.backgroundColor, style.color);
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTitleBar);

const app = document.getElementById("app") ?? document.body.appendChild(el("div"));
app.className = "app";
app.toggleAttribute("data-title-bar", titleBar !== null);
// The system's material behind the frame (`windowMaterial`): the shell lets it through.
if (startup.material !== null) document.documentElement.dataset.material = startup.material;
app.append(
	...(titleBar === null ? [ribbonHost, tabStrip.element] : [titleBar, ribbonHost]),
	noticeArea,
	el("div", {
		class: "body",
		children: [
			docks.stripes.left,
			docks.elements.left,
			deskColumn,
			docks.elements.right,
			assistant.element,
			assistantRail,
		],
	}),
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
	/** Shows or hides the start page, as the document is empty or not. */
	showStart(): void;
	/** Where the user's own notes on it are drawn. */
	readonly notes: NotesTarget;
	/** The page's scroll, kept as it changes: a hidden tab's page reads 0. */
	scroll: number;
	/** A scroll to go back to once the tab is shown (a restored tab's). */
	pendingScroll: number | null;
	readonly desk: HTMLElement;
	/** The line numbers in the page's margin. */
	readonly lineNumbers: LineNumbers;
	/** The assistant's changes to it, waiting to be accepted or rejected. */
	readonly review: EditReviewUi;
	/** A code file's: the assistant's proposed change, a line at a time. */
	readonly codeReview: CodeReviewUi;
}

/** The ways to start a document, offered under an empty page; Jira only once it is connected. */
function startActions(): StartAction[] {
	return [
		{
			id: "template",
			icon: "new",
			label: t.startTemplate,
			hint: t.startTemplateHint,
			run: () => commands["new-from-template"](),
		},
		{
			id: "open",
			icon: "open",
			label: t.startOpen,
			hint: t.startOpenHint,
			run: () => void bridge.showOpenDialog(),
		},
		{
			id: "folder",
			icon: "folderOpen",
			label: t.startFolder,
			hint: t.startFolderHint,
			run: () => void bridge.openFolder(),
		},
		{
			id: "word",
			icon: "word",
			label: t.startWord,
			hint: t.startWordHint,
			run: () => void bridge.importWord(),
		},
		{
			id: "confluence",
			icon: "confluence",
			label: t.startConfluence,
			hint: t.startConfluenceHint,
			run: () => commands["confluence-open"](),
		},
		...(accounts.jira
			? [
					{
						id: "jira",
						icon: "target",
						label: t.startJira,
						hint: t.startJiraHint,
						run: () => commands["jira-open"](),
					} satisfies StartAction,
				]
			: []),
	];
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
		updatePublishButton();
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
	saveStatus.title =
		session.status === "unsaved" || session.status === "error"
			? `${t.statusClickToSave}${session.path === null ? "" : `\n${session.path}`}`
			: (session.path ?? "");
	formatBadge.textContent = session.formatLabel;
	readOnlyBadge.hidden = !session.readOnly;
	updatePublishButton();
}

function createTab(id: string): Tab {
	const noticeHost = el("div", { class: "notices" });
	const tabCanvas = el("div", { class: "kalem-theme" });
	// `kalem-theme` on the page too: the source-mode textarea is a sibling of
	// the editor and would otherwise not inherit the theme tokens.
	const start = createStartPage({
		t,
		actions: startActions,
		recent: () => bridge.recentFiles(),
		pinned: () => settings.pinnedFiles,
		setPinned: (paths) => updateSettings({ pinnedFiles: paths }),
		open: (path) => void bridge.openPath(path),
		confluence: () => (accounts.confluence ? bridge.confluenceSearch("", null) : null),
		openConfluence: (pageId) => void bridge.confluenceOpenPage(pageId),
		templates: () => bridge.templates(),
		newFromTemplate: (id) => void bridge.templateNew(id),
		jira: () =>
			accounts.jira
				? bridge
						.jiraSearch(
							"assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
							null,
						)
						.then((found) => found.issues)
				: null,
		openIssue: (key) => void jiraDialog.showIssue(key),
	});
	/** Once the document had something in it, the start page does not come back. */
	let started = false;
	/** The state changes before the document is loaded have nothing to show yet. */
	let loaded = false;
	/** Whether it had unsaved changes at the last state change: a save is the change from that. */
	let wasDirty = false;
	/** Whether the specs made from it were looked for since it was loaded. */
	let specsChecked = false;
	const page = el("div", { class: "page kalem-theme", children: [tabCanvas, start.element] });
	const desk = el("main", { class: "desk", children: [page] });
	desk.addEventListener(
		"scroll",
		() => {
			if (tabs.get(session.id)?.desk !== desk) return;
			documentMap.scrolled();
			pathBar.scrolled(desk.scrollTop);
		},
		{ passive: true },
	);
	// My Notes' cards beside their lines follow the active page's scroll.
	desk.addEventListener(
		"scroll",
		() => {
			if (tabs.get(session.id)?.desk === desk) localNotes.align();
		},
		{ passive: true },
	);
	const outline = el("div", { class: "kalem-theme" });
	const wordCount = el("div", { class: "kalem-theme" });
	const views = [noticeHost, desk, outline, wordCount];
	for (const view of views) view.hidden = true;

	noticeArea.append(noticeHost);
	deskArea.append(desk);
	outlineArea.append(outline);
	wordCountArea.append(wordCount);

	const review = createEditReview({
		t,
		page,
		desk,
		canvas: tabCanvas,
		text: () => tabSession.styledMarkdown(),
		replace: (text) => tabSession.replaceText(text),
		blockIds: () => tabSession.lineSnapshot()?.blocks.map((block) => block.id) ?? [],
		updated: () => {
			if (session === tabSession) syncEdits();
		},
	});
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
		connections: () => accounts,
		onStateChange: () => {
			review.changed();
			const saved = wasDirty && !tabSession.dirty && tabSession.path !== null;
			wasDirty = tabSession.dirty;
			if (saved) void checkSpecs(tabSession, false);
			tabStrip.update(id, {
				title: tabSession.name,
				dirty: tabSession.dirty,
				path: tabSession.path,
			});
			if (session === tabSession) {
				renderState();
				// Saved for the first time, or under another name: its notes go with it.
				localNotes.refresh();
				if (firstTabShown) refreshPathBar();
			}
			if (loaded) showStart();
		},
		onConfluenceMerge: () => void showConfluenceMerge(tabSession),
		decorateBubble: (bubble) => selectionAssistant.decorate(bubble),
		onEditorChange: () => {
			review.changed();
			scheduleRibbonUpdate();
			if (session === tabSession) {
				localNotes.refresh();
				foldEmptyOutlineSoon();
				showGoalSoon();
				documentMap.refresh();
				suggestSoon();
			}
			lineNumbers.refresh();
		},
	});
	const lineNumbers = createLineNumbers({
		page,
		canvas: tabCanvas,
		// The file's lines while its source is shown; on the page, not in focus mode.
		enabled: () =>
			tabSession.source?.isSource() === true
				? settings.codeLineNumbers
				: settings.lineNumbers && !app.hasAttribute("data-focus"),
		available: () => !tabSession.isText,
		snapshot: () => tabSession.lineSnapshot(),
	});

	/** Called once the tab's document is loaded, and on each change of its state after. */
	function showStart(): void {
		if (!started && (tabSession.dirty || tabSession.status !== "new")) started = true;
		start.show(
			!started &&
				!tabSession.isText &&
				!tabSession.readOnly &&
				tabSession.styledMarkdown().trim() === "",
		);
	}

	enableColumnResize(tabCanvas, {
		enabled: () => session === tabSession && canEdit(),
		zoom: () => settings.zoom / 100,
		resize: (tableId, column, width, done) => {
			const style = withColumnWidth(tabSession.tableStyle(tableId), column, width);
			tabSession.setTableStyle(tableId, style, done);
		},
	});

	const tab: Tab = {
		session: tabSession,
		canvas: tabCanvas,
		views,
		showStart: () => {
			loaded = true;
			showStart();
			if (!specsChecked && tabSession.path !== null) {
				specsChecked = true;
				void checkSpecs(tabSession, true);
			}
		},
		notes: {
			id,
			canvas: tabCanvas,
			key: () => noteKey(tabSession.path, tabSession.remote),
			available: () => !tabSession.isText && tabSession.source?.isSource() !== true,
		},
		scroll: 0,
		pendingScroll: null,
		desk,
		lineNumbers,
		review,
		codeReview: createCodeReview({
			t,
			container: tabCanvas,
			showText: (shown) => {
				const view = tabSession.textView;
				if (view !== null) view.element.hidden = !shown;
			},
			// The chat's list counts what is left of it.
			changed: () => assistant.editsChanged(),
		}),
	};
	desk.addEventListener(
		"scroll",
		() => {
			if (!desk.hidden) tab.scroll = desk.scrollTop;
		},
		{ passive: true },
	);
	keepReadingPlace(desk, page, tabCanvas);
	tabs.set(id, tab);
	tabStrip.add(id);
	return tab;
}

/**
 * Keeps what is being read in place when the page's layout changes under
 * it: a full-width page, zoom, the notes' margin, a pane or the window
 * resized, focus mode. Lines wrap again and the text above gets taller or
 * shorter; without this the paragraph on screen slides away (often
 * thousands of pixels). The block at the top of the view and its distance
 * from the top are noted as the user reads (scrolls, clicks, types); when
 * the page's width or the view's height changes, that block is brought
 * back to the same distance.
 */
function keepReadingPlace(desk: HTMLElement, page: HTMLElement, canvas: HTMLElement): void {
	let place: { block: Element; offset: number } | null = null;
	let frame = 0;
	const blocks = (): Element[] =>
		[...canvas.querySelectorAll("[data-kalem-id]")].filter(
			(block) => block.parentElement?.closest("[data-kalem-id]") === null,
		);
	const note = (): void => {
		if (desk.hidden) return;
		const box = desk.getBoundingClientRect();
		const all = blocks();
		// The block with the caret, when it is in view: that is what is being read.
		const selection = document.getSelection();
		const caretNode = selection?.anchorNode ?? null;
		const caretBlock =
			caretNode !== null && canvas.contains(caretNode)
				? all.find((block) => block.contains(caretNode))
				: undefined;
		const inView = (block: Element): boolean => {
			const rect = block.getBoundingClientRect();
			return rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom;
		};
		// Otherwise the block a third down the view, where the eye usually is.
		const line = box.top + desk.clientHeight / 3;
		const chosen =
			caretBlock !== undefined && inView(caretBlock)
				? caretBlock
				: all.find((block) => {
						const rect = block.getBoundingClientRect();
						return rect.height > 0 && rect.bottom > line;
					});
		place =
			chosen === undefined
				? null
				: { block: chosen, offset: chosen.getBoundingClientRect().top - box.top };
	};
	const noteSoon = (): void => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(note);
	};
	/** The scroll this makes itself is not the user's: the place it keeps stays as noted. */
	let ownScroll = false;
	let width = 0;
	let height = 0;
	let fontSize = "";
	const restore = (): void => {
		const nowWidth = page.getBoundingClientRect().width;
		const nowHeight = desk.clientHeight;
		// Zoom changes the text's size; the page's width stays when it is capped by the window.
		const nowFont = getComputedStyle(page).fontSize;
		const changed =
			Math.abs(nowWidth - width) > 0.5 ||
			Math.abs(nowHeight - height) > 0.5 ||
			nowFont !== fontSize;
		width = nowWidth;
		height = nowHeight;
		fontSize = nowFont;
		if (!changed || desk.hidden || place === null || !place.block.isConnected) return;
		const top = desk.getBoundingClientRect().top;
		const drift = place.block.getBoundingClientRect().top - top - place.offset;
		if (Math.abs(drift) > 0.5) {
			ownScroll = true;
			desk.scrollTop += drift;
		}
	};
	desk.addEventListener(
		"scroll",
		() => {
			if (ownScroll) {
				ownScroll = false;
				return;
			}
			noteSoon();
		},
		{ passive: true },
	);
	canvas.addEventListener("pointerup", noteSoon);
	canvas.addEventListener("keyup", noteSoon);
	const observer = new ResizeObserver(restore);
	observer.observe(page);
	observer.observe(desk);
}

function activateTab(id: string): void {
	const tab = tabs.get(id);
	if (tab === undefined) return;
	// A document's tab chosen over Settings' brings the documents back.
	leaveSettingsTab();
	leaveExtensionEditor();
	if (tab.session === session) return;

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
	localNotes.attach(tab.notes);
	if (tab.pendingScroll !== null) {
		const scroll = tab.pendingScroll;
		tab.pendingScroll = null;
		// Once the page is laid out.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				tab.desk.scrollTop = scroll;
				tab.scroll = tab.desk.scrollTop;
			}),
		);
	}

	tabStrip.select(id);
	bridge.tabActivated(id);
	firstTabShown = true;
	clearTimeout(foldTimer);
	foldEmptyOutline();
	fitSidePanes();
	showSelectionCount("");
	showGoalSoon();
	documentMap.refresh();
	refreshPathBar();
	pathBar.scrolled(tab.desk.scrollTop);
	assistant.documentChanged();
	syncEdits();
	renderState();
	refreshFiles();
	scheduleRibbonUpdate();
}

/** Loads a document into its tab, creating the tab if it does not exist yet. */
function openDocument({ tabId, payload, view }: TabDocument): void {
	const tab = tabs.get(tabId) ?? createTab(tabId);
	// Load before activating: the ribbon reads editor state as soon as a tab is active.
	tab.session.load(payload);
	if (view !== undefined && view.scroll > 0) tab.pendingScroll = view.scroll;
	tab.showStart();
	activateTab(tabId);
	// Into the active tab too (an empty one a document replaces): the headings
	// pane is as the new document wants it at once, not after typing's pause,
	// so the page does not move a moment after it is shown.
	clearTimeout(foldTimer);
	foldEmptyOutline();
	fitSidePanes();
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
	// A file's change still being reviewed in it waits in the chat's list again.
	for (const [edit, reviewing] of codeReviews) {
		if (reviewing === tab) codeReviews.delete(edit);
	}
	tab.codeReview.cancel();
	tab.session.dispose();
	tab.lineNumbers.destroy();
	for (const view of tab.views) view.remove();
}

function cycleTab(step: 1 | -1): void {
	const order = tabStrip.order();
	const next = order[(order.indexOf(session.id) + step + order.length) % order.length];
	if (next !== undefined) activateTab(next);
}

// --- Settings ---------------------------------------------------------------

const pageSetup = document.head.appendChild(document.createElement("style"));
/** The colour palette's variables, after the stylesheet so that they win. */
const paletteStyle = document.head.appendChild(document.createElement("style"));
/** The system's accent over the palette's (`accentSource`), after it. */
const accentStyle = document.head.appendChild(document.createElement("style"));
let systemAccent = startup.systemAccent;
function applyAccent(): void {
	accentStyle.textContent =
		settings.accentSource === "system"
			? systemAccentCss(systemAccent, settings.palette, settings.paletteCustom)
			: "";
}
bridge.onSystemAccent((accent) => {
	systemAccent = accent;
	applyAccent();
	syncTitleBar();
});

/**
 * The headings pane with no heading to list gives its room to the page: its
 * dock folds while the active document has none (a new one, a text file) and
 * opens again with the first heading. Nothing is saved. Its button opens it
 * for that tab all the same (`reveal` above).
 */
let outlineWanted: Session | null = null;
function foldEmptyOutline(): void {
	const active = session as Session | undefined;
	const place = settings.panePlaces.outline;
	const fold =
		active !== undefined &&
		place !== "hidden" &&
		outlineWanted !== active &&
		isPaneShown(settings, "outline", paneAvailable) &&
		!hasHeadings(active);
	const value = fold ? place : "";
	if ((app.dataset.fold ?? "") !== value) {
		if (value === "") delete app.dataset.fold;
		else app.dataset.fold = value;
	}
}

/** What the headings pane would list: a heading with words in it, a quote's or a list's too. */
function hasHeadings(tab: Session): boolean {
	return (
		!tab.isText && outlineOf(tab.editor.getDocument()).some((heading) => heading.text.trim() !== "")
	);
}

/**
 * While typing, the pane comes and goes once the typing pauses: the page does
 * not move under the first heading as it is being written.
 */
const FOLD_DELAY = 700;
let foldTimer: ReturnType<typeof setTimeout> | undefined;
function foldEmptyOutlineSoon(): void {
	clearTimeout(foldTimer);
	foldTimer = setTimeout(() => {
		foldEmptyOutline();
		fitSidePanes();
	}, FOLD_DELAY);
}

/**
 * A window too narrow for every open side pane and a readable page: the
 * left dock gives way first, then the right one, for as long as the window
 * is that narrow. Nothing is saved; widened, they are back. (The assistant
 * stays: it is what the user is working with.)
 */
const SIDE_PANE_MIN = 150;
const PAGE_MIN = 300;
function fitSidePanes(): void {
	const folded = app.dataset.fold;
	const shown = (element: HTMLElement): boolean =>
		!element.hidden &&
		element.isConnected &&
		!(element === docks.elements.left && folded === "left") &&
		!(element === docks.elements.right && folded === "right");
	const left = docks.elements.left;
	const right = docks.elements.right;
	const stripes = 2 * 34;
	// Its real width: counted as a narrow side pane, the page was left far less
	// than PAGE_MIN beside it in a small window.
	const assistantWidth =
		!assistant.element.hidden && settings.assistantPlace !== "bottom"
			? Math.max(SIDE_PANE_MIN, assistant.element.getBoundingClientRect().width)
			: 0;
	const room = window.innerWidth - stripes - assistantWidth - PAGE_MIN;
	const squeeze: string[] = [];
	const panes = [shown(left) ? "left" : null, shown(right) ? "right" : null].filter(
		(pane): pane is string => pane !== null,
	);
	let needed = panes.length * SIDE_PANE_MIN;
	for (const pane of panes) {
		if (needed <= room) break;
		squeeze.push(pane);
		needed -= SIDE_PANE_MIN;
	}
	const value = squeeze.join(" ");
	if ((app.dataset.squeeze ?? "") !== value) {
		if (value === "") delete app.dataset.squeeze;
		else app.dataset.squeeze = value;
	}
}
window.addEventListener("resize", fitSidePanes);

/** The ribbon's simplified look; set once the ribbon is built, after the first settings. */
let setRibbonSimple: ((simple: boolean) => void) | null = null;

function applySettings(): void {
	setRibbonSimple?.(settings.ribbonSimple);
	pageSetup.textContent = pageRule(settings);
	paletteStyle.textContent = paletteCss(settings.palette, settings.paletteCustom);
	applyAccent();
	// Last in the head, the palette and then the system's accent: a sheet put in after them does not undo them.
	if (document.head.lastElementChild !== accentStyle)
		document.head.append(paletteStyle, accentStyle);
	document.documentElement.dataset.density = settings.density;
	app.style.setProperty("--zoom", String(settings.zoom / 100));
	app.toggleAttribute("data-full-width", settings.fullWidth);
	for (const [name, value] of Object.entries(typographyVars(settings))) {
		if (value === null) app.style.removeProperty(name);
		else app.style.setProperty(name, value);
	}
	app.toggleAttribute("data-doc-font", settings.documentFont !== "default");
	app.toggleAttribute("data-typewriter", settings.typewriterScroll);
	for (const tab of tabs.values()) {
		tab.lineNumbers.relayout();
		tab.session.textView?.setLineNumbers(settings.codeLineNumbers);
	}
	placeAssistant();
	assistant.element.hidden = !settings.assistant;
	assistantToggle.setAttribute("aria-expanded", String(settings.assistant));
	if (settings.assistant) assistant.show();
	assistant.settingsChanged();
	docks.apply();
	zoomSlider.value = String(settings.zoom);
	zoomValue.textContent = `${settings.zoom}%`;
	localNotes.refresh();
	foldEmptyOutline();
	fitSidePanes();
	syncTitleBar();
	documentMap.refresh();
}

function updateSettings(change: Partial<Settings>): void {
	const before = docks.shown();
	// One panel on each side: the assistant's opening closes the dock there, and the other way round.
	const patch = oneOnEachSide(settings, change);
	settings = { ...settings, ...patch };
	applySettings();
	refreshShown(before);
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
	for (const tab of tabs.values()) tab.lineNumbers.refresh();
	scheduleRibbonUpdate();
	// The page stays where it is: what is read does not move. Typing centres the line.
	wakeFocusExit();
	documentMap.refresh();
}

exitFocus.addEventListener("click", toggleFocusMode);

/**
 * Focus mode's way out fades once the mouse rests (2.5s) and comes back as
 * soon as it moves, or the keyboard reaches it.
 */
const FOCUS_EXIT_IDLE = 2500;
let focusExitTimer: ReturnType<typeof setTimeout> | undefined;
function wakeFocusExit(): void {
	clearTimeout(focusExitTimer);
	delete app.dataset.focusIdle;
	if (!app.hasAttribute("data-focus")) return;
	focusExitTimer = setTimeout(() => {
		app.dataset.focusIdle = "";
	}, FOCUS_EXIT_IDLE);
}
document.addEventListener("mousemove", () => {
	if (app.hasAttribute("data-focus")) wakeFocusExit();
});

/**
 * Typewriter scrolling (focus mode, `typewriterScroll`): the line being
 * written stays a little above the middle of the view, the page moving
 * under it. Only when the keyboard moved the caret: a click puts it where
 * the user looks already.
 */
let caretByKeyboard = false;
document.addEventListener("keydown", () => {
	caretByKeyboard = true;
});
document.addEventListener("selectionchange", () => {
	if (!caretByKeyboard) return;
	caretByKeyboard = false;
	// After the editor's own scrolling into view, of the block the caret went to.
	requestAnimationFrame(() => centerCaret());
});
/**
 * The caret's line: a collapsed range's own box, or else a character's beside
 * it (a caret just moved into a block has no box of its own), or else the
 * first line of its block.
 */
function caretLine(range: Range): DOMRect | null {
	const own = range.getBoundingClientRect();
	if (own.height > 0) return own;
	const character = (text: Text, offset: number): DOMRect | null => {
		const probe = document.createRange();
		if (offset >= text.length && offset === 0) return null;
		const start = offset < text.length ? offset : offset - 1;
		probe.setStart(text, start);
		probe.setEnd(text, start + 1);
		const box = probe.getBoundingClientRect();
		return box.height > 0 ? box : null;
	};
	const node = range.startContainer;
	if (node instanceof Text) return character(node, range.startOffset);
	if (!(node instanceof Element)) return null;
	const from = node.childNodes[range.startOffset] ?? node;
	const walker = document.createTreeWalker(from, NodeFilter.SHOW_TEXT);
	const text = from instanceof Text ? from : (walker.nextNode() as Text | null);
	const found = text === null ? null : character(text, 0);
	if (found !== null) return found;
	const block = node.getBoundingClientRect();
	const line = Number.parseFloat(getComputedStyle(node).lineHeight) || 20;
	return new DOMRect(block.left, block.top, block.width, Math.min(line, block.height));
}

function centerCaret(): void {
	if (!app.hasAttribute("data-focus") || !settings.typewriterScroll) return;
	const tab = tabs.get(session.id);
	const selection = document.getSelection();
	if (tab === undefined || selection === null || selection.rangeCount === 0) return;
	const anchor = selection.anchorNode;
	if (anchor === null || !tab.canvas.contains(anchor)) return;
	const range = selection.getRangeAt(0).cloneRange();
	range.collapse(false);
	const box = caretLine(range);
	if (box === null) return;
	const view = tab.desk.getBoundingClientRect();
	const target = view.top + view.height * 0.42;
	const delta = box.top + box.height / 2 - target;
	if (Math.abs(delta) > box.height / 2) tab.desk.scrollTop += delta;
}

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
	save: () => {
		// A Confluence page is written for everyone to see: its changes are checked first.
		if (
			session.remote !== null &&
			session.dirty &&
			settings.confluenceReviewBeforeSave &&
			!changesDialog.open &&
			showConfluenceChanges()
		) {
			return;
		}
		void session.save();
	},
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
	"command-palette": () => void commandPalette.show(),
	"confluence-open": () => void confluenceDialog.show(),
	"publish-confluence": () => {
		if (session.remote !== null) {
			session.notices.show({ id: "publish", text: t.publishNotHere });
			return;
		}
		void publishDialog.show({
			tabId: session.id,
			name: session.name,
			markdown: session.styledMarkdown(),
		});
	},
	"confluence-changes": () => {
		if (!showConfluenceChanges()) {
			session.notices.show({ id: "changes", text: t.changesNotPage });
		}
	},
	"note-new": () => localNotes.add(),
	"note-next": () => localNotes.go(1),
	"note-previous": () => localNotes.go(-1),
	"notes-toggle": () => {
		const before = docks.shown();
		updateSettings(togglePane(settings, "notes", paneAvailable));
		refreshShown(before);
	},
	"jira-open": () => void jiraDialog.showSearch(),
	settings: () => openSettings(),
	typography: () => openSettings("typography"),
	extensions: () => openSettings("extensions"),
	"network-log": () => {
		if (debugMode) networkPanel.toggle();
	},
	"new-from-template": () => void templatePicker.show(),
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
	"set-up-role": () => rolePicker.show(settings.role),
	home: () => openHome(),
	"assistant-prompt": () => {
		if (session.isText || !canEdit()) return;
		selectionAssistant.prompt();
	},
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
		if (!docks.shown().has("files")) updateSettings(revealPane(settings, "files"));
		filesPane.focusSearch();
	},
};

// The assistant and a pane open on one side (kept so by an earlier version): the assistant stays.
if (settings.assistant) {
	const keep = oneOnEachSide({ ...settings, assistant: false }, { assistant: true });
	if (Object.keys(keep).length > 1) {
		settings = { ...settings, ...keep };
		bridge.updateSettings(keep);
	}
}
// The ribbon reads editor state as soon as it is built, so the documents come first.
applySettings();
for (const document of startup.documents) openDocument(document);
// A restored window's active tab is not always its last.
// (`activateTab` does nothing for the tab that is active already.)
if (startup.active !== undefined && tabs.has(startup.active)) activateTab(startup.active);
// The app's first start: whom to set it up for, once (skipped, nothing changes).
if (startup.firstRun && settings.role === "") rolePicker.show("");

// As the app closes, what is open is kept to come back next time (`session-store.ts`).
bridge.onSessionRequest(() => {
	const result: Record<string, SessionTab> = {};
	for (const [id, tab] of tabs) {
		const dirty = tab.session.dirty;
		result[id] = {
			dirty,
			name: tab.session.name,
			...(dirty ? { text: tab.session.styledMarkdown(), format: tab.session.format } : {}),
			scroll: tab.session === session ? tab.desk.scrollTop : tab.scroll,
		};
	}
	return { order: tabStrip.order(), active: session.id, tabs: result };
});
// The connections decide whether Confluence and Jira have panes; then they are filled.
void refreshAccounts();

const ribbon = createAppRibbon(ribbonHost, ribbonTrailing, {
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
setRibbonSimple = ribbon.setSimple;
// With Kalem's title bar, File and the quick access buttons are at its left, before the tabs.
if (titleBar !== null) {
	titleBar.prepend(ribbon.head);
	ribbon.headMoved();
}
ribbon.setSimple(settings.ribbonSimple);

// The editor reports no selection inside code blocks, so moving into or between
// them would not refresh the contextual Code tab.
document.addEventListener("selectionchange", scheduleRibbonUpdate);

// Shift+F3 cycles the case, as in Word; the menu only shows the shortcut.
// Ctrl+J opens the assistant's box under the caret, in the document; the menu only shows the shortcut.
document.addEventListener("keydown", (event) => {
	if (event.key !== "j" && event.key !== "J") return;
	if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
	if (!(document.activeElement instanceof Node) || !canvas.contains(document.activeElement)) return;
	event.preventDefault();
	commands["assistant-prompt"]();
});

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
bridge.onWorkspaceChange(() => {
	void filesPane.refresh();
	refreshPathBar(true);
});
bridge.onTabMoved((id) => discardTab(id));
bridge.onTabMenu((id, action) => {
	if (action === "move") moveTab(id);
	else void closeTab(id);
});
// Files may have been added or renamed elsewhere.
window.addEventListener("focus", () => {
	if (docks.shown().has("files")) void filesPane.refresh();
});

bridge.onSettings((next) => {
	const before = docks.shown();
	const favoritesChanged =
		JSON.stringify(next.confluenceFavorites) !== JSON.stringify(settings.confluenceFavorites);
	settings = next;
	if (favoritesChanged) confluencePane.render();
	applySettings();
	refreshShown(before);
	scheduleRibbonUpdate();
	// A setting changed from the menu shows in the Settings window at once.
	void settingsDialog.refresh();
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
		showSelectionCount(text);
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
		// No caret known yet: the document takes the focus where it is, not scrolled to its top.
		(canvas.querySelector("[contenteditable='true']") as HTMLElement | null)?.focus({
			preventScroll: true,
		});
		return;
	}
	selectRange(holder, caret.offset, caret.offset);
	(holder.closest("[contenteditable]") as HTMLElement | null)?.focus({ preventScroll: true });
}

function toggleAssistant(): void {
	if (!settings.assistant) {
		updateSettings({ assistant: true });
		// Once the pane is in place: a pane still being laid out does not take the focus.
		requestAnimationFrame(() => assistant.focus());
	} else if (!assistant.element.contains(document.activeElement)) {
		assistant.focus();
	} else {
		updateSettings({ assistant: false });
		returnToDocument();
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

/**
 * The specs in the workspace made from a document: a warning when the
 * document changed since one was made, else (when asked, as it opens) how
 * far its tasks are.
 */
async function checkSpecs(tab: Session, progress: boolean): Promise<void> {
	if (tab.path === null || tab.isText) return;
	const name = tab.path.split(/[\\/]/).pop() ?? "";
	let specs: Awaited<ReturnType<typeof bridge.specStatus>>;
	try {
		specs = await bridge.specStatus(name, tab.styledMarkdown());
	} catch {
		return;
	}
	const open = (path: string) => [
		{ label: t.specOpenTasks, run: () => void bridge.openPath(path) },
	];
	const stale = specs.find((spec) => spec.stale === true);
	if (stale !== undefined) {
		tab.notices.show({
			id: "spec",
			kind: "warning",
			text: format(t.specStale, stale.folder),
			actions: open(stale.tasksPath),
		});
		return;
	}
	tab.notices.dismiss("spec");
	const shown = progress ? specs.find((spec) => spec.total > 0) : undefined;
	if (shown !== undefined) {
		tab.notices.show({
			id: "spec",
			text: format(t.specProgress, shown.folder, shown.done, shown.total),
			actions: open(shown.tasksPath),
		});
	}
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
		// Proposed changes are applied from their card, not inserted.
		if (part.kind === "actions") continue;
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

/** A text's start, for a message naming it. */
const excerpt = (text: string): string => {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/**
 * The assistant's proposed changes on the active document: the text edits
 * as one edit (one undo brings the text back), then the insertions at the
 * cursor. Resolves with how many changes were made.
 */
async function applyAssistantActions(
	actions: readonly DocumentAction[],
	review = false,
): Promise<number> {
	const tab = editableTab();
	const edits = actions.filter((action) => action.type !== "insert" || action.at !== "cursor");
	const atCursor = actions.filter((action) => action.type === "insert" && action.at === "cursor");
	let changes = 0;
	if (edits.length > 0) {
		const before = tab.styledMarkdown();
		const result = applyActions(before, edits);
		if (!result.ok) {
			const failed = edits[result.index];
			const text = failed?.type === "replace" ? failed.find : "";
			throw new Error(
				format(
					result.reason === "missing" ? t.assistantActionMissing : t.assistantActionAmbiguous,
					excerpt(text),
				),
			);
		}
		// The text before the assistant's change: a point to go back to in the version history.
		if (tab.path !== null && result.text !== before.replace(/\r\n?/g, "\n")) {
			bridge.assistantCheckpoint(tab.id, before);
		}
		const reviewing = review ? [...tabs.values()].find((each) => each.session === tab) : undefined;
		if (reviewing !== undefined && !tab.isText) {
			// Shown in the document, each part to accept or reject.
			changes += reviewing.review.start(before, result.text);
		} else if (result.text !== before.replace(/\r\n?/g, "\n")) {
			if (!tab.replaceText(result.text)) throw new Error(t.readOnlyBlocked);
			changes += result.changes;
		}
	}
	for (const insert of atCursor) {
		if (insert.type !== "insert") continue;
		await insertReply(insert.text);
		changes++;
	}
	return changes;
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

createLinkCard({
	t,
	lang: startup.language,
	host: deskArea,
	place: () => {
		const page = session.remote;
		return page === null
			? null
			: { tabId: session.id, site: page.site, spaceKey: page.spaceKey, pageUrl: page.webUrl };
	},
	atomSource: (href) => session.atomSource(href),
	resolve: (tabId, xml) => bridge.confluenceAtom(tabId, xml),
	isAttachment: (link) => attachmentOf(link) !== null,
	openLink: (url) => bridge.openLink(url),
	openPage: async (spaceKey, title) => {
		const site = session.remote?.site;
		if (site === undefined) return;
		const [found] = await bridge.confluenceSearch(displayUrl(site, spaceKey, title), null);
		if (found === undefined) throw new Error(format(t.atomPageMissing, title));
		await bridge.confluenceOpenPage(found.id);
	},
	openJira: ({ key, jql, url }) =>
		void (key !== "" ? jiraDialog.showIssue(key, url) : jiraDialog.showSearch(jql, url)),
	notice: (text) =>
		session.notices.show({
			id: "link",
			kind: "error",
			text: format(t.confluenceRequestFailed, ipcErrorMessage(new Error(text))),
		}),
});

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
