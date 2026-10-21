/**
 * The text editor's page: text files that are not Markdown, in tabs, each
 * in a plain text box with line numbers. The text is saved exactly as it
 * was typed, in the file's own encoding and line endings.
 */
import type { KalemBridge, TextDocument } from "../../shared/bridge.js";
import type { TextFormat } from "../../shared/encoding.js";
import { formatLabel } from "../../shared/encoding.js";
import type { Lang, Strings } from "../../shared/i18n.js";
import { format, stringsFor } from "../../shared/i18n.js";
import { el } from "../dom.js";
import { icon } from "../icons.js";
import "./style.css";

declare global {
	interface Window {
		readonly kalem: KalemBridge;
	}
}

interface OpenFile {
	readonly path: string;
	readonly name: string;
	readonly format: TextFormat;
	/** The text as last read or saved. */
	saved: string;
	dirty: boolean;
	readonly tab: HTMLElement;
	readonly tabLabel: HTMLElement;
	readonly pane: HTMLElement;
	readonly area: HTMLTextAreaElement;
	readonly gutter: HTMLElement;
	lines: number;
}

const bridge = window.kalem;
const root = document.getElementById("text-editor") as HTMLElement;
const files: OpenFile[] = [];
let active: OpenFile | null = null;
let wrap = false;

function button(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement {
	return el("button", {
		class: "te-button",
		attrs: { type: "button", title: label, "aria-label": label },
		children: [icon(name)],
	});
}

function countLines(text: string): number {
	let lines = 1;
	for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines++;
	return lines;
}

async function start(): Promise<void> {
	const startup = await bridge.textReady();
	const lang: Lang = startup.language;
	const t: Strings = stringsFor(lang);
	document.documentElement.lang = lang;

	// --- Shell ---

	const tabs = el("div", { class: "te-tabs", attrs: { role: "tablist" } });
	const openButton = button("open", `${t.open} (Ctrl+O)`);
	const saveButton = button("save", `${t.save} (Ctrl+S)`);
	const findButton = button("find", `${t.textFind} (Ctrl+F)`);
	const wrapToggle = el("input", { attrs: { type: "checkbox" } });
	const wrapLabel = el("label", { class: "te-wrap", children: [wrapToggle, t.textWrap] });
	const findInput = el("input", {
		class: "te-find-input",
		attrs: { type: "search", placeholder: t.textFindPlaceholder, "aria-label": t.textFind },
	});
	const findCount = el("span", { class: "te-find-count" });
	const arrow = (text: string, label: string): HTMLButtonElement =>
		el("button", {
			class: "te-button te-arrow",
			attrs: { type: "button", title: label, "aria-label": label },
			text,
		});
	const findPrevious = arrow("↑", t.textFindPrevious);
	const findNext = arrow("↓", t.textFindNext);
	const findClose = button("close", t.textFindClose);
	const findBar = el("div", {
		class: "te-find",
		attrs: { hidden: "", role: "search" },
		children: [findInput, findCount, findPrevious, findNext, findClose],
	});
	const panes = el("div", { class: "te-panes" });
	const empty = el("p", { class: "te-empty", text: t.textEmpty });
	const position = el("span", { class: "te-position" });
	const encoding = el("span", { class: "te-encoding" });
	const message = el("span", { class: "te-message", attrs: { role: "status" } });
	root.append(
		el("div", {
			class: "te-toolbar",
			children: [
				tabs,
				el("div", {
					class: "te-actions",
					children: [openButton, saveButton, findButton, wrapLabel],
				}),
			],
		}),
		findBar,
		panes,
		empty,
		el("div", { class: "te-status", children: [message, position, encoding] }),
	);

	function showMessage(text: string): void {
		message.textContent = text;
	}

	// --- Files ---

	function render(): void {
		empty.hidden = files.length > 0;
		saveButton.disabled = active === null;
		findButton.disabled = active === null;
		for (const file of files) {
			const current = file === active;
			file.tab.setAttribute("aria-selected", String(current));
			file.tab.classList.toggle("dirty", file.dirty);
			file.pane.hidden = !current;
		}
		document.title =
			active === null
				? t.textEditor
				: `${active.dirty ? "• " : ""}${active.name} – ${t.textEditor}`;
		encoding.textContent = active === null ? "" : formatLabel(active.format);
		updatePosition();
	}

	function updatePosition(): void {
		if (active === null) {
			position.textContent = "";
			return;
		}
		const { area } = active;
		const before = area.value.slice(0, area.selectionStart);
		const line = countLines(before);
		const column = area.selectionStart - (before.lastIndexOf("\n") + 1) + 1;
		position.textContent = format(t.textPosition, line, column);
	}

	function updateGutter(file: OpenFile): void {
		const lines = countLines(file.area.value);
		if (lines === file.lines) return;
		file.lines = lines;
		file.gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
	}

	function activate(file: OpenFile): void {
		active = file;
		render();
		file.area.focus();
		if (!findBar.hidden) runFind(false);
	}

	function add(opened: TextDocument): void {
		const existing = files.find((file) => file.path === opened.path);
		if (existing !== undefined) {
			// A file opened again comes back as it is on disk, unless it has changes here.
			if (!existing.dirty && existing.saved !== opened.text) {
				existing.area.value = opened.text;
				existing.saved = opened.text;
				updateGutter(existing);
			}
			activate(existing);
			return;
		}
		const tabLabel = el("span", { class: "te-tab-name", text: opened.name });
		const close = el("button", {
			class: "te-tab-close",
			attrs: {
				type: "button",
				title: `${t.textCloseTab} (Ctrl+W)`,
				"aria-label": format(t.textCloseFile, opened.name),
			},
			children: [icon("close")],
		});
		const tab = el("div", {
			class: "te-tab",
			attrs: { role: "tab", title: opened.path, tabindex: "-1" },
			children: [tabLabel, close],
		});
		const area = el("textarea", {
			class: "te-area",
			attrs: {
				spellcheck: "false",
				autocomplete: "off",
				autocapitalize: "off",
				wrap: "off",
				"aria-label": opened.name,
			},
		});
		area.value = opened.text;
		const gutter = el("pre", { class: "te-gutter", attrs: { "aria-hidden": "true" } });
		const pane = el("div", { class: "te-pane", children: [gutter, area] });
		const file: OpenFile = {
			path: opened.path,
			name: opened.name,
			format: opened.format,
			saved: opened.text,
			dirty: false,
			tab,
			tabLabel,
			pane,
			area,
			gutter,
			lines: 0,
		};
		updateGutter(file);
		applyWrap(file);

		tab.addEventListener("click", () => activate(file));
		tab.addEventListener("auxclick", (event) => {
			if (event.button === 1) void closeFile(file);
		});
		close.addEventListener("click", (event) => {
			event.stopPropagation();
			void closeFile(file);
		});
		area.addEventListener("input", () => {
			const dirty = area.value !== file.saved;
			updateGutter(file);
			if (dirty !== file.dirty) {
				file.dirty = dirty;
				render();
			}
			if (!findBar.hidden) runFind(false, true);
		});
		area.addEventListener("scroll", () => {
			gutter.scrollTop = area.scrollTop;
		});
		for (const type of ["keyup", "click", "select"]) area.addEventListener(type, updatePosition);
		area.addEventListener("keydown", (event) => {
			// Tab writes a tab, as in any code editor; the browser's own undo keeps it.
			if (
				event.key === "Tab" &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.metaKey &&
				!event.shiftKey
			) {
				event.preventDefault();
				document.execCommand("insertText", false, "\t");
			}
		});

		files.push(file);
		tabs.append(tab);
		panes.append(pane);
		activate(file);
	}

	async function save(file: OpenFile): Promise<void> {
		const text = file.area.value;
		try {
			if (!(await bridge.textSave(file.path, text, file.format))) return;
			file.saved = text;
			file.dirty = file.area.value !== text;
			showMessage(format(t.textSaved, file.name));
			render();
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			showMessage(
				format(
					t.textSaveFailed,
					reason.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
				),
			);
		}
	}

	async function closeFile(file: OpenFile): Promise<void> {
		if (file.dirty && !window.confirm(format(t.textUnsavedFile, file.name))) return;
		const index = files.indexOf(file);
		files.splice(index, 1);
		file.tab.remove();
		file.pane.remove();
		bridge.textClose(file.path);
		if (active === file) {
			active = files[Math.min(index, files.length - 1)] ?? null;
			if (active !== null) activate(active);
		}
		render();
	}

	function applyWrap(file: OpenFile): void {
		file.area.setAttribute("wrap", wrap ? "soft" : "off");
		// Wrapped lines no longer match the numbers.
		file.gutter.hidden = wrap;
	}

	wrapToggle.addEventListener("change", () => {
		wrap = wrapToggle.checked;
		for (const file of files) applyWrap(file);
	});
	openButton.addEventListener("click", () => void bridge.textOpenDialog(active?.path ?? null));
	saveButton.addEventListener("click", () => {
		if (active !== null) void save(active);
	});

	// --- Find ---

	let matches: number[] = [];
	let current = -1;

	/** Where the text has the query, ignoring case when that keeps the positions. */
	function findAll(text: string, query: string): number[] {
		if (query === "") return [];
		const lower = text.toLocaleLowerCase(lang);
		const exact = lower.length !== text.length;
		const hay = exact ? text : lower;
		const needle = exact ? query : query.toLocaleLowerCase(lang);
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
		if (active === null) return;
		const start = matches[index];
		if (start === undefined) return;
		current = index;
		const { area } = active;
		area.setSelectionRange(start, start + findInput.value.length);
		// The text box does not scroll to a selection it does not have focus for.
		const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight) || 18;
		const line = countLines(area.value.slice(0, start)) - 1;
		area.scrollTop = Math.max(0, line * lineHeight - area.clientHeight / 2);
		findCount.textContent = format(t.textMatches, index + 1, matches.length);
		updatePosition();
	}

	/** Finds the query again; `step` moves to the next match, `quiet` keeps the selection. */
	function runFind(step: boolean, quiet = false): void {
		if (active === null) return;
		const { area } = active;
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

	function openFind(): void {
		if (active === null) return;
		findBar.hidden = false;
		const { area } = active;
		const selected = area.value.slice(area.selectionStart, area.selectionEnd);
		if (selected !== "" && !selected.includes("\n")) findInput.value = selected;
		findInput.focus();
		findInput.select();
		runFind(false);
	}

	function closeFind(): void {
		findBar.hidden = true;
		active?.area.focus();
	}

	findButton.addEventListener("click", openFind);
	findInput.addEventListener("input", () => runFind(false));
	findInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			move(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			closeFind();
		}
	});
	findPrevious.addEventListener("click", () => move(-1));
	findNext.addEventListener("click", () => move(1));
	findClose.addEventListener("click", closeFind);

	// --- Keys ---

	window.addEventListener("keydown", (event) => {
		const mod = event.ctrlKey || event.metaKey;
		const key = event.key.length === 1 ? event.key.toLocaleLowerCase("en") : event.key;
		if (mod && key === "s") {
			event.preventDefault();
			if (active !== null) void save(active);
		} else if (mod && key === "o") {
			event.preventDefault();
			void bridge.textOpenDialog(active?.path ?? null);
		} else if (mod && key === "w") {
			event.preventDefault();
			if (active !== null) void closeFile(active);
		} else if (mod && key === "f") {
			event.preventDefault();
			openFind();
		} else if (event.key === "F3") {
			event.preventDefault();
			move(event.shiftKey ? -1 : 1);
		} else if (mod && event.key === "Tab" && files.length > 1 && active !== null) {
			event.preventDefault();
			const index = files.indexOf(active);
			const next = files[(index + (event.shiftKey ? -1 : 1) + files.length) % files.length];
			if (next !== undefined) activate(next);
		}
	});

	// Closing with unsaved files asks first (the main process shows the question).
	window.addEventListener("beforeunload", (event) => {
		if (files.some((file) => file.dirty)) event.preventDefault();
	});

	bridge.onTextOpen(add);
	for (const opened of startup.documents) add(opened);
	render();
}

void start();
