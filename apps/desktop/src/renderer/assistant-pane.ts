import { parse } from "@kalem-editor/core";
import { renderToDOM } from "@kalem-editor/viewer";
import type { AssistantAction, AssistantCommand, DocumentAction } from "../shared/actions.js";
import { isDocumentAction } from "../shared/actions.js";
import type { AssistantStatus, Command, KalemBridge, Settings } from "../shared/bridge.js";
import { clampAssistantWidth, DEFAULT_SETTINGS, MIN_ASSISTANT_WIDTH } from "../shared/bridge.js";
import type { ChatSummary, StoredChat, StoredMessage } from "../shared/chats.js";
import { chatTitle, historyOf } from "../shared/chats.js";
import type {
	ClaudeEvent,
	ContextDiagram,
	PlanStep,
	ProposedEdit,
	ReplyDiagram,
	ReplyPart,
} from "../shared/claude.js";
import { composePrompt, lineDiff, splitReply } from "../shared/claude.js";
import { withoutRequests as withoutLookups } from "../shared/confluence-tool.js";
import { diagramSvg, svgMarkup } from "../shared/diagram.js";
import { outlineText } from "../shared/document-outline.js";
import type { Finding } from "../shared/findings.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { Mode } from "../shared/modes.js";
import { isMode, MODE_LABELS, MODES } from "../shared/modes.js";
import type { ProviderId } from "../shared/providers.js";
import { isCli, PROVIDER_INFO, providerLabel, SUGGESTED_MODELS } from "../shared/providers.js";
import type { SlashEntry } from "../shared/slash.js";
import { findSlash, matchSlash, slashQuery } from "../shared/slash.js";
import type { ApprovalRequest } from "../shared/tool-protocol.js";
import { withoutToolCalls } from "../shared/tool-protocol.js";
import type { ApprovalState, MadeChange, Usage } from "./assistant-agent.js";
import { approvalCard, changeLine, planCard, usageText } from "./assistant-agent.js";
import { createAssistantSettings } from "./assistant-settings.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";
import type { Previews } from "./previews.js";
import type { DocumentImage } from "./prompt-images.js";

/** What the assistant knows of the active document when a question is sent. */
export interface AssistantContext {
	readonly tabId: string;
	readonly name: string;
	readonly text: string;
	readonly diagrams: readonly ContextDiagram[];
}

export interface AssistantHost {
	readonly t: Strings;
	readonly lang: Lang;
	readonly bridge: KalemBridge;
	readonly previews: Previews;
	shareDocument(): boolean;
	setShareDocument(share: boolean): void;
	/** The panel's width; `setWidth` keeps it. */
	width(): number;
	setWidth(width: number): void;
	context(): Promise<AssistantContext>;
	/** The document's pictures, for the model to look at. */
	images(): Promise<DocumentImage[]>;
	/** The text last selected in the document; empty when none. */
	selection(): string;
	/** The folders opened with Open Folder: each chat's workspace unless it leaves one out. */
	workspaceFolders(): readonly string[];
	/** Puts a reply's Markdown at the caret, its Kalem diagrams as pictures. */
	insert(text: string): Promise<void>;
	/** Applies proposed changes to the active document; resolves with how many were made. */
	applyActions(actions: readonly DocumentAction[]): Promise<number>;
	insertDiagram(diagram: ReplyDiagram): Promise<void>;
	openDiagram(diagram: ReplyDiagram): void;
	/** Whether the document shows the diagram picture at `src`. */
	hasDiagram(src: string): boolean;
	updateDiagram(src: string, diagram: ReplyDiagram): Promise<void>;
	openLink(href: string): void;
	/** Runs one of the app's commands (save, export, insert a table…) on the active document. */
	runCommand(command: Command): void;
	/** Changes settings, as the menus do (an assistant's change undone). */
	changeSettings(patch: Partial<Settings>): void;
	close(): void;
	errorText(error: unknown): string;
}

export interface AssistantPane {
	readonly element: HTMLElement;
	/** Looks for the service, and picks up the last chat, when shown for the first time. */
	show(): void;
	focus(): void;
	/** The document's selection changed. */
	refreshSelection(): void;
	/** The folders open in the Files pane changed. */
	workspaceChanged(): void;
	/** The service was set in the Settings window; `changed` when it is another service. */
	configured(status: AssistantStatus, changed: boolean): void;
}

interface Message {
	readonly role: "user" | "assistant";
	text: string;
	error: string | null;
	done: boolean;
	readonly notes: readonly string[];
	/** The model that answered; empty when the service chose. */
	readonly model?: string;
	/** What it looked up in the workspace while answering, in this run. */
	steps?: string[];
	/** Changes to workspace files it proposed, in this run. */
	edits?: ProposedEdit[];
	/** What it asked the user before changing something, in this run. */
	approvals?: ApprovalRequest[];
	/** Its plan for the answer. */
	plan?: readonly PlanStep[];
	/** What it changed, each with its undo. */
	changes?: MadeChange[];
	/** What the answer cost. */
	usage?: Usage;
	/** Problems a review found in the document. */
	findings?: Finding[];
}

/** A reply's text as the user sees it: without the look-ups and tool calls written in it. */
const withoutRequests = (text: string): string => withoutToolCalls(withoutLookups(text));

/** Documents longer than this go to a model that reads them with tools as their outline only. */
const LARGE_DOCUMENT = 24_000;

/** A conversation, shown or not; a reply keeps coming in while another chat is shown. */
interface Chat {
	readonly id: string;
	title: string;
	provider: ProviderId;
	sessionId: string | null;
	folder: string | null;
	readonly created: number;
	updated: number;
	readonly messages: Message[];
	/** Files and folders added to the chat; their text goes with each question. */
	sources: string[];
	/** Folders open in the Files pane that this chat leaves out. */
	skipped: string[];
	/** The document text the service was last given in this chat, in this run. */
	sharedText: string | null;
	/** The reply coming in, and what ends the wait for it. */
	reply: Message | null;
	ended: (() => void) | null;
}

const INSTALL: Readonly<Record<"claude-code" | "copilot", { command: string; url: string }>> = {
	"claude-code": {
		command: "npm install -g @anthropic-ai/claude-code",
		url: "https://docs.anthropic.com/en/docs/claude-code/setup",
	},
	copilot: {
		command: "npm install -g @github/copilot",
		url: "https://docs.github.com/copilot/how-tos/set-up/install-copilot-cli",
	},
};

const WIDTH_STEP = 20;
const MAX_SOURCES = 20;

/** A path's last part, for a chip. */
const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function button(
	label: string,
	options: { icon?: Parameters<typeof icon>[0]; class?: string; title?: string } = {},
): HTMLButtonElement {
	return el("button", {
		class: options.class ?? "assistant-action",
		attrs: { type: "button", ...(options.title === undefined ? {} : { title: options.title }) },
		children: [...(options.icon === undefined ? [] : [icon(options.icon)]), label],
	});
}

function iconButton(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement {
	return el("button", {
		class: "icon-button",
		attrs: { type: "button", title: label, "aria-label": label, "data-icon": name },
		children: [icon(name)],
	});
}

export function createAssistantPane(host: AssistantHost): AssistantPane {
	const { t, bridge } = host;

	let status: AssistantStatus | null = null;
	/** The chats opened in this run, by id. */
	const chats = new Map<string, Chat>();
	let active: Chat = blankChat();
	chats.set(active.id, active);
	let view: "chat" | "settings" | "history" = "chat";
	let restored = false;
	/** A selection the user took off the next question. */
	let droppedSelection: string | null = null;
	/** The shown chat's messages and their elements. */
	const shown = new Map<Message, { element: HTMLElement; body: HTMLElement }>();

	function blankChat(): Chat {
		const now = Date.now();
		return {
			id: crypto.randomUUID(),
			title: "",
			provider: status?.provider ?? "claude-code",
			sessionId: null,
			folder: null,
			created: now,
			updated: now,
			messages: [],
			sources: [],
			skipped: [],
			sharedText: null,
			reply: null,
			ended: null,
		};
	}

	// --- Shell ---------------------------------------------------------------

	const subtitle = el("span", { class: "assistant-subtitle" });
	const historyButton = iconButton("chats", t.assistantChats);
	const newChat = iconButton("new", t.assistantNewChat);
	const settingsButton = iconButton("settings", t.assistantSettings);
	const close = iconButton("close", t.assistantClose);
	historyButton.addEventListener(
		"click",
		() => void setView(view === "history" ? "chat" : "history"),
	);
	newChat.addEventListener("click", () => startChat());
	settingsButton.addEventListener(
		"click",
		() => void setView(view === "settings" ? "chat" : "settings"),
	);
	close.addEventListener("click", () => host.close());

	const log = el("div", {
		class: "assistant-log",
		attrs: { role: "log", "aria-live": "polite", "aria-label": t.assistantConversation },
	});
	const empty = el("div", { class: "assistant-empty" });
	const missing = el("div", { class: "assistant-missing", attrs: { hidden: "" } });
	const history = el("div", {
		class: "assistant-history",
		attrs: { hidden: "", "aria-label": t.assistantChats },
	});
	const settings = createAssistantSettings({
		t,
		bridge,
		openLink: (href) => host.openLink(href),
		errorText: host.errorText,
		done(next, changed) {
			if (next !== null) configured(next, changed);
			void setView("chat");
		},
	});

	/** The service or model was set, here or in the Settings window. */
	function configured(next: AssistantStatus, changed: boolean): void {
		status = next;
		// Another service does not know what was said so far: it gets a chat of its own.
		if (changed && active.messages.length > 0) startChat();
		else if (changed) active.provider = next.provider;
		render();
	}

	const share = el("input", { attrs: { type: "checkbox" } });
	share.addEventListener("change", () => host.setShareDocument(share.checked));
	const selectionText = el("span", { class: "assistant-chip-text" });
	const dropSelection = el("button", {
		class: "assistant-chip-close",
		attrs: {
			type: "button",
			title: t.assistantDropSelection,
			"aria-label": t.assistantDropSelection,
		},
		children: [icon("close")],
	});
	const selectionChip = el("span", {
		class: "assistant-chip",
		attrs: { hidden: "" },
		children: [selectionText, dropSelection],
	});
	dropSelection.addEventListener("click", () => {
		droppedSelection = host.selection();
		refreshSelection();
		input.focus();
	});

	// --- Sources: files and folders added to the chat ---

	const addButton = el("button", {
		class: "assistant-add",
		attrs: {
			type: "button",
			title: t.assistantAddSource,
			"aria-label": t.assistantAddSource,
			"aria-haspopup": "menu",
			"aria-expanded": "false",
		},
		children: [icon("plus")],
	});
	const addMenu = el("div", {
		class: "assistant-add-menu",
		attrs: { role: "menu", hidden: "", "aria-label": t.assistantAddSource },
	});
	const sourceList = el("div", { class: "assistant-sources", attrs: { hidden: "" } });

	function menuItem(label: string, name: Parameters<typeof icon>[0], run: () => void): HTMLElement {
		const item = el("button", {
			class: "assistant-add-item",
			attrs: { type: "button", role: "menuitem" },
			children: [icon(name), label],
		});
		item.addEventListener("click", () => {
			hideAddMenu();
			run();
		});
		return item;
	}

	function showAddMenu(): void {
		addMenu.replaceChildren(
			menuItem(t.assistantAddFiles, "file", () => void pickSources("files")),
			menuItem(t.assistantAddFolder, "open", () => void pickSources("folder")),
			// An open folder this chat left out can come back.
			...host
				.workspaceFolders()
				.filter((folder) => active.skipped.includes(folder))
				.map((folder) =>
					menuItem(format(t.assistantAddWorkspace, baseName(folder)), "open", () => {
						active.skipped = active.skipped.filter((skipped) => skipped !== folder);
						save(active);
						renderSources();
					}),
				),
		);
		addMenu.hidden = false;
		addButton.setAttribute("aria-expanded", "true");
		(addMenu.firstElementChild as HTMLElement | null)?.focus();
	}

	function hideAddMenu(): void {
		addMenu.hidden = true;
		addButton.setAttribute("aria-expanded", "false");
	}

	addButton.addEventListener("click", () => (addMenu.hidden ? showAddMenu() : hideAddMenu()));
	addMenu.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			hideAddMenu();
			addButton.focus();
		}
	});
	document.addEventListener("mousedown", (event) => {
		if (!addMenu.hidden && !addMenu.contains(event.target as Node) && event.target !== addButton) {
			hideAddMenu();
		}
	});

	async function pickSources(kind: "files" | "folder"): Promise<void> {
		try {
			addSources(await bridge.assistantPickSources(kind));
		} catch (error) {
			showNotice(format(t.assistantActionFailed, host.errorText(error)));
		}
	}

	function addSources(paths: readonly string[]): void {
		const chat = active;
		const added = paths.filter((path) => !chat.sources.includes(path));
		if (added.length === 0) return;
		chat.sources = [...chat.sources, ...added].slice(0, MAX_SOURCES);
		save(chat);
		renderSources();
		input.focus();
	}

	function removeSource(path: string): void {
		active.sources = active.sources.filter((source) => source !== path);
		save(active);
		renderSources();
	}

	/** The open folders this chat uses as its workspace. */
	function openFolders(chat: Chat): string[] {
		return host
			.workspaceFolders()
			.filter((folder) => !chat.skipped.includes(folder) && !chat.sources.includes(folder));
	}

	/** What goes with a question: the open folders, then what was added to the chat. */
	function chatSources(chat: Chat): string[] {
		return [...openFolders(chat), ...chat.sources].slice(0, MAX_SOURCES);
	}

	function skipFolder(path: string): void {
		active.skipped = [...active.skipped, path];
		save(active);
		renderSources();
	}

	function renderSources(): void {
		const open = openFolders(active);
		sourceList.hidden = active.sources.length === 0 && open.length === 0;
		sourceList.replaceChildren(
			...open.map((path) => {
				const name = baseName(path);
				const remove = el("button", {
					class: "assistant-chip-close",
					attrs: {
						type: "button",
						title: format(t.assistantSkipWorkspace, name),
						"aria-label": format(t.assistantSkipWorkspace, name),
					},
					children: [icon("close")],
				});
				remove.addEventListener("click", () => skipFolder(path));
				return el("span", {
					class: "assistant-chip assistant-source assistant-source-workspace",
					attrs: { title: `${path}\n${t.assistantWorkspaceChip}` },
					children: [
						icon("open"),
						el("span", { class: "assistant-chip-text", text: name }),
						remove,
					],
				});
			}),
			...active.sources.map((path) => {
				const name = baseName(path);
				const remove = el("button", {
					class: "assistant-chip-close",
					attrs: {
						type: "button",
						title: format(t.assistantRemoveSource, name),
						"aria-label": format(t.assistantRemoveSource, name),
					},
					children: [icon("close")],
				});
				remove.addEventListener("click", () => removeSource(path));
				return el("span", {
					class: "assistant-chip assistant-source",
					attrs: { title: path },
					children: [el("span", { class: "assistant-chip-text", text: name }), remove],
				});
			}),
		);
	}

	const input = el("textarea", {
		class: "assistant-input",
		attrs: { rows: "1", placeholder: t.assistantPlaceholder, "aria-label": t.assistantPlaceholder },
	});
	const sendButton = el("button", {
		class: "assistant-send",
		attrs: { type: "button", title: t.assistantSend, "aria-label": t.assistantSend },
		children: [icon("send")],
	});
	const modelSelect = el("select", {
		class: "assistant-model",
		attrs: { "aria-label": t.assistantModel, title: t.assistantModel },
	});
	let mode: Mode = "ask";
	try {
		const kept = localStorage.getItem("kalem.assistant.mode");
		if (isMode(kept)) mode = kept;
	} catch {
		// Storage may be unavailable: the default mode is fine.
	}
	const modeSelect = el("select", {
		class: "assistant-mode",
		attrs: { "aria-label": t.assistantMode, title: t.assistantMode },
		children: MODES.map((value) => el("option", { text: t[MODE_LABELS[value]], attrs: { value } })),
	});
	modeSelect.value = mode;
	modeSelect.addEventListener("change", () => {
		if (isMode(modeSelect.value)) mode = modeSelect.value;
		try {
			localStorage.setItem("kalem.assistant.mode", mode);
		} catch {
			// Kept for this run only.
		}
	});
	const MORE_MODELS = "\u0000more";
	modelSelect.addEventListener("change", async () => {
		const picked = modelSelect.value;
		if (picked === MORE_MODELS) {
			renderModels();
			void setView("settings");
			return;
		}
		await setModel(picked);
	});

	async function setModel(model: string): Promise<void> {
		modelSelect.disabled = true;
		try {
			status = await bridge.assistantSetModel(model);
		} catch (error) {
			showNotice(format(t.assistantActionFailed, host.errorText(error)));
		} finally {
			modelSelect.disabled = false;
			render();
		}
	}
	const menu = el("ul", {
		class: "assistant-commands",
		attrs: { id: "assistant-commands", role: "listbox", hidden: "", "aria-label": t.slashCommands },
	});
	input.setAttribute("aria-autocomplete", "list");
	input.setAttribute("aria-controls", menu.id);
	input.setAttribute("aria-expanded", "false");
	/** One click asks about the selection: the usual rewrites, applied as changes. */
	const quick = el("div", {
		class: "assistant-quick",
		attrs: { role: "group", "aria-label": t.assistantSelectionActions },
		children: (
			[
				[t.assistantQuickImprove, t.assistantPromptImprove, "wand"],
				[t.assistantQuickShorten, t.assistantPromptShorten, "outdent"],
				[t.assistantQuickFix, t.assistantPromptFix, "check"],
				[t.assistantQuickTranslate, t.assistantPromptTranslate, "replace"],
				[t.assistantQuickExplain, t.assistantPromptExplain, "chats"],
			] as const
		).map(([label, prompt, name]) => {
			const item = button(label, { class: "assistant-quick-button", icon: name, title: prompt });
			item.addEventListener("click", () => ask(prompt));
			return item;
		}),
	});
	const context = el("div", {
		class: "assistant-context",
		attrs: { hidden: "" },
		children: [selectionChip, quick],
	});
	const jump = el("button", {
		class: "assistant-jump",
		attrs: {
			type: "button",
			hidden: "",
			title: t.assistantJumpToEnd,
			"aria-label": t.assistantJumpToEnd,
		},
		children: [icon("arrowDown")],
	});
	jump.addEventListener("click", () => {
		log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
		input.focus();
	});
	const composer = el("div", {
		class: "assistant-composer",
		children: [
			context,
			sourceList,
			el("div", {
				class: "assistant-box",
				children: [
					input,
					el("div", {
						class: "assistant-toolbar",
						children: [
							addButton,
							el("label", {
								class: "assistant-share",
								attrs: { title: t.slashShare },
								children: [
									share,
									el("span", { class: "assistant-share-text", text: t.assistantShareDocument }),
								],
							}),
							el("span", { class: "assistant-toolbar-space" }),
							modeSelect,
							modelSelect,
							sendButton,
						],
					}),
				],
			}),
			menu,
			addMenu,
			jump,
		],
	});

	const resizer = el("div", {
		class: "assistant-resizer",
		attrs: {
			role: "separator",
			tabindex: "0",
			"aria-orientation": "vertical",
			"aria-label": t.assistantResize,
			title: t.assistantResize,
			"aria-valuemin": String(MIN_ASSISTANT_WIDTH),
		},
	});

	const element = el("aside", {
		class: "assistant kalem-theme",
		attrs: { id: "assistant-pane", "aria-label": t.assistantPane },
		children: [
			resizer,
			el("div", {
				class: "assistant-header",
				children: [
					el("div", {
						class: "assistant-title",
						children: [icon("assistant"), el("h2", { text: t.assistantTitle }), subtitle],
					}),
					el("div", {
						class: "assistant-header-actions",
						children: [historyButton, newChat, settingsButton, close],
					}),
				],
			}),
			log,
			empty,
			missing,
			history,
			settings.element,
			composer,
		],
	});

	// Links in replies open in the browser; the window itself never navigates.
	log.addEventListener("click", (event) => {
		const link = event.target instanceof Element ? event.target.closest("a") : null;
		if (link === null) return;
		event.preventDefault();
		const href = link.getAttribute("href");
		if (href !== null && href !== "") host.openLink(href);
	});

	input.addEventListener("input", () => updateMenu());
	// Late, so a click on the menu still lands; not when the box has the focus back by then.
	input.addEventListener("blur", () =>
		setTimeout(() => {
			if (document.activeElement !== input) hideMenu();
		}, 150),
	);
	input.addEventListener("keydown", (event) => {
		if (!menu.hidden && menuItems.length > 0) {
			const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
			if (move !== 0) {
				event.preventDefault();
				menuIndex = (menuIndex + move + menuItems.length) % menuItems.length;
				renderMenu();
				return;
			}
			if ((event.key === "Enter" && !event.shiftKey && !event.isComposing) || event.key === "Tab") {
				event.preventDefault();
				const picked = menuItems[menuIndex];
				if (picked !== undefined) pick(picked);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				hideMenu();
				return;
			}
		}
		if (event.key === "ArrowUp" && input.value === "" && !event.isComposing) {
			// The last question comes back, to ask it again or change it.
			const last = [...active.messages].reverse().find((message) => message.role === "user");
			if (last !== undefined) {
				event.preventDefault();
				input.value = last.text;
			}
			return;
		}
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			if (!runTyped()) void send();
		} else if (event.key === "Escape" && active.reply !== null) {
			event.preventDefault();
			void bridge.assistantStop(active.id);
		}
	});
	sendButton.addEventListener("click", () => {
		if (active.reply !== null) void bridge.assistantStop(active.id);
		else if (!runTyped()) void send();
	});

	// --- Commands ------------------------------------------------------------------

	interface ChatCommand extends SlashEntry {
		/** What the argument is, for a command that takes one. */
		readonly argument?: string;
		run(arg: string): void;
	}

	/** Puts a question in the input and sends it, as if typed. */
	const ask = (question: string): void => {
		input.value = question;
		void send();
	};
	const app = (name: string, command: Command, label: string): ChatCommand => ({
		name,
		label: label.replace(/…$/, ""),
		run: () => host.runCommand(command),
	});
	const exportLabel = (label: string): string => `${t.export}: ${label}`;

	const commands: readonly ChatCommand[] = [
		{ name: "new", label: t.assistantNewChat, run: () => startChat() },
		{ name: "chats", label: t.assistantChats, run: () => void setView("history") },
		{
			name: "model",
			label: t.slashModel,
			argument: t.assistantModel,
			run(arg) {
				if (arg !== "") void setModel(arg);
				else {
					modelSelect.focus();
					modelSelect.showPicker?.();
				}
			},
		},
		{ name: "settings", label: t.assistantSettings, run: () => void setView("settings") },
		{
			name: "share",
			label: t.slashShare,
			run() {
				host.setShareDocument(!host.shareDocument());
				render();
			},
		},
		{ name: "stop", label: t.assistantStop, run: () => void bridge.assistantStop(active.id) },
		{
			name: "help",
			label: t.slashHelp,
			run() {
				input.value = "/";
				updateMenu();
			},
		},
		{
			name: "summarize",
			label: t.assistantSuggestSummary,
			run: () => ask(t.assistantSuggestSummary),
		},
		{
			name: "diagram",
			label: t.slashDiagram,
			argument: t.slashDiagramArgument,
			run: (arg) => ask(arg === "" ? t.assistantSuggestDiagram : format(t.slashDiagramPrompt, arg)),
		},
		{
			name: "improve",
			label: t.assistantSuggestImprove,
			run: () => ask(t.assistantSuggestImprove),
		},
		{ name: "to-table", label: t.assistantSuggestTable, run: () => ask(t.assistantSuggestTable) },
		{
			name: "confluence",
			label: t.slashConfluence,
			argument: t.slashConfluenceArgument,
			run: (arg) => {
				if (arg === "") {
					input.value = "/confluence ";
					input.focus();
				} else ask(format(t.slashConfluencePrompt, arg));
			},
		},
		{
			name: "jira",
			label: t.slashJira,
			argument: t.slashJiraArgument,
			run: (arg) => {
				if (arg === "") {
					input.value = "/jira ";
					input.focus();
				} else ask(format(t.slashJiraPrompt, arg));
			},
		},
		{
			name: "fix",
			label: t.slashFix,
			run: () => ask(host.selection().trim() === "" ? t.assistantSuggestFix : t.assistantPromptFix),
		},
		{ name: "shorten", label: t.slashShorten, run: () => ask(t.assistantPromptShorten) },
		{ name: "explain", label: t.slashExplain, run: () => ask(t.assistantPromptExplain) },
		{
			name: "translate",
			label: t.slashTranslate,
			argument: t.slashTranslateArgument,
			run: (arg) =>
				ask(arg === "" ? t.assistantPromptTranslate : format(t.slashTranslatePrompt, arg)),
		},
		{ name: "apply", label: t.slashApply, run: () => applyLatest() },
		app("save", "save", t.save),
		app("save-as", "save-as", t.saveAs),
		app("export-docx", "export-docx", exportLabel(t.exportDocx)),
		app("export-html", "export-html", exportLabel(t.exportHtml)),
		app("export-confluence", "export-confluence", exportLabel(t.exportConfluence)),
		app("history", "version-history", t.versionHistory),
		app("find", "find", t.find),
		app("replace", "replace", t.replace),
		app("table", "table", t.insertTable),
		app("new-diagram", "diagram", t.diagramInsert),
		app("image", "image", t.image),
		app("source", "source", t.markdownSource),
		app("focus", "focus", t.focusMode),
		app("read-only", "read-only", t.readOnly),
		app("open", "quick-open", t.quickOpen),
		app("search", "search-folder", t.searchFolder),
		app("format-code", "format-all-code", t.formatAllCode),
	];

	let menuItems: ChatCommand[] = [];
	let menuIndex = 0;

	function updateMenu(): void {
		const query = slashQuery(input.value);
		if (query === null || query.complete) {
			hideMenu();
			return;
		}
		menuItems = matchSlash(commands, query.name, host.lang);
		menuIndex = 0;
		if (menuItems.length === 0) {
			hideMenu();
			return;
		}
		menu.hidden = false;
		input.setAttribute("aria-expanded", "true");
		renderMenu();
	}

	function renderMenu(): void {
		menu.replaceChildren(
			...menuItems.map((command, index) => {
				const item = el("li", {
					class: "assistant-command",
					attrs: {
						id: `assistant-command-${index}`,
						role: "option",
						"aria-selected": String(index === menuIndex),
					},
					children: [
						el("span", {
							class: "assistant-command-name",
							text: `/${command.name}${command.argument === undefined ? "" : ` <${command.argument}>`}`,
						}),
						el("span", { class: "assistant-command-label", text: command.label }),
					],
				});
				// Before the input loses focus, so the click is not lost with the menu.
				item.addEventListener("mousedown", (event) => {
					event.preventDefault();
					pick(command);
				});
				return item;
			}),
		);
		input.setAttribute("aria-activedescendant", `assistant-command-${menuIndex}`);
		menu.children[menuIndex]?.scrollIntoView({ block: "nearest" });
	}

	function hideMenu(): void {
		menu.hidden = true;
		menuItems = [];
		input.setAttribute("aria-expanded", "false");
		input.removeAttribute("aria-activedescendant");
	}

	/** A command picked in the menu: one with an argument waits for it, the others run. */
	function pick(command: ChatCommand): void {
		hideMenu();
		if (command.argument !== undefined) {
			input.value = `/${command.name} `;
			input.focus();
			return;
		}
		input.value = "";
		command.run("");
	}

	/** Runs the command typed in the input; `false` when the input is not a command. */
	function runTyped(): boolean {
		const query = slashQuery(input.value);
		if (query === null) return false;
		const command = findSlash(commands, query.name, host.lang);
		if (command === undefined) {
			showNotice(format(t.slashUnknown, query.name));
			return true;
		}
		input.value = "";
		hideMenu();
		command.run(query.arg);
		return true;
	}

	// --- Width ---------------------------------------------------------------------

	/** At most what leaves the document some room. */
	const widest = (): number => Math.max(MIN_ASSISTANT_WIDTH, window.innerWidth - 360);
	const fit = (width: number): number => Math.min(widest(), clampAssistantWidth(width));

	function showWidth(width: number): void {
		element.style.width = `${width}px`;
		resizer.setAttribute("aria-valuenow", String(width));
		resizer.setAttribute("aria-valuemax", String(widest()));
	}

	resizer.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		resizer.setPointerCapture(event.pointerId);
		const right = element.getBoundingClientRect().right;
		let width = host.width();
		element.classList.add("resizing");
		const move = (moved: PointerEvent): void => {
			width = fit(right - moved.clientX);
			showWidth(width);
		};
		const up = (): void => {
			resizer.removeEventListener("pointermove", move);
			resizer.removeEventListener("pointerup", up);
			resizer.removeEventListener("pointercancel", up);
			element.classList.remove("resizing");
			host.setWidth(width);
		};
		resizer.addEventListener("pointermove", move);
		resizer.addEventListener("pointerup", up);
		resizer.addEventListener("pointercancel", up);
	});
	resizer.addEventListener("keydown", (event) => {
		const step =
			event.key === "ArrowLeft" ? WIDTH_STEP : event.key === "ArrowRight" ? -WIDTH_STEP : 0;
		if (step === 0) return;
		event.preventDefault();
		host.setWidth(fit(host.width() + step));
	});
	resizer.addEventListener("dblclick", () => host.setWidth(fit(DEFAULT_SETTINGS.assistantWidth)));
	window.addEventListener("resize", () => {
		if (!element.hidden) showWidth(fit(host.width()));
	});

	// --- States --------------------------------------------------------------------

	function renderEmpty(): void {
		const suggestions = (
			[
				[t.assistantSuggestSummary, "file"],
				[t.assistantSuggestDiagram, "diagram"],
				[t.assistantSuggestFix, "pencil"],
				[t.assistantSuggestTable, "table"],
			] as const
		).map(([text, name]) => {
			const suggestion = el("button", {
				class: "assistant-suggestion",
				attrs: { type: "button" },
				children: [icon(name), el("span", { text })],
			});
			suggestion.addEventListener("click", () => {
				input.value = text;
				void send();
			});
			return suggestion;
		});
		empty.replaceChildren(
			el("div", { class: "assistant-empty-icon", children: [icon("assistant")] }),
			el("p", { class: "assistant-empty-title", text: t.assistantWelcome }),
			el("p", { class: "assistant-empty-hint", text: t.assistantWelcomeHint }),
			el("div", { class: "assistant-suggestions", children: suggestions }),
			recent,
		);
	}

	/** The last chats, under the suggestions of an empty one, so earlier chats are a click away. */
	const recent = el("div", { class: "assistant-recent", attrs: { hidden: "" } });
	const RECENT = 5;

	async function refreshRecent(): Promise<void> {
		const list = (await bridge.assistantChats().catch(() => [])).filter(
			(summary) => summary.id !== active.id,
		);
		recent.hidden = list.length === 0;
		if (list.length === 0) return;
		const all = button(t.assistantAllChats, { class: "assistant-link", icon: "chats" });
		all.addEventListener("click", () => void setView("history"));
		recent.replaceChildren(
			el("p", { class: "assistant-recent-title", text: t.assistantRecentChats }),
			el("ul", {
				class: "assistant-history-list",
				children: list.slice(0, RECENT).map((summary) => {
					const open = el("button", {
						class: "assistant-history-open",
						attrs: { type: "button" },
						children: [
							el("span", {
								class: "assistant-history-title",
								text: summary.title || t.assistantUntitledChat,
							}),
							el("span", {
								class: "assistant-history-meta",
								text: `${dateFormat.format(summary.updated)} · ${providerLabel(t, summary.provider)}`,
							}),
						],
					});
					open.addEventListener("click", () => void openChat(summary.id));
					return el("li", { class: "assistant-history-row", children: [open] });
				}),
			}),
			all,
		);
	}

	// --- Models --------------------------------------------------------------------

	/** The models offered for each service, asked for once. */
	const modelLists = new Map<ProviderId, readonly string[]>();

	/** Fills the model picker from the service's list (fetched once), the model in use first. */
	function renderModels(): void {
		if (status === null) return;
		const provider = status.provider;
		const cli = isCli(PROVIDER_INFO[provider]);
		const listed = modelLists.get(provider) ?? SUGGESTED_MODELS[provider] ?? [];
		const names = [...new Set([...(status.model === "" ? [] : [status.model]), ...listed])];
		modelSelect.replaceChildren(
			...(cli ? [el("option", { text: t.assistantDefaultModel, attrs: { value: "" } })] : []),
			...names.map((name) => el("option", { text: name, attrs: { value: name } })),
			el("option", { text: t.assistantMoreModels, attrs: { value: MORE_MODELS } }),
		);
		modelSelect.value = status.model;
		if (modelLists.has(provider) || !status.ready) return;
		modelLists.set(provider, []);
		void bridge
			.assistantModels({ provider, baseUrl: "" })
			.then((found) => {
				modelLists.set(provider, found);
				if (status?.provider === provider) renderModels();
			})
			.catch(() => {});
	}

	function renderMissing(): void {
		const setUp = button(t.assistantSetUp, { class: "assistant-primary" });
		setUp.addEventListener("click", () => void setView("settings"));
		if (status?.missing === "setup") {
			missing.replaceChildren(
				el("p", { class: "assistant-empty-title", text: t.assistantSetupTitle }),
				el("p", { class: "assistant-empty-hint", text: t.assistantSetupHint }),
				el("div", { class: "assistant-missing-actions", children: [setUp] }),
			);
			return;
		}
		const copilot = status?.provider === "copilot";
		const install = INSTALL[copilot ? "copilot" : "claude-code"];
		const guide = button(t.assistantInstall, { class: "assistant-link" });
		guide.addEventListener("click", () => host.openLink(install.url));
		const locate = button(t.assistantLocate);
		locate.addEventListener("click", async () => {
			status = await bridge.assistantLocate();
			render();
		});
		const retry = button(t.assistantRetry);
		retry.addEventListener("click", async () => {
			retry.disabled = true;
			status = await bridge.assistantStatus(true);
			retry.disabled = false;
			render();
		});
		const useApi = button(t.assistantUseApi);
		useApi.addEventListener("click", () => void setView("settings"));
		missing.replaceChildren(
			el("p", {
				class: "assistant-empty-title",
				text: copilot ? t.copilotMissing : t.assistantMissing,
			}),
			el("p", {
				class: "assistant-empty-hint",
				text: copilot ? t.copilotMissingHint : t.assistantMissingHint,
			}),
			el("code", { class: "assistant-command", text: install.command }),
			el("p", {
				class: "assistant-empty-hint",
				text: copilot ? t.copilotMissingLogin : t.assistantMissingLogin,
			}),
			el("div", { class: "assistant-missing-actions", children: [guide, locate, retry] }),
			el("p", { class: "assistant-empty-hint", text: t.assistantOrApi }),
			el("div", { class: "assistant-missing-actions", children: [useApi] }),
		);
	}

	function render(): void {
		const ready = status?.ready === true;
		const busy = active.reply !== null;
		const chatting = view === "chat";
		missing.hidden = status === null || ready || !chatting;
		if (!missing.hidden) renderMissing();
		empty.hidden = !ready || active.messages.length > 0 || !chatting;
		log.hidden = active.messages.length === 0 || !chatting;
		history.hidden = view !== "history";
		settings.element.hidden = view !== "settings";
		composer.hidden = !chatting;
		input.disabled = !ready;
		addButton.disabled = !ready;
		for (const item of quick.querySelectorAll("button")) item.disabled = !ready || busy;
		log.classList.toggle("busy", busy);
		updateJump();
		sendButton.disabled = !ready && !busy;
		share.checked = host.shareDocument();
		subtitle.textContent = status === null ? t.assistantLooking : status.label;
		subtitle.title = status?.detail ?? "";
		settingsButton.setAttribute("aria-pressed", String(view === "settings"));
		historyButton.setAttribute("aria-pressed", String(view === "history"));
		sendButton.replaceChildren(icon(busy ? "stop" : "send"));
		sendButton.title = busy ? t.assistantStop : t.assistantSend;
		sendButton.setAttribute("aria-label", sendButton.title);
		sendButton.classList.toggle("busy", busy);
		newChat.disabled = active.messages.length === 0;
		modelSelect.hidden = !ready;
		if (ready && modelSelect.dataset.for !== `${status?.provider}\u0000${status?.model}`) {
			modelSelect.dataset.for = `${status?.provider}\u0000${status?.model}`;
			renderModels();
		}
	}

	async function setView(next: typeof view): Promise<void> {
		view = next;
		render();
		if (next === "settings") await settings.show();
		else if (next === "history") await renderHistory();
		else if (status?.ready === true) input.focus();
	}

	function refreshSelection(): void {
		const selection = host.selection().trim();
		if (droppedSelection !== null && droppedSelection.trim() !== selection) droppedSelection = null;
		const visible = selection !== "" && droppedSelection === null;
		selectionChip.hidden = !visible;
		context.hidden = !visible;
		if (!visible) return;
		const preview = selection.replace(/\s+/g, " ");
		selectionText.textContent = format(
			t.assistantSelection,
			preview.length > 40 ? `${preview.slice(0, 40)}…` : preview,
		);
		selectionChip.title = selection.slice(0, 1000);
	}

	// --- Chats ---------------------------------------------------------------------

	const dateFormat = new Intl.DateTimeFormat(host.lang, {
		dateStyle: "medium",
		timeStyle: "short",
	});

	async function renderHistory(): Promise<void> {
		let list: readonly ChatSummary[];
		try {
			list = await bridge.assistantChats();
		} catch (error) {
			history.replaceChildren(
				el("p", {
					class: "assistant-error",
					text: format(t.assistantActionFailed, host.errorText(error)),
				}),
			);
			return;
		}
		if (view !== "history") return;
		const start = button(t.assistantNewChat, { class: "assistant-primary", icon: "new" });
		start.addEventListener("click", () => startChat());
		const fold = (text: string): string => text.toLocaleLowerCase(host.lang);
		const search = el("input", {
			class: "assistant-history-search",
			attrs: {
				type: "search",
				placeholder: t.assistantSearchChats,
				"aria-label": t.assistantSearchChats,
				value: historyQuery,
			},
		});
		const results = el("div", { class: "assistant-history-results" });
		const filter = (): void => {
			historyQuery = search.value;
			const query = fold(search.value.trim());
			const shownRows = rows
				.filter(({ title }) => query === "" || fold(title).includes(query))
				.map(({ row }) => row);
			results.replaceChildren(
				list.length === 0
					? el("p", { class: "assistant-empty-hint", text: t.assistantNoChats })
					: shownRows.length === 0
						? el("p", {
								class: "assistant-empty-hint",
								text: format(t.assistantNoMatches, search.value.trim()),
							})
						: el("ul", { class: "assistant-history-list", children: shownRows }),
			);
		};
		search.addEventListener("input", filter);
		const rows = list.map((summary) => {
			const running = chats.get(summary.id)?.reply != null;
			const open = el("button", {
				class: "assistant-history-open",
				attrs: { type: "button", ...(summary.id === active.id ? { "aria-current": "true" } : {}) },
				children: [
					el("span", {
						class: "assistant-history-title",
						text: summary.title || t.assistantUntitledChat,
					}),
					el("span", {
						class: "assistant-history-meta",
						text: [
							dateFormat.format(summary.updated),
							providerLabel(t, summary.provider),
							format(t.assistantMessageCount, summary.count),
							...(running ? [t.assistantRunning] : []),
						].join(" · "),
					}),
				],
			});
			open.addEventListener("click", () => void openChat(summary.id));
			const remove = iconButton(
				"close",
				format(t.assistantDeleteChat, summary.title || t.assistantUntitledChat),
			);
			remove.addEventListener("click", () => void deleteChat(summary));
			return {
				title: summary.title || t.assistantUntitledChat,
				row: el("li", { class: "assistant-history-row", children: [open, remove] }),
			};
		});
		history.replaceChildren(
			el("div", {
				class: "assistant-history-header",
				children: [el("p", { class: "assistant-empty-title", text: t.assistantChats }), start],
			}),
			...(list.length > 0 ? [search] : []),
			results,
		);
		filter();
	}

	/** What the chat list was filtered by, kept while the panel is open. */
	let historyQuery = "";

	/** A new, empty chat; the current one stays in the list. */
	function startChat(): void {
		if (active.messages.length === 0 && active.reply === null) {
			active.provider = status?.provider ?? active.provider;
		} else {
			active = blankChat();
			chats.set(active.id, active);
		}
		void refreshRecent();
		showChat();
		void setView("chat");
	}

	function fromStored(stored: StoredChat): Chat {
		return {
			...stored,
			messages: stored.messages.map((message) => ({
				role: message.role,
				text: message.text,
				error: message.error,
				done: true,
				notes: message.notes,
				...(message.model === undefined ? {} : { model: message.model }),
			})),
			sources: [...(stored.sources ?? [])],
			skipped: [...(stored.skipped ?? [])],
			sharedText: null,
			reply: null,
			ended: null,
		};
	}

	async function openChat(id: string): Promise<void> {
		let chat = chats.get(id);
		if (chat === undefined) {
			const stored = await bridge.assistantChat(id);
			if (stored === null) return;
			chat = fromStored(stored);
			chats.set(id, chat);
		}
		// An empty chat left behind is not kept.
		if (active !== chat && active.messages.length === 0) chats.delete(active.id);
		active = chat;
		showChat();
		void setView("chat");
	}

	async function deleteChat(summary: ChatSummary): Promise<void> {
		if (
			!window.confirm(
				format(t.assistantDeleteChatConfirm, summary.title || t.assistantUntitledChat),
			)
		) {
			return;
		}
		const chat = chats.get(summary.id);
		if (chat?.reply != null) void bridge.assistantStop(chat.id);
		chats.delete(summary.id);
		await bridge.assistantDeleteChat(summary.id);
		if (active.id === summary.id) {
			active = blankChat();
			chats.set(active.id, active);
			showChat();
		}
		await renderHistory();
	}

	function save(chat: Chat): void {
		if (chat.messages.length === 0) return;
		const messages: StoredMessage[] = chat.messages.map(({ role, text, error, notes, model }) => ({
			role,
			text,
			error,
			notes,
			...(model === undefined || model === "" ? {} : { model }),
		}));
		const stored: StoredChat = {
			id: chat.id,
			title: chat.title,
			provider: chat.provider,
			sessionId: chat.sessionId,
			folder: chat.folder,
			created: chat.created,
			updated: chat.updated,
			messages,
			...(chat.sources.length === 0 ? {} : { sources: chat.sources }),
			...(chat.skipped.length === 0 ? {} : { skipped: chat.skipped }),
		};
		bridge.assistantSaveChat(stored).catch(() => {});
	}

	// --- Messages ------------------------------------------------------------------

	/** Shows the active chat from its messages. */
	function showChat(): void {
		shown.clear();
		log.replaceChildren();
		for (const message of active.messages) appendMessage(message);
		log.scrollTop = log.scrollHeight;
		renderSources();
		render();
	}

	function appendMessage(message: Message): void {
		const body = el("div", { class: "assistant-body" });
		const element = el("div", {
			class: `assistant-message assistant-${message.role}`,
			children: [
				...(message.notes.length === 0
					? []
					: [el("div", { class: "assistant-notes", text: message.notes.join(" · ") })]),
				body,
			],
		});
		shown.set(message, { element, body });
		log.append(element);
		if (message.role === "user") {
			body.textContent = message.text;
			element.append(questionTools(message));
		} else renderReply(message);
	}

	function toolButton(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement {
		const tool = iconButton(name, label);
		tool.classList.add("assistant-tool");
		return tool;
	}

	/** Under a question: copy it, or put it back in the input to change and ask again. */
	function questionTools(message: Message): HTMLElement {
		const copy = toolButton("copy", t.assistantCopy);
		copy.addEventListener("click", () => {
			void navigator.clipboard.writeText(message.text).then(() => flash(copy));
		});
		const edit = toolButton("pencil", t.assistantEditMessage);
		edit.addEventListener("click", () => {
			if (status?.ready !== true) return;
			input.value = message.text;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		});
		return el("div", { class: "assistant-message-tools", children: [copy, edit] });
	}

	/** A tool button shows a check for a moment once it has done its work. */
	function flash(tool: HTMLButtonElement): void {
		tool.replaceChildren(icon("check"));
		tool.classList.add("done");
		setTimeout(() => {
			tool.classList.remove("done");
			tool.replaceChildren(icon(tool.dataset.icon as Parameters<typeof icon>[0]));
		}, 1200);
	}

	let renderQueued: Message | null = null;
	function scheduleRender(message: Message): void {
		if (renderQueued === message) return;
		renderQueued = message;
		requestAnimationFrame(() => {
			renderQueued = null;
			renderReply(message);
		});
	}

	function nearBottom(): boolean {
		return log.scrollHeight - log.scrollTop - log.clientHeight < 60;
	}

	/** The button down to the latest message shows while the log is scrolled up. */
	function updateJump(): void {
		jump.hidden = log.hidden || view !== "chat" || nearBottom();
	}
	log.addEventListener("scroll", () => updateJump(), { passive: true });

	/** The start of a diagram or of actions still coming in: shown as a placeholder, not as JSON. */
	const OPEN_BLOCK =
		/^ {0,3}(?:`{3,}|~{3,})[ \t]*(kalem-diagram|kalem-actions|kalem-confluence|kalem-jira|kalem-tool)[ \t]*$/m;

	function renderReply(message: Message): void {
		const view = shown.get(message);
		if (view === undefined) return;
		const follow = nearBottom();
		// While a reply streams in, a finished diagram already shows; an open one is a placeholder.
		// Confluence look-ups show as steps, not as their requests.
		const shownText = withoutRequests(message.text);
		const parts: ReplyPart[] = shownText.trim() === "" ? [] : splitReply(shownText);
		let pending: string | null = null;
		const last = parts.at(-1);
		if (!message.done && last?.kind === "markdown") {
			const open = OPEN_BLOCK.exec(last.text);
			if (open !== null) {
				parts.pop();
				const before = last.text.slice(0, open.index);
				if (before.trim() !== "") parts.push({ kind: "markdown", text: before });
				pending =
					open[1] === "kalem-actions"
						? t.assistantPreparing
						: open[1] === "kalem-tool"
							? t.assistantThinking
							: open[1] === "kalem-confluence"
								? t.assistantConfluenceLooking
								: open[1] === "kalem-jira"
									? t.assistantJiraLooking
									: t.assistantDrawing;
			}
		}
		const nodes: Node[] = parts.map((part, index) =>
			part.kind === "markdown"
				? markdown(part.text, message.done)
				: part.kind === "diagram"
					? diagramCard(part)
					: actionsCard(part.actions, message, index),
		);
		const steps = stepsView(message);
		if (steps !== null) nodes.unshift(steps);
		if (message.plan !== undefined && message.plan.length > 0)
			nodes.unshift(planCard(t, message.plan));
		for (const proposed of message.edits ?? []) nodes.push(editCard(proposed));
		for (const request of message.approvals ?? []) {
			nodes.push(
				approvalCard(t, request, approvalStates.get(request.id) ?? "waiting", (answer) => {
					approvalStates.set(request.id, answer.approved ? "allowed" : "denied");
					void bridge.assistantApprove(request.id, answer);
					renderReply(message);
				}),
			);
		}
		for (const change of message.changes ?? []) {
			nodes.push(changeLine(t, change, () => void undoChange(message, change)));
		}
		if (!message.done && message.error === null) {
			const lastStep = message.steps?.at(-1);
			if (pending !== null) nodes.push(waiting(pending));
			else if (message.text === "" || (lastStep !== undefined && message.text.endsWith("\n\n")))
				nodes.push(waiting(lastStep ?? t.assistantThinking));
			else nodes.push(el("span", { class: "assistant-typing" }));
		}
		if (message.error !== null) {
			nodes.push(
				el("div", { class: "assistant-error", attrs: { role: "alert" }, text: message.error }),
			);
		}
		if (message.done && (message.text.trim() !== "" || message.error !== null)) {
			nodes.push(replyFooter(message, parts));
		}
		view.body.replaceChildren(...nodes);
		if (follow) log.scrollTop = log.scrollHeight;
		updateJump();
	}

	/** One look into the workspace, as the chat says it. */
	function stepLabel(tool: string, detail: string): string {
		// Kalem's own tools, as Claude Code calls them through its MCP server.
		switch (tool.replace(/^mcp__kalem__/, "")) {
			case "search":
			case "Grep":
				return format(t.assistantStepSearch, detail);
			case "read_file":
			case "Read":
				return format(t.assistantStepRead, detail);
			case "propose_edit":
				return format(t.assistantStepEdit, detail);
			case "confluence_search":
			case "confluence_search_content":
				return format(t.assistantStepConfluenceSearch, detail);
			case "confluence_search_title":
				return format(t.assistantStepConfluenceTitles, detail);
			case "confluence_read_page":
				return format(t.assistantStepConfluenceRead, detail);
			case "jira_get_issue":
				return format(t.assistantStepJiraIssue, detail);
			case "jira_search":
				return format(t.assistantStepJiraSearch, detail);
			case "kalem_help":
				return format(t.assistantStepHelp, detail);
			case "settings_find":
				return format(t.assistantStepSettingsFind, detail);
			case "settings_set":
			case "pane_move":
			case "pane_show":
				return detail === "" ? t.assistantStepSettings : format(t.assistantChanged, detail);
			case "app_command":
				return format(t.assistantStepCommand, detail);
			case "document_outline":
				return t.assistantStepOutline;
			case "document_read":
				return format(t.assistantStepDocumentRead, detail);
			case "document_search":
				return format(t.assistantStepDocumentSearch, detail);
			case "document_edit":
				return t.assistantStepDocumentEdit;
			case "list_files":
			case "Glob":
			case "LS":
				return detail === "" ? t.assistantStepListAll : format(t.assistantStepList, detail);
			default: {
				const name = tool.replace(/^mcp__kalem__/, "");
				return detail === "" ? name : `${name}: ${detail}`;
			}
		}
	}

	/** What became of each proposed change: applied, or set aside. */
	const editStates = new Map<
		string,
		{ kind: "applied" | "discarded" } | { kind: "failed"; text: string }
	>();

	/** A proposed change to a workspace file: what it takes out and puts in, applied on request. */
	function editCard(proposed: ProposedEdit): HTMLElement {
		const state = editStates.get(proposed.id);
		const diff = el("pre", { class: "assistant-edit-diff" });
		for (const line of lineDiff(proposed.oldText, proposed.newText)) {
			diff.append(
				el("span", {
					class: `assistant-diff-line diff-${line.kind === "+" ? "add" : line.kind === "-" ? "remove" : "keep"}`,
					text: `${line.kind} ${line.text}\n`,
				}),
			);
		}
		const status = el("p", { class: "assistant-edit-state", attrs: { role: "status" } });
		const actions = el("div", { class: "assistant-edit-actions" });
		if (state?.kind === "applied")
			status.textContent = format(t.assistantEditApplied, proposed.path);
		else if (state?.kind === "discarded") status.textContent = t.assistantEditDiscarded;
		else {
			if (state?.kind === "failed") {
				status.textContent = format(t.assistantEditFailed, state.text);
				status.classList.add("failed");
			}
			const apply = button(t.assistantEditApply, { class: "assistant-primary", icon: "check" });
			const discard = button(t.assistantEditDiscard, { icon: "close" });
			apply.addEventListener("click", async () => {
				apply.disabled = true;
				try {
					await bridge.assistantApplyEdit(proposed.id);
					editStates.set(proposed.id, { kind: "applied" });
				} catch (error) {
					editStates.set(proposed.id, { kind: "failed", text: host.errorText(error) });
				}
				card.replaceWith(editCard(proposed));
			});
			discard.addEventListener("click", () => {
				editStates.set(proposed.id, { kind: "discarded" });
				card.replaceWith(editCard(proposed));
			});
			actions.append(apply, discard);
		}
		const card = el("div", {
			class: `assistant-edit${state === undefined || state.kind === "failed" ? "" : ` ${state.kind}`}`,
			attrs: { "data-edit": proposed.id },
			children: [
				el("div", {
					class: "assistant-edit-head",
					children: [
						icon("pencil"),
						el("span", { class: "assistant-edit-path", text: proposed.path }),
						...(proposed.oldText === ""
							? [el("span", { class: "assistant-edit-new", text: t.assistantEditNew })]
							: []),
					],
				}),
				...(proposed.summary === ""
					? []
					: [el("p", { class: "assistant-edit-summary", text: proposed.summary })]),
				diff,
				status,
				actions,
			],
		});
		return card;
	}

	/** The looks into the workspace behind a reply, folded away once it is done. */
	function stepsView(message: Message): HTMLElement | null {
		const steps = message.steps ?? [];
		if (steps.length === 0) return null;
		const view = el("details", {
			class: "assistant-steps",
			children: [
				el("summary", { text: format(t.assistantSteps, steps.length) }),
				el("ol", { children: steps.map((step) => el("li", { text: step })) }),
			],
		});
		return view;
	}

	function waiting(label: string): HTMLElement {
		return el("div", {
			class: "assistant-waiting",
			children: [
				el("span", {
					class: "assistant-dots",
					attrs: { "aria-hidden": "true" },
					children: [el("span"), el("span"), el("span")],
				}),
				label,
			],
		});
	}

	function markdown(text: string, done: boolean): HTMLElement {
		const container = el("div", { class: "assistant-markdown" });
		// Without the document class: a reply is set in the panel's type, not the page's.
		renderToDOM(parse(text), container, { containerClass: false });
		if (done) {
			for (const code of container.querySelectorAll<HTMLElement>("pre > code.language-mermaid")) {
				void mermaidPreview(code);
			}
			for (const pre of container.querySelectorAll<HTMLElement>("pre")) {
				const copy = toolButton("copy", t.assistantCopyCode);
				copy.classList.add("assistant-code-copy");
				copy.addEventListener("click", () => {
					const code = pre.querySelector("code") ?? pre;
					void navigator.clipboard.writeText(code.textContent ?? "").then(() => flash(copy));
				});
				pre.append(copy);
			}
		}
		return container;
	}

	async function mermaidPreview(code: HTMLElement): Promise<void> {
		const outcome = await host.previews.get("mermaid", code.textContent ?? "");
		const pre = code.parentElement;
		if (!outcome.ok || pre === null) return;
		const image = el("img", {
			class: "assistant-preview",
			attrs: {
				alt: "",
				src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(outcome.value.image)}`,
			},
		});
		pre.after(image);
	}

	function run(action: HTMLButtonElement, work: () => Promise<void>, doneLabel?: string): void {
		action.addEventListener("click", async () => {
			const label = action.lastChild?.textContent ?? "";
			action.disabled = true;
			try {
				await work();
				if (doneLabel !== undefined && action.lastChild !== null) {
					action.lastChild.textContent = doneLabel;
					setTimeout(() => {
						if (action.lastChild !== null) action.lastChild.textContent = label;
					}, 1500);
				}
			} catch (error) {
				showNotice(format(t.assistantActionFailed, host.errorText(error)));
			} finally {
				action.disabled = false;
			}
		});
	}

	function diagramCard(part: ReplyDiagram & { source: string }): HTMLElement {
		const { svg } = diagramSvg(part.diagram);
		const title = part.title === "" ? t.diagramDefaultName : part.title;
		const insert = button(t.assistantInsertDiagram, { icon: "diagram" });
		run(insert, () => host.insertDiagram(part), t.assistantInserted);
		const edit = button(t.assistantOpenDiagram);
		edit.addEventListener("click", () => host.openDiagram(part));
		const actions: HTMLElement[] = [insert, edit];
		const src = part.src;
		if (src !== null && host.hasDiagram(src)) {
			const update = button(t.assistantUpdateDiagram);
			run(update, () => host.updateDiagram(src, part), t.assistantUpdated);
			actions.unshift(update);
		}
		return el("figure", {
			class: "assistant-diagram",
			children: [
				el("img", {
					attrs: {
						alt: title,
						src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(svg))}`,
					},
				}),
				el("figcaption", { text: title }),
				el("div", { class: "assistant-actions", children: actions }),
			],
		});
	}

	// --- Proposed changes ------------------------------------------------------------

	const strip = (label: string): string => label.replace(/…$/, "");
	const COMMAND_LABELS: Readonly<Record<AssistantCommand, string>> = {
		save: t.save,
		"save-as": t.saveAs,
		"save-as-package": t.saveAsPackage,
		"export-docx": exportLabel(t.exportDocx),
		"export-html": exportLabel(t.exportHtml),
		"export-confluence": exportLabel(t.exportConfluence),
		"export-confluence-wiki": exportLabel(t.exportConfluenceWiki),
		"version-history": t.versionHistory,
		find: t.find,
		replace: t.replace,
		image: t.image,
		"attach-file": t.attachFile,
		diagram: t.diagramInsert,
		table: t.insertTable,
		source: t.markdownSource,
		"read-only": t.readOnly,
		focus: t.focusMode,
		"zoom-in": t.zoomIn,
		"zoom-out": t.zoomOut,
		"zoom-reset": t.zoomReset,
		"quick-open": t.quickOpen,
		"search-folder": t.searchFolder,
		"format-all-code": t.formatAllCode,
		undo: t.undo,
		redo: t.redo,
	};

	/** The changes of each reply that were applied, by the card's place in the reply. */
	const applied = new WeakMap<Message, Set<number>>();

	const clipped = (text: string, max = 600): string =>
		text.length > max ? `${text.slice(0, max)}…` : text;

	function changeView(action: DocumentAction): HTMLElement {
		switch (action.type) {
			case "replace":
				return el("li", {
					class: "assistant-change",
					children: [
						...(action.all
							? [el("span", { class: "assistant-change-badge", text: t.assistantChangeAll })]
							: []),
						el("del", { text: clipped(action.find) }),
						...(action.replace === "" ? [] : [el("ins", { text: clipped(action.replace) })]),
					],
				});
			case "insert":
				return el("li", {
					class: "assistant-change",
					children: [
						el("span", {
							class: "assistant-change-label",
							text:
								action.at === "start"
									? t.assistantChangeInsertStart
									: action.at === "end"
										? t.assistantChangeInsertEnd
										: t.assistantChangeInsertCursor,
						}),
						el("ins", { text: clipped(action.text) }),
					],
				});
			case "document":
				return el("li", {
					class: "assistant-change",
					children: [
						el("span", { class: "assistant-change-label", text: t.assistantChangeDocument }),
						el("ins", { text: clipped(action.text, 400) }),
					],
				});
		}
	}

	function actionsCard(
		actions: readonly AssistantAction[],
		message: Message,
		index: number,
	): HTMLElement {
		const changes = actions.filter(isDocumentAction);
		const commandsToRun = actions.flatMap((action) =>
			action.type === "command" ? [action.command] : [],
		);
		const done = applied.get(message) ?? new Set<number>();
		applied.set(message, done);
		const children: HTMLElement[] = [];
		if (changes.length > 0) {
			const state = el("p", { class: "assistant-changes-state", attrs: { role: "status" } });
			const apply = button(t.assistantApply, {
				class: "assistant-primary assistant-apply",
				icon: "check",
			});
			const undo = button(t.assistantUndo, { icon: "undo" });
			const show = (isApplied: boolean, count?: number): void => {
				apply.disabled = isApplied;
				if (apply.lastChild !== null) {
					apply.lastChild.textContent = isApplied ? t.assistantApplied : t.assistantApply;
				}
				undo.hidden = !isApplied;
				state.hidden = count === undefined;
				state.textContent = count === undefined ? "" : format(t.assistantAppliedCount, count);
				card.classList.toggle("applied", isApplied);
			};
			apply.addEventListener("click", async () => {
				apply.disabled = true;
				try {
					const count = await host.applyActions(changes);
					done.add(index);
					show(true, count);
				} catch (error) {
					apply.disabled = false;
					showNotice(format(t.assistantActionFailed, host.errorText(error)));
				}
			});
			undo.addEventListener("click", () => {
				host.runCommand("undo");
				done.delete(index);
				show(false);
			});
			const card = el("div", {
				class: "assistant-changes-block",
				children: [
					el("div", {
						class: "assistant-changes-head",
						children: [icon("pencil"), el("span", { text: t.assistantChanges })],
					}),
					el("ul", { class: "assistant-change-list", children: changes.map(changeView) }),
					el("div", { class: "assistant-actions", children: [apply, undo] }),
					state,
				],
			});
			show(done.has(index));
			children.push(card);
		}
		for (const command of commandsToRun) {
			const label = strip(COMMAND_LABELS[command]);
			const go = button(t.assistantRun, { icon: "chevron", title: label });
			go.addEventListener("click", () => host.runCommand(command));
			children.push(
				el("div", {
					class: "assistant-command-row",
					children: [
						el("span", {
							class: "assistant-command-text",
							text: format(t.assistantChangeCommand, label),
						}),
						go,
					],
				}),
			);
		}
		return el("div", { class: "assistant-changes", children });
	}

	/** Applies the changes of the latest reply that proposes some (`/apply`). */
	function applyLatest(): void {
		const replies = [...log.querySelectorAll<HTMLButtonElement>(".assistant-apply")];
		const latest = replies.at(-1);
		if (latest === undefined) showNotice(t.assistantNothingToApply);
		else if (!latest.disabled) latest.click();
	}

	// --- Under a reply ---------------------------------------------------------------

	function replyFooter(message: Message, parts: readonly ReplyPart[]): HTMLElement {
		const buttons: HTMLElement[] = [];
		// Around proposed changes the text only explains them: there is nothing to insert.
		const proposes = parts.some((part) => part.kind === "actions");
		const insertable = parts.some(
			(part) => part.kind === "diagram" || (part.kind === "markdown" && !proposes),
		);
		if (message.error === null && insertable) {
			const insert = button(t.assistantInsert, { icon: "paste" });
			run(insert, () => host.insert(withoutRequests(message.text)), t.assistantInserted);
			buttons.push(insert);
		}
		if (message.text.trim() !== "") {
			const copy = button(t.assistantCopy, { icon: "copy" });
			run(
				copy,
				() => navigator.clipboard.writeText(withoutRequests(message.text).trim()),
				t.assistantCopied,
			);
			buttons.push(copy);
		}
		const again = toolButton(
			"refresh",
			message.error === null ? t.assistantRegenerate : t.assistantRetry,
		);
		again.classList.add("assistant-regenerate");
		again.addEventListener("click", () => regenerate(message));
		buttons.push(again);
		return el("div", {
			class: "assistant-reply-footer",
			children: [
				el("div", { class: "assistant-actions", children: buttons }),
				...(message.model !== undefined && message.model !== ""
					? [el("span", { class: "assistant-reply-model", text: message.model })]
					: []),
				...(message.usage === undefined
					? []
					: [
							el("span", {
								class: "assistant-reply-usage",
								text: usageText(t, host.lang, message.usage),
							}),
						]),
			],
		});
	}

	/** Asks the last question again in place of its reply. */
	function regenerate(message: Message): void {
		const chat = active;
		const count = chat.messages.length;
		const question = chat.messages[count - 2];
		if (chat.reply !== null || chat.messages[count - 1] !== message || question?.role !== "user") {
			return;
		}
		chat.messages.splice(count - 2, 2);
		for (const gone of [question, message]) {
			shown.get(gone)?.element.remove();
			shown.delete(gone);
		}
		// An API is sent the chat without the old answer; a CLI keeps its conversation.
		if (!isCli(PROVIDER_INFO[chat.provider])) chat.sessionId = null;
		input.value = question.text;
		void send();
	}

	function showNotice(text: string): void {
		log.append(el("div", { class: "assistant-error", attrs: { role: "alert" }, text }));
		log.hidden = false;
		log.scrollTop = log.scrollHeight;
	}

	// --- Asking --------------------------------------------------------------------

	bridge.onAssistantEvent((id, event: ClaudeEvent) => {
		const chat = chats.get(id);
		const reply = chat?.reply;
		if (chat === undefined || reply == null) return;
		switch (event.kind) {
			case "session":
				chat.sessionId = event.id;
				if (event.folder !== undefined) chat.folder = event.folder;
				return;
			case "text":
				reply.text += event.text;
				if (chat === active) scheduleRender(reply);
				return;
			case "error":
				reply.error = event.message;
				if (chat === active) scheduleRender(reply);
				chat.ended?.();
				return;
			case "reset":
				reply.text = "";
				reply.steps = [];
				reply.edits = [];
				if (chat === active) scheduleRender(reply);
				return;
			case "edit":
				reply.edits = [...(reply.edits ?? []), event.edit];
				if (chat === active) scheduleRender(reply);
				return;
			case "step":
				reply.steps = [...(reply.steps ?? []), stepLabel(event.tool, event.detail)];
				if (chat === active) scheduleRender(reply);
				return;
			case "plan":
				reply.plan = event.steps;
				if (chat === active) scheduleRender(reply);
				return;
			case "changed":
				reply.changes = [...(reply.changes ?? []), { label: event.label, settings: event.undo }];
				if (chat === active) scheduleRender(reply);
				return;
			case "usage": {
				const before = reply.usage ?? { input: 0, output: 0, cached: 0 };
				reply.usage = {
					input: before.input + event.input,
					output: before.output + event.output,
					cached: before.cached + event.cached,
				};
				return;
			}
			case "findings":
				onFindings(chat.id, reply, event.findings);
				return;
			case "done":
				chat.ended?.();
				return;
		}
	});

	/** A review's findings came: kept with the reply, shown in the review list. */
	function onFindings(_chatId: string, reply: Message, findings: readonly Finding[]): void {
		reply.findings = [...(reply.findings ?? []), ...findings];
		scheduleRender(reply);
	}

	/** What became of each question the user was asked. */
	const approvalStates = new Map<string, ApprovalState>();

	bridge.onAssistantApproval((request) => {
		const chat = chats.get(request.chatId);
		const reply = chat?.reply;
		if (chat === undefined || reply == null) {
			void bridge.assistantApprove(request.id, { approved: false, scope: "once" });
			return;
		}
		reply.approvals = [...(reply.approvals ?? []), request];
		if (chat === active) {
			scheduleRender(reply);
			if (!element.hidden) input.blur();
		}
		if (chat !== active || element.hidden) showNotice(t.approvalWaiting);
	});

	/** A tool's part that works on the window: a command, a change to the document. */
	bridge.onAssistantToolCall(async (call) => {
		const answer = (ok: boolean, text: string, document?: string): void => {
			void bridge.assistantToolResult(call.id, {
				ok,
				text,
				...(document === undefined ? {} : { document }),
			});
		};
		const input = (
			typeof call.input === "object" && call.input !== null ? call.input : {}
		) as Record<string, unknown>;
		try {
			if (call.name === "app_command" && typeof input.command === "string") {
				host.runCommand(input.command as Command);
				answer(true, "");
				return;
			}
			if (call.name === "document_edit" && Array.isArray(input.actions)) {
				const before = await host.context();
				if (typeof input.tabId === "string" && input.tabId !== before.tabId) {
					answer(false, "the user switched to another document; ask them to go back to it");
					return;
				}
				const made = await host.applyActions(input.actions as DocumentAction[]);
				const after = await host.context();
				const reply = chats.get(call.chatId)?.reply;
				if (reply != null) {
					reply.changes = [
						...(reply.changes ?? []),
						{
							label: format(t.approvalChanges, made),
							document: { tabId: before.tabId, text: before.text },
						},
					];
					scheduleRender(reply);
				}
				answer(true, `${made} changes`, after.text);
				return;
			}
			answer(false, `the window cannot run ${call.name}`);
		} catch (error) {
			answer(false, host.errorText(error));
		}
	});

	/** Puts back what the assistant changed. */
	async function undoChange(message: Message, change: MadeChange): Promise<void> {
		if (change.undone === true) return;
		try {
			if (change.settings !== undefined) host.changeSettings(change.settings as Partial<Settings>);
			if (change.document !== undefined) {
				const now = await host.context();
				if (now.tabId !== change.document.tabId) {
					showNotice(t.assistantUndoOtherTab);
					return;
				}
				await host.applyActions([{ type: "document", text: change.document.text }]);
			}
			change.undone = true;
			renderReply(message);
		} catch (error) {
			showNotice(format(t.assistantActionFailed, host.errorText(error)));
		}
	}

	async function send(): Promise<void> {
		const chat = active;
		const question = input.value.trim();
		if (question === "" || chat.reply !== null || status?.ready !== true) return;
		const provider = status.provider;
		// A chat picked up with another service goes on there as a new conversation.
		if (chat.provider !== provider) {
			chat.provider = provider;
			chat.sessionId = null;
			chat.folder = null;
			chat.sharedText = null;
		}
		const reply: Message = {
			role: "assistant",
			text: "",
			error: null,
			done: false,
			notes: [],
			model: status.model,
		};
		chat.reply = reply;
		input.value = "";
		render();

		const notes: string[] = [];
		let prompt: string;
		let tabId: string | null = null;
		let images: DocumentImage[] = [];
		let fullPrompt: string | undefined;
		let documentSnapshot:
			| { tabId: string; name: string; text: string; selection: string }
			| undefined;
		try {
			const context = await host.context();
			tabId = context.tabId;
			const selection = droppedSelection === null ? host.selection() : "";
			const sharing = host.shareDocument();
			const unchanged = sharing && chat.sessionId !== null && chat.sharedText === context.text;
			if (sharing) notes.push(format(t.assistantSharedDocument, context.name));
			if (selection.trim() !== "") notes.push(t.assistantSharedSelection);
			const sources = chatSources(chat);
			if (sources.length > 0) {
				notes.push(
					sources.length === 1
						? format(t.assistantSharedDocument, baseName(sources[0] as string))
						: format(t.assistantSharedSources, sources.length),
				);
			}
			// The pictures go with the document; an API, which keeps none, gets them every time.
			const cli = isCli(PROVIDER_INFO[provider]);
			if (sharing && (!unchanged || !cli)) images = await host.images();
			documentSnapshot = sharing
				? { tabId: context.tabId, name: context.name, text: context.text, selection }
				: undefined;
			// A long document goes as its outline: the model reads the parts it needs with the tools.
			if (sharing && !unchanged && context.text.length > LARGE_DOCUMENT) {
				fullPrompt = composePrompt({
					question,
					document: { name: context.name, text: context.text },
					diagrams: context.diagrams,
					images,
					selection,
				});
				notes[0] = format(
					t.assistantSharedDocument,
					format(t.assistantDocumentOutline, context.name),
				);
				prompt = composePrompt({
					question,
					outline: { name: context.name, text: outlineText(context.text) },
					diagrams: context.diagrams,
					selection,
				});
				images = [];
			} else
				prompt = composePrompt({
					question,
					...(sharing && !unchanged
						? {
								document: { name: context.name, text: context.text },
								diagrams: context.diagrams,
								images,
							}
						: {}),
					documentUnchanged: unchanged,
					selection,
				});
			if (sharing) chat.sharedText = context.text;
		} catch (error) {
			chat.reply = null;
			input.value = question;
			render();
			showNotice(format(t.assistantActionFailed, host.errorText(error)));
			return;
		}

		// What an API is sent again when this run has not seen the chat (picked up from disk).
		const earlier = isCli(PROVIDER_INFO[provider]) ? [] : historyOf(chat.messages);
		const asked: Message = { role: "user", text: question, error: null, done: true, notes };
		chat.messages.push(asked, reply);
		if (chat.title === "") chat.title = chatTitle(question);
		chat.updated = Date.now();
		if (chat === active) {
			appendMessage(asked);
			appendMessage(reply);
			log.scrollTop = log.scrollHeight;
			render();
		}
		// The reply's events and the request's own answer travel separately and
		// may arrive in either order: the reply has ended with its last event.
		const ask = async (session: string | null): Promise<void> => {
			const last = new Promise<void>((resolve) => {
				chat.ended = resolve;
			});
			try {
				await bridge.assistantAsk({
					chatId: chat.id,
					prompt,
					sessionId: session,
					tabId,
					folder: chat.folder,
					history: earlier,
					images: images.map(({ label, mediaType, data }) => ({ label, mediaType, data })),
					sources: chatSources(chat),
					mode,
					...(fullPrompt === undefined ? {} : { fullPrompt }),
					...(documentSnapshot === undefined ? {} : { document: documentSnapshot }),
				});
				await Promise.race([last, new Promise((resolve) => setTimeout(resolve, 5000))]);
			} catch (error) {
				reply.error = host.errorText(error);
			} finally {
				chat.ended = null;
			}
		};
		await ask(chat.sessionId);
		// A conversation the CLI no longer has (cleared, or another computer): start again.
		if (reply.text === "" && reply.error !== null && /no conversation found/i.test(reply.error)) {
			chat.sessionId = null;
			reply.error = null;
			await ask(null);
		}
		chat.reply = null;
		reply.done = true;
		chat.updated = Date.now();
		save(chat);
		if (chat === active) {
			renderReply(reply);
			render();
			input.focus();
		}
		if (view === "history") void renderHistory();
	}

	/** The most recent chat comes back when the panel first shows. */
	async function restore(): Promise<void> {
		restored = true;
		void refreshRecent();
		const [latest] = await bridge.assistantChats().catch(() => []);
		if (latest !== undefined && active.messages.length === 0) await openChat(latest.id);
	}

	renderEmpty();
	render();

	return {
		element,
		show() {
			showWidth(fit(host.width()));
			render();
			refreshSelection();
			if (!restored) void restore();
			if (status !== null) return;
			void bridge.assistantStatus().then((found) => {
				status = found;
				if (active.messages.length === 0) active.provider = found.provider;
				render();
			});
		},
		focus() {
			if (view !== "chat") void setView("chat");
			input.focus();
		},
		refreshSelection,
		workspaceChanged: () => renderSources(),
		configured,
	};
}
