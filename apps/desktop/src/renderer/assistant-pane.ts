import { parse } from "@kalem-editor/core";
import { renderToDOM } from "@kalem-editor/viewer";
import type { AssistantStatus, KalemBridge } from "../shared/bridge.js";
import type { ClaudeEvent, ContextDiagram, ReplyDiagram, ReplyPart } from "../shared/claude.js";
import { composePrompt, splitReply } from "../shared/claude.js";
import { diagramSvg, svgMarkup } from "../shared/diagram.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
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
	readonly bridge: KalemBridge;
	readonly previews: Previews;
	shareDocument(): boolean;
	setShareDocument(share: boolean): void;
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
	/** Looks for Claude when shown for the first time. */
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
	readonly element: HTMLElement;
	readonly body: HTMLElement;
}

const INSTALL_URL = "https://docs.anthropic.com/en/docs/claude-code/setup";

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

export function createAssistantPane(host: AssistantHost): AssistantPane {
	const { t, bridge } = host;

	let status: AssistantStatus | null = null;
	let chatId = crypto.randomUUID();
	let sessionId: string | null = null;
	/** The document text Claude was last given in this chat. */
	let sharedText: string | null = null;
	let busy = false;
	let messages: Message[] = [];
	/** A selection the user took off the next question. */
	let droppedSelection: string | null = null;

	// --- Shell ---------------------------------------------------------------

	const subtitle = el("span", { class: "assistant-subtitle" });
	const newChat = el("button", {
		class: "icon-button",
		attrs: { type: "button", title: t.assistantNewChat, "aria-label": t.assistantNewChat },
		children: [icon("new")],
	});
	const close = el("button", {
		class: "icon-button",
		attrs: { type: "button", title: t.assistantClose, "aria-label": t.assistantClose },
		children: [icon("close")],
	});
	const settingsButton = el("button", {
		class: "icon-button",
		attrs: { type: "button", title: t.assistantSettings, "aria-label": t.assistantSettings },
		children: [icon("settings")],
	});
	settingsButton.addEventListener("click", () => {
		if (settings.element.hidden) void openSettings();
		else closeSettings();
	});
	close.addEventListener("click", () => host.close());
	newChat.addEventListener("click", () => reset());

	const log = el("div", {
		class: "assistant-log",
		attrs: { role: "log", "aria-live": "polite", "aria-label": t.assistantConversation },
	});
	const empty = el("div", { class: "assistant-empty" });
	const missing = el("div", { class: "assistant-missing", attrs: { hidden: "" } });
	const settings = createAssistantSettings({
		t,
		bridge,
		openLink: (href) => host.openLink(href),
		errorText: host.errorText,
		done(next, changed) {
			if (next !== null) status = next;
			// Another service does not know what was said so far.
			if (changed) reset();
			closeSettings();
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

	const element = el("aside", {
		class: "assistant kalem-theme",
		attrs: { id: "assistant-pane", "aria-label": t.assistantPane },
		children: [
			el("div", {
				class: "assistant-header",
				children: [
					el("div", {
						class: "assistant-title",
						children: [icon("assistant"), el("h2", { text: t.assistantTitle }), subtitle],
					}),
					el("div", {
						class: "assistant-header-actions",
						children: [newChat, settingsButton, close],
					}),
				],
			}),
			log,
			empty,
			missing,
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
		} else if (event.key === "Escape" && busy) {
			event.preventDefault();
			void stop();
		}
	});
	sendButton.addEventListener("click", () => {
		if (busy) void stop();
		else void send();
	});

	// --- Empty and not-found states ----------------------------------------------

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
		setUp.addEventListener("click", () => void openSettings());
		if (status?.missing === "setup") {
			missing.replaceChildren(
				el("p", { class: "assistant-empty-title", text: t.assistantSetupTitle }),
				el("p", { class: "assistant-empty-hint", text: t.assistantSetupHint }),
				el("div", { class: "assistant-missing-actions", children: [setUp] }),
			);
			return;
		}
		const install = button(t.assistantInstall, { class: "assistant-link" });
		install.addEventListener("click", () => host.openLink(INSTALL_URL));
		const locate = button(t.assistantLocate);
		locate.addEventListener("click", async () => {
			status = await bridge.claudeLocate();
			renderState();
		});
		const retry = button(t.assistantRetry);
		retry.addEventListener("click", async () => {
			retry.disabled = true;
			status = await bridge.assistantStatus(true);
			retry.disabled = false;
			renderState();
		});
		const useApi = button(t.assistantUseApi);
		useApi.addEventListener("click", () => void openSettings());
		missing.replaceChildren(
			el("p", { class: "assistant-empty-title", text: t.assistantMissing }),
			el("p", { class: "assistant-empty-hint", text: t.assistantMissingHint }),
			el("code", { class: "assistant-command", text: "npm install -g @anthropic-ai/claude-code" }),
			el("p", { class: "assistant-empty-hint", text: t.assistantMissingLogin }),
			el("div", { class: "assistant-missing-actions", children: [install, locate, retry] }),
			el("p", { class: "assistant-empty-hint", text: t.assistantOrApi }),
			el("div", { class: "assistant-missing-actions", children: [useApi] }),
		);
	}

	function renderState(): void {
		const ready = status?.ready === true;
		const editing = !settings.element.hidden;
		missing.hidden = status === null || ready || editing;
		if (!missing.hidden) renderMissing();
		empty.hidden = !ready || messages.length > 0 || editing;
		log.hidden = messages.length === 0 || editing;
		composer.hidden = editing;
		input.disabled = !ready;
		sendButton.disabled = !ready && !busy;
		share.checked = host.shareDocument();
		subtitle.textContent = status === null ? t.assistantLooking : status.label;
		subtitle.title = status?.detail ?? "";
		settingsButton.setAttribute("aria-pressed", String(editing));
		sendButton.replaceChildren(icon(busy ? "stop" : "send"));
		sendButton.title = busy ? t.assistantStop : t.assistantSend;
		sendButton.setAttribute("aria-label", sendButton.title);
		sendButton.classList.toggle("busy", busy);
		newChat.disabled = messages.length === 0;
	}

	async function openSettings(): Promise<void> {
		settings.element.hidden = false;
		renderState();
		await settings.show();
	}

	function closeSettings(): void {
		settings.element.hidden = true;
		renderState();
		if (status?.ready === true) input.focus();
	}

	function refreshSelection(): void {
		const selection = host.selection().trim();
		if (droppedSelection !== null && droppedSelection.trim() !== selection) droppedSelection = null;
		const shown = selection !== "" && droppedSelection === null;
		selectionChip.hidden = !shown;
		if (!shown) return;
		const preview = selection.replace(/\s+/g, " ");
		selectionText.textContent = format(
			t.assistantSelection,
			preview.length > 40 ? `${preview.slice(0, 40)}…` : preview,
		);
		selectionChip.title = selection.slice(0, 1000);
	}

	// --- Messages ------------------------------------------------------------------

	function addMessage(role: Message["role"], text: string, notes: readonly string[] = []): Message {
		const body = el("div", { class: "assistant-body" });
		const element = el("div", {
			class: `assistant-message assistant-${role}`,
			children: [
				...(notes.length === 0
					? []
					: [el("div", { class: "assistant-notes", text: notes.join(" · ") })]),
				body,
			],
		});
		const message: Message = { role, text, error: null, done: role === "user", element, body };
		messages.push(message);
		log.append(element);
		if (role === "user") body.textContent = text;
		renderState();
		return message;
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
		message.body.replaceChildren(...nodes);
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

	let current: Message | null = null;
	/** Called when the reply in progress has ended (its last event, not the request, says so). */
	let ended: (() => void) | null = null;

	bridge.onAssistantEvent((id, event: ClaudeEvent) => {
		if (id !== chatId || current === null) return;
		const message = current;
		switch (event.kind) {
			case "session":
				sessionId = event.id;
				return;
			case "text":
				message.text += event.text;
				scheduleRender(message);
				return;
			case "error":
				message.error = event.message;
				scheduleRender(message);
				ended?.();
				return;
			case "done":
				ended?.();
				return;
		}
	});

	async function send(): Promise<void> {
		const question = input.value.trim();
		if (question === "" || busy || status?.ready !== true) return;
		busy = true;
		input.value = "";
		renderState();

		const notes: string[] = [];
		let prompt: string;
		let tabId: string | null = null;
		try {
			const context = await host.context();
			tabId = context.tabId;
			const selection = droppedSelection === null ? host.selection() : "";
			const sharing = host.shareDocument();
			const unchanged = sharing && sessionId !== null && sharedText === context.text;
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
			if (sharing) sharedText = context.text;
		} catch (error) {
			busy = false;
			input.value = question;
			renderState();
			showNotice(format(t.assistantActionFailed, host.errorText(error)));
			return;
		}

		addMessage("user", question, notes);
		const reply = addMessage("assistant", "");
		current = reply;
		renderReply(reply);
		// The reply's events and the request's own answer travel separately and
		// may arrive in either order: the reply has ended with its last event.
		const ask = async (session: string | null): Promise<void> => {
			const last = new Promise<void>((resolve) => {
				ended = resolve;
			});
			try {
				await bridge.assistantAsk({ chatId, prompt, sessionId: session, tabId });
				await Promise.race([last, new Promise((resolve) => setTimeout(resolve, 5000))]);
			} catch (error) {
				reply.error = host.errorText(error);
			} finally {
				ended = null;
			}
		};
		await ask(sessionId);
		// A conversation Claude Code no longer has (cleared, or another computer): start again.
		if (reply.text === "" && reply.error !== null && /no conversation found/i.test(reply.error)) {
			sessionId = null;
			reply.error = null;
			await ask(null);
		}
		if (current === reply) current = null;
		reply.done = true;
		busy = false;
		renderReply(reply);
		renderState();
		input.focus();
	}

	async function stop(): Promise<void> {
		await bridge.assistantStop(chatId);
	}

	function reset(): void {
		if (busy) void bridge.assistantStop(chatId);
		chatId = crypto.randomUUID();
		sessionId = null;
		sharedText = null;
		current = null;
		busy = false;
		messages = [];
		log.replaceChildren();
		renderState();
		input.focus();
	}

	renderEmpty();
	renderState();

	return {
		element,
		show() {
			renderState();
			refreshSelection();
			if (status !== null) return;
			void bridge.assistantStatus().then((found) => {
				status = found;
				renderState();
			});
		},
		focus() {
			input.focus();
		},
		refreshSelection,
	};
}
