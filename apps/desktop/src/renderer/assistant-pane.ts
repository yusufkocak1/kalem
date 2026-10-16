import { parse } from "@kalem-editor/core";
import { renderToDOM } from "@kalem-editor/viewer";
import type { AssistantStatus, KalemBridge } from "../shared/bridge.js";
import { clampAssistantWidth, DEFAULT_SETTINGS, MIN_ASSISTANT_WIDTH } from "../shared/bridge.js";
import type { ChatSummary, StoredChat, StoredMessage } from "../shared/chats.js";
import { chatTitle, historyOf } from "../shared/chats.js";
import type { ClaudeEvent, ContextDiagram, ReplyDiagram, ReplyPart } from "../shared/claude.js";
import { composePrompt, splitReply } from "../shared/claude.js";
import { diagramSvg, svgMarkup } from "../shared/diagram.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { ProviderId } from "../shared/providers.js";
import { isCli, PROVIDER_INFO, providerLabel } from "../shared/providers.js";
import { createAssistantSettings } from "./assistant-settings.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";
import type { Previews } from "./previews.js";

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
	/** The text last selected in the document; empty when none. */
	selection(): string;
	/** Puts a reply's Markdown at the caret, its Kalem diagrams as pictures. */
	insert(text: string): Promise<void>;
	insertDiagram(diagram: ReplyDiagram): Promise<void>;
	openDiagram(diagram: ReplyDiagram): void;
	/** Whether the document shows the diagram picture at `src`. */
	hasDiagram(src: string): boolean;
	updateDiagram(src: string, diagram: ReplyDiagram): Promise<void>;
	openLink(href: string): void;
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

	const input = el("textarea", {
		class: "assistant-input",
		attrs: { rows: "1", placeholder: t.assistantPlaceholder, "aria-label": t.assistantPlaceholder },
	});
	const sendButton = el("button", {
		class: "assistant-send",
		attrs: { type: "button", title: t.assistantSend, "aria-label": t.assistantSend },
		children: [icon("send")],
	});
	const composer = el("div", {
		class: "assistant-composer",
		children: [
			el("div", {
				class: "assistant-context",
				children: [
					el("label", { class: "assistant-share", children: [share, t.assistantShareDocument] }),
					selectionChip,
				],
			}),
			el("div", { class: "assistant-input-row", children: [input, sendButton] }),
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

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void send();
		} else if (event.key === "Escape" && active.reply !== null) {
			event.preventDefault();
			void bridge.assistantStop(active.id);
		}
	});
	sendButton.addEventListener("click", () => {
		if (active.reply !== null) void bridge.assistantStop(active.id);
		else void send();
	});

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
		);
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
			})),
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
		const messages: StoredMessage[] = chat.messages.map(({ role, text, error, notes }) => ({
			role,
			text,
			error,
			notes,
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
		const reply: Message = { role: "assistant", text: "", error: null, done: false, notes: [] };
		chat.reply = reply;
		input.value = "";
		render();

		const notes: string[] = [];
		let prompt: string;
		let tabId: string | null = null;
		try {
			const context = await host.context();
			tabId = context.tabId;
			const selection = droppedSelection === null ? host.selection() : "";
			const sharing = host.shareDocument();
			const unchanged = sharing && chat.sessionId !== null && chat.sharedText === context.text;
			if (sharing) notes.push(format(t.assistantSharedDocument, context.name));
			if (selection.trim() !== "") notes.push(t.assistantSharedSelection);
			prompt = composePrompt({
				question,
				...(sharing && !unchanged
					? { document: { name: context.name, text: context.text }, diagrams: context.diagrams }
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
