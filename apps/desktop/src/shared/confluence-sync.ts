/**
 * Editing a Confluence page in Markdown without rewriting what was not edited.
 *
 * The page's storage format is cut into its top-level parts (a paragraph, a
 * table, a macro…), each converted to Markdown on its own. On save, the
 * Markdown blocks are matched against those parts: a part whose blocks are
 * all still there, unchanged and in order, is written back as its original
 * XML, byte for byte. Only the blocks the user changed or added are
 * converted from Markdown. Column widths, colours, merged cells and
 * everything else Markdown cannot hold survive in the parts nobody touched.
 *
 * Macros Markdown has no form for (Jira, table of contents, status…) are
 * not converted at all: they become a locked placeholder, an HTML comment
 * the editor shows as a box. The box can be moved or deleted; its XML is
 * written back wherever it ends up.
 *
 * A multi-column layout (`ac:layout`) is flattened: each column starts with
 * a locked marker and the layout ends with one. Everything between markers
 * is edited like the rest of the page; on save the markers become the
 * layout's sections and cells again, with their original tags.
 *
 * Everything here works from the storage the tab's text was made from (the
 * page as opened, or as last saved), so it needs no state beyond that string.
 */
import { parse } from "@kalem-editor/core";
import type { MarkupElement, MarkupNode } from "./confluence-markup.js";
import { childElements, parseMarkup } from "./confluence-markup.js";
import {
	ATOM_PREFIX,
	atomKind,
	hash,
	KEPT_MACROS,
	markdownToStorage,
	storageLosses,
	storageToMarkdown,
} from "./confluence-storage.js";

/** A top-level part of the page and the Markdown it reads as. */
export interface PageSegment {
	readonly xml: string;
	readonly markdown: string;
	/** A placeholder whose XML is kept as is wherever the placeholder goes. */
	readonly locked: boolean;
	/** A layout marker: where a column starts, or where the layout ends. */
	readonly layout?: LayoutMark;
}

/** The tags around one column of a layout, as they were in the source. */
interface LayoutMark {
	readonly end: boolean;
	/** Which layout of the page; markers of one layout share it. */
	readonly key: string;
	readonly section: number;
	readonly layoutOpen: string;
	readonly layoutClose: string;
	readonly sectionOpen: string;
	readonly sectionClose: string;
	readonly cellOpen: string;
	readonly cellClose: string;
}

const LAYOUT = /^<!-- confluence:layout ([0-9a-f]{8}) s(\d+) c(\d+)\/(\d+) ([\w-]*) -->$/;
const LAYOUT_END = /^<!-- confluence:layout-end ([0-9a-f]{8}) -->$/;

export type LayoutLabel =
	| { readonly end: false; readonly section: number; readonly cell: number; readonly cells: number }
	| { readonly end: true };

/** What a layout marker stands for; `null` for any other text. */
export function layoutLabel(text: string): LayoutLabel | null {
	const trimmed = text.trim();
	if (LAYOUT_END.test(trimmed)) return { end: true };
	const match = LAYOUT.exec(trimmed);
	if (match === null) return null;
	return {
		end: false,
		section: Number(match[2]),
		cell: Number(match[3]),
		cells: Number(match[4]),
	};
}

const KEEP = /^<!-- confluence:keep ([0-9a-f]{8}) ([^\n]*?) -->$/;

/** The locked placeholder's label (the macro name); `null` for any other text. */
export function lockedLabel(text: string): string | null {
	return KEEP.exec(text.trim())?.[2] ?? null;
}

function macroName(element: MarkupElement): string | null {
	if (element.name !== "ac:structured-macro" && element.name !== "ac:macro") return null;
	// kalem-locale-ok: macro names are ASCII
	return (element.attrs.get("ac:name") ?? "").toLowerCase();
}

interface Part {
	xml: string;
	readonly element: MarkupElement | null;
}

/** The parts of `nodes` in `[from, to)`: elements, and text between them that is not blank. */
function partsOf(storage: string, nodes: readonly MarkupNode[], from: number, to: number): Part[] {
	const parts: Part[] = [];
	let at = from;
	for (const child of nodes) {
		if (child.kind !== "element") continue;
		// Blank space between parts goes with the next one: an untouched page is written back as it was.
		const gap = storage.slice(at, child.start);
		const blank = gap.trim() === "";
		if (!blank) parts.push({ xml: gap, element: null });
		parts.push({ xml: (blank ? gap : "") + storage.slice(child.start, child.end), element: child });
		at = child.end;
	}
	const tail = storage.slice(at, to);
	const last = parts[parts.length - 1];
	if (tail.trim() !== "") parts.push({ xml: tail, element: null });
	else if (last !== undefined) last.xml += tail;
	return parts;
}

/** Where the element's opening tag ends. */
function openEnd(storage: string, element: MarkupElement): number {
	const end = storage.indexOf(">", element.start);
	return end === -1 || end >= element.end ? element.end : end + 1;
}

/** Where the element's content ends: before its closing tag, when it has one. */
function innerEnd(storage: string, element: MarkupElement): number {
	const close = `</${element.name}>`;
	const at = element.end - close.length;
	// kalem-locale-ok: tag names are ASCII
	return at >= openEnd(storage, element) && storage.slice(at, element.end).toLowerCase() === close
		? at
		: element.end;
}

interface Collecting {
	readonly storage: string;
	readonly out: PageSegment[];
	layouts: number;
}

/**
 * Turns parts into segments; a part that reads as nothing joins the next one.
 * Returns what is left over at the end (nothing to join).
 */
function collect(parts: readonly Part[], state: Collecting): string {
	const { out } = state;
	let pending = "";
	for (const { xml, element } of parts) {
		if (element?.name === "ac:layout" && childElements(element, "ac:layout-section").length > 0) {
			const prefix = pending + xml.slice(0, xml.length - (element.end - element.start));
			pending = "";
			layout(element, prefix, state);
			continue;
		}
		const name = element === null ? null : macroName(element);
		if (name !== null && name !== "" && !KEPT_MACROS.has(name)) {
			const full = pending + xml;
			out.push({
				xml: full,
				markdown: `<!-- confluence:keep ${hash(full)} ${name.replace(/-->|\s+/g, " ").trim()} -->`,
				locked: true,
			});
			pending = "";
			continue;
		}
		const markdown = storageToMarkdown(xml, { atoms: true }).trim();
		if (markdown === "") {
			pending += xml;
			continue;
		}
		out.push({ xml: pending + xml, markdown, locked: false });
		pending = "";
	}
	return pending;
}

/** A layout as a marker before each column and one after the last; the columns' content in between. */
function layout(element: MarkupElement, prefix: string, state: Collecting): void {
	const { storage, out } = state;
	const key = hash(`${state.layouts++}:${storage.slice(element.start, element.end)}`);
	const layoutOpen = prefix + storage.slice(element.start, openEnd(storage, element));
	const marks: { -readonly [K in keyof LayoutMark]: LayoutMark[K] }[] = [];
	let previous = openEnd(storage, element);
	for (const [s, section] of childElements(element, "ac:layout-section").entries()) {
		const sectionOpen = storage.slice(previous, openEnd(storage, section));
		const cells = childElements(section, "ac:layout-cell");
		const type = (section.attrs.get("ac:type") ?? "").replace(/[^\w-]/g, "");
		const first = marks.length;
		let cellStart = openEnd(storage, section);
		for (const [c, cell] of cells.entries()) {
			const mark = {
				end: false,
				key,
				section: s,
				layoutOpen,
				layoutClose: "",
				sectionOpen,
				sectionClose: "",
				cellOpen: storage.slice(cellStart, openEnd(storage, cell)),
				cellClose: "",
			};
			marks.push(mark);
			out.push({
				xml: "",
				markdown: `<!-- confluence:layout ${key} s${s + 1} c${c + 1}/${cells.length} ${type} -->`,
				locked: true,
				layout: mark,
			});
			const inner = innerEnd(storage, cell);
			const left = collect(partsOf(storage, cell.children, openEnd(storage, cell), inner), state);
			mark.cellClose = left + storage.slice(inner, cell.end);
			cellStart = cell.end;
		}
		const sectionClose = storage.slice(cellStart, section.end);
		for (const mark of marks.slice(first)) mark.sectionClose = sectionClose;
		previous = section.end;
	}
	const layoutClose = storage.slice(previous, element.end);
	for (const mark of marks) mark.layoutClose = layoutClose;
	const ending = {
		...(marks[0] as LayoutMark),
		end: true,
	};
	out.push({
		xml: "",
		markdown: `<!-- confluence:layout-end ${key} -->`,
		locked: true,
		layout: ending,
	});
}

/** The page's parts, in order; parts that read as nothing join the next one. */
export function segmentsOf(storage: string): PageSegment[] {
	const root = parseMarkup(storage);
	const segments: PageSegment[] = [];
	const left = collect(partsOf(storage, root.children, 0, storage.length), {
		storage,
		out: segments,
		layouts: 0,
	});
	if (left !== "") {
		const last = segments.pop();
		segments.push(
			last === undefined
				? { xml: left, markdown: "", locked: false }
				: last.layout === undefined
					? { ...last, xml: last.xml + left }
					: last,
		);
		if (last?.layout !== undefined) segments.push({ xml: left, markdown: "", locked: false });
	}
	return segments.filter((segment) => segment.markdown !== "" || segment.xml.trim() !== "");
}

export interface ImportedPage {
	readonly markdown: string;
	/** What saving would lose if the parts holding it were edited. */
	readonly losses: string[];
}

export function importPage(storage: string): ImportedPage {
	const segments = segmentsOf(storage);
	const markdown = segments
		.map((segment) => segment.markdown)
		.filter((text) => text !== "")
		.join("\n\n");
	return {
		markdown: markdown === "" ? "" : `${markdown}\n`,
		losses: lossesOf(segments.filter((segment) => !segment.locked)),
	};
}

function lossesOf(segments: readonly PageSegment[]): string[] {
	return [...new Set(segments.flatMap((segment) => storageLosses(segment.xml, { atoms: true })))];
}

/** The page's inline atoms (mentions, page links, dates, inline macros) by their kept link. */
export function atomsOf(storage: string): Map<string, string> {
	const atoms = new Map<string, string>();
	const visit = (node: MarkupNode): void => {
		if (node.kind === "text") return;
		if (node.name !== "#root" && atomKind(node) !== null) {
			const xml = storage.slice(node.start, node.end);
			atoms.set(ATOM_PREFIX + hash(xml), xml);
			return;
		}
		for (const child of node.children) visit(child);
	};
	visit(parseMarkup(storage));
	return atoms;
}

/** Top-level blocks as their Markdown source; Kalem's table style comments are not content. */
function blockTexts(markdown: string): string[] {
	const doc = parse(markdown);
	return doc.children.flatMap((block) => {
		if (block.type === "yaml" || block.type === "toml") return [];
		const position = block.position;
		if (position === undefined) return [];
		const text = markdown.slice(position.start.offset, position.end.offset).trim();
		if (block.type === "html" && text.startsWith("<!-- kalem-table")) return [];
		return text === "" ? [] : [text];
	});
}

/** Pairs of indices of a longest common subsequence of `a` and `b`. */
function commonBlocks(a: readonly string[], b: readonly string[]): [number, number][] {
	const n = a.length;
	const m = b.length;
	const length = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			const row = length[i] as Int32Array;
			row[j] =
				a[i] === b[j]
					? ((length[i + 1] as Int32Array)[j + 1] as number) + 1
					: Math.max((length[i + 1] as Int32Array)[j] as number, row[j + 1] as number);
		}
	}
	const pairs: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (
			((length[i + 1] as Int32Array)[j] as number) >= ((length[i] as Int32Array)[j + 1] as number)
		) {
			i++;
		} else {
			j++;
		}
	}
	return pairs;
}

export interface ExportedPage {
	readonly storage: string;
	/** What the parts that are written from Markdown lose. */
	readonly losses: string[];
}

/** A matching that would be slower than converting the page is not worth it. */
const MAX_PAIRS = 4_000_000;

/**
 * The page's new storage: unchanged parts as they were in `base`, the rest
 * converted from Markdown. Without a base it is a plain conversion.
 */
export function exportPage(markdown: string, base: string | null): ExportedPage {
	const segments = base === null ? [] : segmentsOf(base);
	const current = blockTexts(markdown);
	const original: { text: string; segment: number }[] = segments.flatMap((segment, index) =>
		segment.markdown === ""
			? []
			: blockTexts(segment.markdown).map((text) => ({ text, segment: index })),
	);
	const atoms = base === null ? new Map<string, string>() : atomsOf(base);
	if (segments.length === 0 || original.length * current.length > MAX_PAIRS) {
		return { storage: markdownToStorage(markdown, atoms), losses: lossesOf(segments) };
	}

	// A part is kept when all its blocks are matched, in order, to consecutive blocks.
	const pairs = commonBlocks(
		original.map((block) => block.text),
		current,
	);
	const matched = new Map<number, number>(pairs);
	const keptAt = new Map<number, number>();
	for (const [index, segment] of segments.entries()) {
		const blocks = original.flatMap((block, i) => (block.segment === index ? [i] : []));
		if (blocks.length === 0 || segment.locked) continue;
		const first = matched.get(blocks[0] as number);
		if (first === undefined) continue;
		if (blocks.every((block, k) => matched.get(block) === first + k)) keptAt.set(first, index);
	}
	const locked = new Map<string, string>();
	const marks = new Map<string, LayoutMark>();
	for (const segment of segments) {
		if (segment.layout !== undefined) marks.set(segment.markdown, segment.layout);
		else if (segment.locked) locked.set(segment.markdown, segment.xml);
	}

	const pieces: string[] = [];
	const used = new Set<number>();
	let run: string[] = [];
	const flush = (): void => {
		if (run.length > 0) pieces.push(markdownToStorage(run.join("\n\n"), atoms));
		run = [];
	};
	// The layout, section and column the text is in now, by the marker that opened them.
	let open: LayoutMark | null = null;
	const close = (): void => {
		if (open === null) return;
		pieces.push(open.cellClose, open.sectionClose, open.layoutClose);
		open = null;
	};
	for (let j = 0; j < current.length; j++) {
		const text = current[j] as string;
		const mark = marks.get(text);
		if (mark !== undefined) {
			flush();
			const was: LayoutMark | null = open;
			if (mark.end) {
				if (was?.key === mark.key) close();
				continue;
			}
			if (was !== null && was.key === mark.key && was.section === mark.section) {
				pieces.push(was.cellClose, mark.cellOpen);
			} else if (was !== null && was.key === mark.key) {
				pieces.push(was.cellClose, was.sectionClose, mark.sectionOpen, mark.cellOpen);
			} else {
				close();
				pieces.push(mark.layoutOpen, mark.sectionOpen, mark.cellOpen);
			}
			open = mark;
			continue;
		}
		const kept = keptAt.get(j);
		if (kept !== undefined) {
			flush();
			const segment = segments[kept] as PageSegment;
			pieces.push(segment.xml);
			used.add(kept);
			j += blockTexts(segment.markdown).length - 1;
			continue;
		}
		const xml = locked.get(text);
		if (xml !== undefined) {
			flush();
			pieces.push(xml);
			continue;
		}
		run.push(text);
	}
	flush();
	close();

	// Locked parts are written back or were deleted on purpose; neither loses anything.
	const rewritten = segments.filter((segment, index) => !segment.locked && !used.has(index));
	return { storage: pieces.join(""), losses: lossesOf(rewritten) };
}
