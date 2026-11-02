import { parse } from "@kalem-editor/core";
import { renderToDOM } from "@kalem-editor/viewer";
import type { AssistantStatus, Command, KalemBridge } from "../shared/bridge.js";
import { clampAssistantWidth, DEFAULT_SETTINGS, MIN_ASSISTANT_WIDTH } from "../shared/bridge.js";
import type { ChatSummary, StoredChat, StoredMessage } from "../shared/chats.js";
import { chatTitle, historyOf } from "../shared/chats.js";
import type { ClaudeEvent, ContextDiagram, ReplyDiagram, ReplyPart } from "../shared/claude.js";
import { composePrompt, splitReply } from "../shared/claude.js";
import { diagramSvg, svgMarkup } from "../shared/diagram.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { ProviderId } from "../shared/providers.js";
import { isCli, PROVIDER_INFO, providerLabel, SUGGESTED_MODELS } from "../shared/providers.js";
import type { SlashEntry } from "../shared/slash.js";
import { findSlash, matchSlash, slashQuery } from "../shared/slash.js";
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
	/** The folders opened with Open Folder. */
	workspaceFolders(): readonly string[];
	/** Puts a reply's Markdown at the caret, its Kalem diagrams as pictures. */
	insert(text: string): Promise<void>;
	insertDiagram(diagram: ReplyDiagram): Promise<void>;
	openDiagram(diagram: ReplyDiagram): void;
	/** Whether the document shows the diagram picture at `src`. */
	hasDiagram(src: string): boolean;
	updateDiagram(src: string, diagram: ReplyDiagram): Promise<void>;
	openLink(href: string): void;
	/** Runs one of the app's commands (save, export, insert a table…) on the active document. */
	runCommand(command: Command): void;
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
}

interface Message {
	readonly role: "user" | "assistant";
	text: string;
	error: string | null;
	done: boolean;
	readonly notes: readonly string[];
	/** The model that answered; empty when the service chose. */
	readonly model?: string;
}

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
		attrs: { type: "button", title: label, "aria-label": label },
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
			if (next !== null) status = next;
			// Another service does not know what was said so far: it gets a chat of its own.
			if (changed && active.messages.length > 0) startChat();
			else if (changed) active.provider = status?.provider ?? active.provider;
			void setView("chat");
		},
	});

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
			...host
				.workspaceFolders()
				.filter((folder) => !active.sources.includes(folder))
				.map((folder) =>
					menuItem(format(t.assistantAddWorkspace, baseName(folder)), "open", () =>
						addSources([folder]),
					),
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

	function renderSources(): void {
		sourceList.hidden = active.sources.length === 0;
		sourceList.replaceChildren(
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
	const composer = el("div", {
		class: "assistant-composer",
		children: [
			el("div", {
				class: "assistant-context",
				children: [
					addButton,
					el("label", { class: "assistant-share", children: [share, t.assistantShareDocument] }),
					modelSelect,
					selectionChip,
				],
			}),
			sourceList,
			el("div", { class: "assistant-input-row", children: [input, sendButton] }),
			menu,
			addMenu,
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
		const suggestions = [
			t.assistantSuggestSummary,
			t.assistantSuggestDiagram,
			t.assistantSuggestImprove,
			t.assistantSuggestTable,
		].map((text) => {
			const suggestion = el("button", {
				class: "assistant-suggestion",
				text,
				attrs: { type: "button" },
			});
			suggestion.addEventListener("click", () => {
				input.value = text;
				void send();
			});
			return suggestion;
		});
		empty.replaceChildren(
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
			return el("li", { class: "assistant-history-row", children: [open, remove] });
		});
		history.replaceChildren(
			el("div", {
				class: "assistant-history-header",
				children: [el("p", { class: "assistant-empty-title", text: t.assistantChats }), start],
			}),
			rows.length === 0
				? el("p", { class: "assistant-empty-hint", text: t.assistantNoChats })
				: el("ul", { class: "assistant-history-list", children: rows }),
		);
	}

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
		if (message.role === "user") body.textContent = message.text;
		else renderReply(message);
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

	function renderReply(message: Message): void {
		const view = shown.get(message);
		if (view === undefined) return;
		const follow = nearBottom();
		// While a reply streams in, a finished diagram already shows; an open one is still text.
		const parts: ReplyPart[] = message.text === "" ? [] : splitReply(message.text);
		const nodes: Node[] = parts.map((part) =>
			part.kind === "markdown" ? markdown(part.text, message.done) : diagramCard(part),
		);
		if (!message.done && message.error === null)
			nodes.push(el("span", { class: "assistant-typing" }));
		if (message.error !== null) {
			nodes.push(
				el("div", { class: "assistant-error", attrs: { role: "alert" }, text: message.error }),
			);
		}
		if (message.done && message.error === null && message.text.trim() !== "") {
			nodes.push(replyActions(message));
		}
		if (message.model !== undefined && message.model !== "") {
			nodes.push(el("div", { class: "assistant-reply-model", text: message.model }));
		}
		view.body.replaceChildren(...nodes);
		if (follow) log.scrollTop = log.scrollHeight;
	}

	function markdown(text: string, done: boolean): HTMLElement {
		const container = el("div", { class: "assistant-markdown" });
		// Without the document class: a reply is set in the panel's type, not the page's.
		renderToDOM(parse(text), container, { containerClass: false });
		if (done) {
			for (const code of container.querySelectorAll<HTMLElement>("pre > code.language-mermaid")) {
				void mermaidPreview(code);
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

	function replyActions(message: Message): HTMLElement {
		const insert = button(t.assistantInsert, { icon: "paste" });
		run(insert, () => host.insert(message.text), t.assistantInserted);
		const copy = button(t.assistantCopy, { icon: "copy" });
		run(copy, () => navigator.clipboard.writeText(message.text), t.assistantCopied);
		return el("div", { class: "assistant-actions", children: [insert, copy] });
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
			case "done":
				chat.ended?.();
				return;
		}
	});

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
		try {
			const context = await host.context();
			tabId = context.tabId;
			const selection = droppedSelection === null ? host.selection() : "";
			const sharing = host.shareDocument();
			const unchanged = sharing && chat.sessionId !== null && chat.sharedText === context.text;
			if (sharing) notes.push(format(t.assistantSharedDocument, context.name));
			if (selection.trim() !== "") notes.push(t.assistantSharedSelection);
			if (chat.sources.length > 0) {
				notes.push(
					chat.sources.length === 1
						? format(t.assistantSharedDocument, baseName(chat.sources[0] as string))
						: format(t.assistantSharedSources, chat.sources.length),
				);
			}
			// The pictures go with the document; an API, which keeps none, gets them every time.
			const cli = isCli(PROVIDER_INFO[provider]);
			if (sharing && (!unchanged || !cli)) images = await host.images();
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
					sources: chat.sources,
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
	};
}
