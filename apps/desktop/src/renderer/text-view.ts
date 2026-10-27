/**
 * A text file that is not Markdown (.txt, .java, .json, .xml…), shown in a
 * tab as plain text: a text box with line numbers, find, line wrap and, for
 * JSON, XML, HTML and YAML, formatting. The text is never read as Markdown:
 * what is typed is what is saved.
 */
import { beautify, detectLanguage } from "../shared/beautify.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { extension } from "../shared/paths.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface TextViewOptions {
	readonly t: Strings;
	/** Folds case in find. */
	readonly lang: string;
	readonly text: string;
	/** The file's path: its extension tells the formatter what the text is. */
	readonly path: string;
	/** The text was edited. */
	onChange(): void;
	/** The caret moved; for the status bar. */
	onCaret(line: number, column: number): void;
	/** Something to tell the user (a formatting error, no matches…). */
	notify(text: string, kind: "info" | "warning" | "error"): void;
}

export interface TextView {
	readonly element: HTMLElement;
	value(): string;
	focus(): void;
	/** Opens the find bar, with `query` when given. */
	openFind(query?: string): void;
	/** Formats the text as JSON, XML, HTML or YAML, as one undoable edit. */
	beautify(): void;
	/** Puts `text` at the caret (in place of the selection), as one undoable edit. */
	insert(text: string): boolean;
	/** Puts `text` in place of the whole file, as one undoable edit. */
	replaceAll(text: string): boolean;
	readOnly(): boolean;
	setReadOnly(readOnly: boolean): void;
	destroy(): void;
}

let wrapLines = false;

function countLines(text: string, end = text.length): number {
	let lines = 1;
	for (let i = text.indexOf("\n"); i !== -1 && i < end; i = text.indexOf("\n", i + 1)) lines++;
	return lines;
}

function button(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement {
	return el("button", {
		class: "text-view-button",
		attrs: { type: "button", title: label, "aria-label": label },
		children: [icon(name)],
	});
}

function textButton(text: string, label: string): HTMLButtonElement {
	return el("button", {
		class: "text-view-button text-view-text-button",
		attrs: { type: "button", title: label, "aria-label": label },
		text,
	});
}

/** The formatter's language for the file: from its extension, else from the text itself. */
function formatterLanguage(path: string): string | null {
	const ext = extension(path);
	return ext !== "" && detectLanguage("", ext) !== null ? ext : null;
}

export function createTextView(options: TextViewOptions): TextView {
	const { t } = options;
	const formatter = formatterLanguage(options.path);

	const area = el("textarea", {
		class: "text-view-area",
		attrs: {
			spellcheck: "false",
			autocomplete: "off",
			autocapitalize: "off",
			wrap: wrapLines ? "soft" : "off",
			"aria-label": t.document,
		},
	});
	area.value = options.text;
	const gutter = el("pre", { class: "text-view-gutter", attrs: { "aria-hidden": "true" } });
	gutter.hidden = wrapLines;

	const beautifyButton = el("button", {
		class: "text-view-button text-view-format",
		attrs: { type: "button", title: `${t.textFormat} (Shift+Alt+F)` },
		children: [icon("braces"), t.textFormat],
	});
	const findButton = button("find", `${t.textFind} (Ctrl+F)`);
	const wrapToggle = el("input", { attrs: { type: "checkbox" } });
	wrapToggle.checked = wrapLines;
	const toolbar = el("div", {
		class: "text-view-toolbar",
		children: [
			el("span", {
				class: "text-view-kind",
				text: extension(options.path).toLocaleUpperCase("en"),
			}),
			beautifyButton,
			findButton,
			el("label", { class: "text-view-wrap", children: [wrapToggle, t.textWrap] }),
		],
	});

	const findInput = el("input", {
		class: "text-view-find-input",
		attrs: { type: "search", placeholder: t.textFindPlaceholder, "aria-label": t.textFind },
	});
	const findCount = el("span", { class: "text-view-find-count" });
	const findPrevious = textButton("↑", t.textFindPrevious);
	const findNext = textButton("↓", t.textFindNext);
	const findClose = button("close", t.textFindClose);
	const findBar = el("div", {
		class: "text-view-find",
		attrs: { hidden: "", role: "search" },
		children: [findInput, findCount, findPrevious, findNext, findClose],
	});

	const element = el("div", {
		class: "text-view",
		children: [toolbar, findBar, el("div", { class: "text-view-body", children: [gutter, area] })],
	});

	let lines = 0;
	function updateGutter(): void {
		const count = countLines(area.value);
		if (count === lines) return;
		lines = count;
		gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join("\n");
	}

	function reportCaret(): void {
		const at = area.selectionStart;
		const line = countLines(area.value, at);
		const column = at - (area.value.lastIndexOf("\n", at - 1) + 1) + 1;
		options.onCaret(line, column);
	}

	/** Replaces the selection; the browser's own undo keeps the edit. */
	function replaceSelection(text: string): boolean {
		if (area.readOnly) return false;
		area.focus();
		return document.execCommand("insertText", false, text);
	}

	function runBeautify(): void {
		if (area.readOnly) return;
		const result = beautify(area.value, formatter);
		if (!result.ok) {
			if (result.reason === "unsupported") options.notify(t.textFormatUnsupported, "warning");
			else
				options.notify(
					format(t.formatInvalid, result.language.toLocaleUpperCase("en"), result.message),
					"error",
				);
			return;
		}
		if (result.text === area.value) return;
		const caret = Math.min(area.selectionStart, result.text.length);
		area.focus();
		area.select();
		replaceSelection(result.text);
		area.setSelectionRange(caret, caret);
		area.scrollTop = 0;
	}

	area.addEventListener("input", () => {
		updateGutter();
		options.onChange();
		if (!findBar.hidden) runFind(false, true);
	});
	area.addEventListener("scroll", () => {
		gutter.scrollTop = area.scrollTop;
	});
	for (const type of ["keyup", "click", "select", "focus"])
		area.addEventListener(type, reportCaret);
	area.addEventListener("keydown", (event) => {
		const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
		// Tab writes a tab, as in any code editor.
		if (event.key === "Tab" && plain && !event.shiftKey) {
			event.preventDefault();
			replaceSelection("\t");
		} else if (event.shiftKey && event.altKey && !event.ctrlKey && event.code === "KeyF") {
			event.preventDefault();
			runBeautify();
		}
	});
	beautifyButton.addEventListener("click", runBeautify);
	wrapToggle.addEventListener("change", () => {
		wrapLines = wrapToggle.checked;
		area.setAttribute("wrap", wrapLines ? "soft" : "off");
		// Wrapped lines no longer match the numbers.
		gutter.hidden = wrapLines;
	});

	// --- Find ---

	let matches: number[] = [];
	let current = -1;

	/** Where the text has the query, ignoring case when that keeps the positions. */
	function findAll(text: string, query: string): number[] {
		if (query === "") return [];
		const lower = text.toLocaleLowerCase(options.lang);
		const exact = lower.length !== text.length;
		const hay = exact ? text : lower;
		const needle = exact ? query : query.toLocaleLowerCase(options.lang);
		const found: number[] = [];
		for (
			let i = hay.indexOf(needle);
			i !== -1 && found.length < 10_000;
			i = hay.indexOf(needle, i + 1)
		) {
			found.push(i);
		}
		return found;
	}

	function select(index: number): void {
		const start = matches[index];
		if (start === undefined) return;
		current = index;
		area.setSelectionRange(start, start + findInput.value.length);
		// The text box does not scroll to a selection it has no focus for.
		const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight) || 18;
		area.scrollTop = Math.max(
			0,
			(countLines(area.value, start) - 1) * lineHeight - area.clientHeight / 2,
		);
		findCount.textContent = format(t.textMatches, index + 1, matches.length);
		reportCaret();
	}

	/** Looks again; `quiet` only refreshes the count, keeping the selection where it is. */
	function runFind(step: boolean, quiet = false): void {
		matches = findAll(area.value, findInput.value);
		if (matches.length === 0) {
			current = -1;
			findCount.textContent = findInput.value === "" ? "" : t.textNoMatches;
			return;
		}
		if (quiet) {
			findCount.textContent = format(
				t.textMatches,
				Math.min(current + 1, matches.length),
				matches.length,
			);
			return;
		}
		const from = area.selectionStart + (step ? 1 : 0);
		const next = matches.findIndex((at) => at >= from);
		select(next === -1 ? 0 : next);
	}

	function move(by: number): void {
		if (matches.length === 0) runFind(false);
		if (matches.length === 0) return;
		select((current + by + matches.length) % matches.length);
	}

	function openFind(query?: string): void {
		findBar.hidden = false;
		const selected = area.value.slice(area.selectionStart, area.selectionEnd);
		if (query !== undefined) findInput.value = query;
		else if (selected !== "" && !selected.includes("\n")) findInput.value = selected;
		findInput.focus();
		findInput.select();
		runFind(false);
	}

	function closeFind(): void {
		findBar.hidden = true;
		area.focus();
	}

	findButton.addEventListener("click", () => openFind());
	findInput.addEventListener("input", () => runFind(false));
	findInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === "F3") {
			event.preventDefault();
			move(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			closeFind();
		}
	});
	element.addEventListener("keydown", (event) => {
		if (event.key === "F3") {
			event.preventDefault();
			move(event.shiftKey ? -1 : 1);
		}
	});
	findPrevious.addEventListener("click", () => move(-1));
	findNext.addEventListener("click", () => move(1));
	findClose.addEventListener("click", closeFind);

	updateGutter();

	return {
		element,
		value: () => area.value,
		focus: () => area.focus({ preventScroll: true }),
		openFind,
		beautify: runBeautify,
		insert: replaceSelection,
		replaceAll(text) {
			if (area.readOnly) return false;
			area.focus();
			area.select();
			return replaceSelection(text);
		},
		readOnly: () => area.readOnly,
		setReadOnly(readOnly) {
			area.readOnly = readOnly;
			beautifyButton.disabled = readOnly;
		},
		destroy: () => element.remove(),
	};
}
