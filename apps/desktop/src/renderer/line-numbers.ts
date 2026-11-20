/**
 * Line numbers in the page's left margin, as a code editor has them, for a
 * Markdown document: each number is the line of the file (as it is saved)
 * the part beside it starts on — a heading, a paragraph, a list item, a
 * table row, a line of code. In source mode, the source box's own lines.
 *
 * The numbers are not laid out as a column of fixed-height lines: a page's
 * lines are not of one height (a heading, an image, a diagram, a table row
 * with wrapped cells). Each number is put where its line really is on the
 * screen, measured, and measured again whenever the page can have moved:
 * an edit, an image or a diagram that finished loading, a new width, zoom.
 *
 * Plain text files have their own gutter (`text-view.ts`), which uses
 * `wrappedRows` from here when lines wrap.
 */
import { parse } from "@kalem-editor/core";
import type { LineNode } from "../shared/line-map.js";
import { lineMap, pairBlocks } from "../shared/line-map.js";
import { el } from "./dom.js";

export interface LineNumbersTarget {
	/** The page: the numbers are laid over its left margin. */
	readonly page: HTMLElement;
	/** The editor's element, holding the blocks. */
	readonly canvas: HTMLElement;
	/** Whether the numbers are on (the setting). */
	enabled(): boolean;
	/** Whether the tab shows a Markdown document (not a plain text file). */
	available(): boolean;
	/**
	 * The document as it is saved and the editor's top-level blocks, in
	 * order; `null` when the tab is not a Markdown document.
	 */
	snapshot(): {
		readonly markdown: string;
		readonly blocks: readonly { readonly id: string; readonly type: string }[];
	} | null;
}

export interface LineNumbers {
	/** The document changed: its lines are read again, then the numbers placed. */
	refresh(): void;
	/** Only the layout changed: the numbers are placed again. */
	relayout(): void;
	destroy(): void;
}

interface Mark {
	readonly line: number;
	/** The top of the line's box, from the page's top. */
	readonly top: number;
	/** The line's height. */
	readonly height: number;
}

const STRUCTURE_DELAY = 120;

const BLOCK_TAGS = new Set([
	"P",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"UL",
	"OL",
	"PRE",
	"BLOCKQUOTE",
	"TABLE",
	"HR",
	"DIV",
]);

function blockChildren(element: Element): HTMLElement[] {
	return [...element.children].filter(
		(child): child is HTMLElement => child instanceof HTMLElement && BLOCK_TAGS.has(child.tagName),
	);
}

function lineHeightOf(style: CSSStyleDeclaration): number {
	const value = Number.parseFloat(style.lineHeight);
	if (Number.isFinite(value) && value > 0) return value;
	return (Number.parseFloat(style.fontSize) || 16) * 1.2;
}

/** The first line's box in `element`: under its border and padding, one line high. */
function firstLine(element: HTMLElement): { top: number; height: number } | null {
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return null;
	const style = getComputedStyle(element);
	let top =
		rect.top +
		(Number.parseFloat(style.borderTopWidth) || 0) +
		(Number.parseFloat(style.paddingTop) || 0);
	// The assistant's change under review draws the old text above the block (edit-review.ts):
	// the number goes beside the block's own text.
	if (element.hasAttribute("data-ai-was")) {
		const range = document.createRange();
		range.selectNodeContents(element);
		const own = range.getBoundingClientRect();
		if (own.height > 0) top = Math.max(top, own.top);
	}
	const lineHeight = lineHeightOf(style);
	// A line can be taller than the line height (an image in it), never shorter.
	const inner =
		rect.bottom -
		(Number.parseFloat(style.borderBottomWidth) || 0) -
		(Number.parseFloat(style.paddingBottom) || 0) -
		top;
	return { top, height: inner > 0 ? Math.min(lineHeight, inner) : lineHeight };
}

/**
 * Where the character at `offset` of `text` is drawn; `null` where the
 * browser draws none. A character, not a caret: a caret just after a line
 * break can be drawn at the end of the line above it.
 */
function caretRect(text: Text, offset: number): DOMRect | null {
	const range = document.createRange();
	range.setStart(text, offset);
	if (offset < text.data.length && text.data[offset] !== "\n") range.setEnd(text, offset + 1);
	else range.collapse(true);
	const rects = range.getClientRects();
	const rect = rects[0] ?? range.getBoundingClientRect();
	return rect.height === 0 && rect.top === 0 ? null : rect;
}

/**
 * Where each line after the first starts in `element`'s text: after a
 * line break of the text (`\n`) or a `<br>`. In the order they come.
 */
function lineStarts(element: HTMLElement): { text: Text; offset: number }[] {
	const starts: { text: Text; offset: number }[] = [];
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	let pending = 0;
	for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
		if (current instanceof HTMLBRElement) {
			pending++;
			continue;
		}
		if (!(current instanceof Text)) continue;
		const value = current.data;
		if (value === "") continue;
		for (; pending > 0; pending--) starts.push({ text: current, offset: 0 });
		for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", i + 1)) {
			if (i + 1 < value.length) starts.push({ text: current, offset: i + 1 });
			else pending++;
		}
	}
	return starts;
}

/** Marks a block's every line: its first, then one for each line it starts after a break. */
function markLines(
	element: HTMLElement,
	first: number,
	count: number,
	marks: Mark[],
	origin: number,
): void {
	const line = firstLine(element);
	if (line === null) return;
	marks.push({ line: first, top: line.top - origin, height: line.height });
	if (count <= 1) return;
	const starts = lineStarts(element);
	// More breaks than lines is the editor's trailing `<br>`; fewer, and the
	// text does not match the file's lines: only the first is numbered.
	if (starts.length < count - 1) return;
	// Text kept as written (code): every line break is a new row, an empty
	// line too, which has no character to measure.
	const preformatted = /^(pre|break-spaces)/.test(getComputedStyle(element).whiteSpace);
	let previous = line.top;
	for (let k = 0; k < count - 1; k++) {
		const start = starts[k];
		if (start === undefined) break;
		const rect = caretRect(start.text, start.offset);
		let top = rect === null ? previous + line.height : rect.top - (line.height - rect.height) / 2;
		if (preformatted && top < previous + line.height / 2) top = previous + line.height;
		marks.push({ line: first + k + 1, top: top - origin, height: line.height });
		previous = top;
	}
}

function place(element: HTMLElement, node: LineNode, marks: Mark[], origin: number): void {
	switch (node.type) {
		case "list": {
			const items = [...element.children].filter(
				(child): child is HTMLElement => child instanceof HTMLLIElement,
			);
			items.forEach((item, i) => {
				const child = node.children[i];
				if (child !== undefined) place(item, child, marks, origin);
			});
			return;
		}
		case "listItem": {
			const blocks = blockChildren(element);
			if (blocks.length > 0 && blocks.length === node.children.length) {
				const line = firstLine(element);
				if (line !== null)
					marks.push({ line: node.line, top: line.top - origin, height: line.height });
				blocks.forEach((block, i) => {
					const child = node.children[i];
					if (child !== undefined) place(block, child, marks, origin);
				});
				return;
			}
			// A tight item: its paragraph is drawn in the item itself.
			const paragraph = node.children[0];
			const count =
				node.children.length === 1 && paragraph !== undefined
					? paragraph.end - paragraph.line + 1
					: 1;
			markLines(element, node.line, count, marks, origin);
			return;
		}
		case "blockquote": {
			const blocks = blockChildren(element);
			if (blocks.length !== node.children.length) {
				markLines(element, node.line, 1, marks, origin);
				return;
			}
			blocks.forEach((block, i) => {
				const child = node.children[i];
				if (child !== undefined) place(block, child, marks, origin);
			});
			return;
		}
		case "table": {
			const rows = [...element.querySelectorAll("tr")];
			rows.forEach((row, i) => {
				const child = node.children[i];
				const cell = row.querySelector<HTMLElement>("th, td");
				if (child === undefined || cell === null) return;
				const line = firstLine(cell);
				if (line !== null)
					marks.push({ line: child.line, top: line.top - origin, height: line.height });
			});
			return;
		}
		case "code":
		case "html":
		case "yaml":
		case "toml": {
			const text = element.querySelector<HTMLElement>("code") ?? element;
			const first = node.textLine ?? node.line;
			// The editor ends the box's text with a line break of its own, for the caret.
			const value = (text.textContent ?? "").replace(/\n$/, "");
			let count = 1;
			for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", i + 1)) count++;
			// The fences are not numbered: their lines are not drawn, the box's edges are.
			markLines(element, first, count, marks, origin);
			return;
		}
		default:
			markLines(element, node.line, node.end - node.line + 1, marks, origin);
	}
}

/**
 * How many rows of the box each line of a text box takes: one, unless the
 * box wraps it. Measured in a hidden copy of the box with its width and font.
 */
export function wrappedRows(area: HTMLTextAreaElement, lines: readonly string[]): number[] {
	const style = getComputedStyle(area);
	const lineHeight = lineHeightOf(style);
	const mirror = document.createElement("div");
	for (const property of [
		"fontFamily",
		"fontSize",
		"fontWeight",
		"fontStyle",
		"letterSpacing",
		"wordSpacing",
		"tabSize",
		"textTransform",
		"wordBreak",
		"overflowWrap",
		"paddingLeft",
		"paddingRight",
	] as const) {
		mirror.style[property] = style[property];
	}
	mirror.style.position = "absolute";
	mirror.style.visibility = "hidden";
	mirror.style.left = "-10000px";
	mirror.style.top = "0";
	mirror.style.boxSizing = "border-box";
	mirror.style.width = `${area.clientWidth}px`;
	mirror.style.whiteSpace = "pre-wrap";
	mirror.style.lineHeight = `${lineHeight}px`;
	if (style.overflowWrap === "normal") mirror.style.overflowWrap = "break-word";
	const rows = lines.map((text) => {
		const row = document.createElement("div");
		// An empty line is still a row.
		row.textContent = text === "" ? "​" : text;
		return row;
	});
	mirror.append(...rows);
	document.body.append(mirror);
	const counts = rows.map((row) =>
		Math.max(1, Math.round(row.getBoundingClientRect().height / lineHeight)),
	);
	mirror.remove();
	return counts;
}

/** The source box's line numbers: its lines, wrapped as it wraps them, under its scroll. */
function sourceMarks(area: HTMLTextAreaElement, origin: number): Mark[] {
	const box = area.getBoundingClientRect();
	if (box.height === 0) return [];
	const style = getComputedStyle(area);
	const lineHeight = lineHeightOf(style);
	const top =
		box.top +
		(Number.parseFloat(style.borderTopWidth) || 0) +
		(Number.parseFloat(style.paddingTop) || 0);
	const visibleTop = box.top + (Number.parseFloat(style.borderTopWidth) || 0);
	const visibleBottom = visibleTop + area.clientHeight;
	const lines = area.value.split("\n");
	const rows = wrappedRows(area, lines);
	const marks: Mark[] = [];
	let y = top - area.scrollTop;
	rows.forEach((count, i) => {
		if (y >= visibleTop - 1 && y + lineHeight <= visibleBottom + 1)
			marks.push({ line: i + 1, top: y - origin, height: lineHeight });
		y += count * lineHeight;
	});
	return marks;
}

export function createLineNumbers(target: LineNumbersTarget): LineNumbers {
	const { page, canvas } = target;
	const layer = el("div", { class: "line-numbers", attrs: { "aria-hidden": "true" } });
	page.append(layer);

	let nodes: (LineNode | null)[] = [];
	let ids: string[] = [];
	let markdown: string | null = null;
	let structureTimer: ReturnType<typeof setTimeout> | undefined;
	let frame = 0;

	function readStructure(): void {
		const snapshot = target.enabled() && target.available() ? target.snapshot() : null;
		if (snapshot === null) {
			markdown = null;
			nodes = [];
			ids = [];
			return;
		}
		ids = snapshot.blocks.map((block) => block.id);
		if (snapshot.markdown !== markdown) {
			markdown = snapshot.markdown;
			const map = lineMap(markdown, parse(markdown));
			nodes = pairBlocks(
				map,
				snapshot.blocks.map((block) => block.type),
			);
		}
	}

	function sourceBox(): HTMLTextAreaElement | null {
		const area = page.querySelector<HTMLTextAreaElement>("textarea.kalem-source");
		return area !== null && !area.hidden ? area : null;
	}

	function draw(): void {
		frame = 0;
		const on = target.enabled() && target.available();
		layer.hidden = !on;
		page.toggleAttribute("data-line-numbers", on);
		if (!on) {
			layer.replaceChildren();
			return;
		}
		const origin = page.getBoundingClientRect().top;
		const source = sourceBox();
		let marks: Mark[];
		if (source !== null) {
			marks = sourceMarks(source, origin);
		} else {
			marks = [];
			ids.forEach((id, i) => {
				const node = nodes[i];
				if (node === undefined || node === null) return;
				const element = canvas.querySelector<HTMLElement>(`[data-kalem-id="${CSS.escape(id)}"]`);
				if (element !== null) place(element, node, marks, origin);
			});
		}
		// One number a line, and none drawn over another: a line the page joins
		// to the one above (a soft line break) keeps the number of the first.
		const shown: Mark[] = [];
		const seen = new Set<number>();
		for (const mark of marks) {
			if (seen.has(mark.line)) continue;
			const last = shown[shown.length - 1];
			if (last !== undefined && mark.top < last.top + Math.min(last.height, mark.height) * 0.6)
				continue;
			seen.add(mark.line);
			shown.push(mark);
		}
		const spans = shown.map((mark) => {
			const span = document.createElement("span");
			span.className = "line-number";
			span.textContent = String(mark.line);
			span.style.top = `${mark.top}px`;
			span.style.height = `${mark.height}px`;
			span.style.lineHeight = `${mark.height}px`;
			return span;
		});
		layer.replaceChildren(...spans);
	}

	function relayout(): void {
		if (frame !== 0) return;
		frame = requestAnimationFrame(draw);
	}

	function refresh(): void {
		clearTimeout(structureTimer);
		structureTimer = setTimeout(() => {
			readStructure();
			relayout();
		}, STRUCTURE_DELAY);
	}

	const resize = new ResizeObserver(relayout);
	resize.observe(page);
	resize.observe(canvas);
	// Images and diagrams change the page's height when they arrive.
	const onLoad = (): void => relayout();
	page.addEventListener("load", onLoad, true);
	page.addEventListener("error", onLoad, true);
	// The source box scrolls in itself; its text changes without the editor knowing.
	const onScroll = (event: Event): void => {
		if (event.target instanceof HTMLTextAreaElement) relayout();
	};
	page.addEventListener("scroll", onScroll, true);
	page.addEventListener("input", onScroll, true);
	void document.fonts?.ready.then(relayout);

	return {
		refresh,
		relayout() {
			readStructure();
			relayout();
		},
		destroy() {
			clearTimeout(structureTimer);
			if (frame !== 0) cancelAnimationFrame(frame);
			resize.disconnect();
			page.removeEventListener("load", onLoad, true);
			page.removeEventListener("error", onLoad, true);
			page.removeEventListener("scroll", onScroll, true);
			page.removeEventListener("input", onScroll, true);
			layer.remove();
		},
	};
}
