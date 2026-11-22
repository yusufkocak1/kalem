import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface SelectionAssistantOptions {
	readonly t: Strings;
	/** Asks the assistant, with the document's selection as it is asked from its panel. */
	ask(prompt: string): void;
}

export interface SelectionAssistant {
	/** Adds the assistant's button to an editor's selection bubble. */
	decorate(bubble: HTMLElement): void;
	/** The small box under the caret where a request is typed (Ctrl+J). */
	prompt(): void;
}

/** A point to open under: the selection's, or the caret's line when nothing is selected. */
function caretBox(): DOMRect | null {
	const selection = document.getSelection();
	if (selection === null || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	const box = range.getBoundingClientRect();
	if (box.width > 0 || box.height > 0) return box;
	// An empty line has no box of its own: its block has.
	const node = range.startContainer;
	const element = node instanceof Element ? node : node.parentElement;
	return element?.getBoundingClientRect() ?? null;
}

function placeUnder(element: HTMLElement, box: DOMRect | null): void {
	const width = element.offsetWidth;
	const left = box === null ? (window.innerWidth - width) / 2 : box.left;
	const top = box === null ? window.innerHeight / 3 : box.bottom + 8;
	element.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
	element.style.top = `${Math.min(top, window.innerHeight - element.offsetHeight - 8)}px`;
}

/**
 * The assistant where the text is: a button in the selection's bubble that
 * opens what the assistant's panel offers for a selection (improve, shorten,
 * fix, translate, explain) and a box for one's own request, which Ctrl+J
 * opens under the caret too. What it changes comes back into the document,
 * to accept or reject there, as from the panel.
 */
export function createSelectionAssistant(options: SelectionAssistantOptions): SelectionAssistant {
	const { t } = options;

	// --- The bubble's menu ------------------------------------------------------
	const menu = el("div", {
		class: "selection-ai-menu",
		attrs: { role: "menu", "aria-label": t.selectionAssistant, hidden: "" },
	});
	document.body.append(menu);
	const actions: readonly [label: string, prompt: string, glyph: IconName][] = [
		[t.assistantQuickImprove, t.assistantPromptImprove, "wand"],
		[t.assistantQuickShorten, t.assistantPromptShorten, "outdent"],
		[t.assistantQuickFix, t.assistantPromptFix, "check"],
		[t.assistantQuickTranslate, t.assistantPromptTranslate, "replace"],
		[t.assistantQuickExplain, t.assistantPromptExplain, "chats"],
	];
	const item = (label: string, glyph: IconName, run: () => void, extra = ""): HTMLButtonElement => {
		const button = el("button", {
			class: "selection-ai-item",
			attrs: { type: "button", role: "menuitem" },
			children: [
				icon(glyph),
				el("span", { text: label }),
				...(extra === "" ? [] : [el("kbd", { text: extra })]),
			],
		});
		// The document's selection stays: it is what is asked about.
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", () => {
			closeMenu();
			run();
		});
		return button;
	};
	menu.append(
		...actions.map(([label, text, glyph]) => item(label, glyph, () => options.ask(text))),
		el("div", { class: "selection-ai-separator", attrs: { role: "separator" } }),
		item(t.selectionAssistantOwn, "pencil", () => prompt(), "Ctrl+J"),
	);
	let menuButton: HTMLButtonElement | null = null;

	function closeMenu(): void {
		if (menu.hidden) return;
		menu.hidden = true;
		menuButton?.setAttribute("aria-expanded", "false");
		menuButton = null;
	}

	function openMenu(button: HTMLButtonElement): void {
		menuButton = button;
		menu.hidden = false;
		button.setAttribute("aria-expanded", "true");
		const bubble = button.closest<HTMLElement>(".kalem-bubble") ?? button;
		placeUnder(menu, bubble.getBoundingClientRect());
	}

	document.addEventListener(
		"mousedown",
		(event) => {
			const target = event.target as Node;
			if (!menu.hidden && !menu.contains(target) && menuButton?.contains(target) !== true)
				closeMenu();
			if (!box.hidden && !box.contains(target)) closeBox(false);
		},
		true,
	);
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !menu.hidden) closeMenu();
	});
	window.addEventListener("resize", closeMenu);
	document.addEventListener("scroll", closeMenu, { capture: true, passive: true });

	function decorate(bubble: HTMLElement): void {
		if (bubble.querySelector(".bubble-assistant") !== null) return;
		const button = el("button", {
			class: "kalem-bubble-button bubble-assistant",
			attrs: {
				type: "button",
				title: t.selectionAssistant,
				"aria-label": t.selectionAssistant,
				"aria-haspopup": "menu",
				"aria-expanded": "false",
			},
			children: [
				icon("assistant"),
				el("span", { class: "bubble-assistant-label", text: t.assistantTitle }),
			],
		});
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", () =>
			menuButton === button ? closeMenu() : openMenu(button),
		);
		bubble.append(
			el("span", { class: "bubble-assistant-separator", attrs: { role: "presentation" } }),
			button,
		);
	}

	// --- The request box (Ctrl+J) ---------------------------------------------
	const input = el("input", {
		class: "selection-ai-input",
		attrs: {
			type: "text",
			placeholder: t.selectionAssistantPlaceholder,
			"aria-label": t.selectionAssistant,
		},
	});
	const box = el("div", {
		class: "selection-ai-prompt",
		attrs: { role: "dialog", "aria-label": t.selectionAssistant, hidden: "" },
		children: [
			el("span", {
				class: "selection-ai-glyph",
				attrs: { "aria-hidden": "true" },
				children: [icon("assistant")],
			}),
			input,
			el("span", { class: "selection-ai-hint", text: t.selectionAssistantHint }),
		],
	});
	document.body.append(box);
	/** The document's selection when the box opened: back to it when the box closes. */
	let kept: Range | null = null;

	function closeBox(restore: boolean): void {
		if (box.hidden) return;
		box.hidden = true;
		const range = kept;
		kept = null;
		if (!restore || range === null) return;
		const editable = (
			range.startContainer instanceof Element
				? range.startContainer
				: range.startContainer.parentElement
		)?.closest<HTMLElement>("[contenteditable='true']");
		editable?.focus();
		const selection = document.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	function prompt(): void {
		const selection = document.getSelection();
		kept =
			selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
		const at = caretBox();
		input.value = "";
		box.hidden = false;
		placeUnder(box, at);
		input.focus();
	}

	input.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			closeBox(true);
		} else if (event.key === "Enter" && input.value.trim() !== "") {
			event.preventDefault();
			const text = input.value.trim();
			closeBox(true);
			options.ask(text);
		}
	});

	return { decorate, prompt };
}
