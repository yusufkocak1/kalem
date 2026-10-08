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
 * Everything here works from the storage the tab's text was made from (the
 * page as opened, or as last saved), so it needs no state beyond that string.
 */
import { parse } from "@kalem-editor/core";
import type { MarkupElement, MarkupNode } from "./confluence-markup.js";
import { parseMarkup } from "./confluence-markup.js";
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

/** The page's top-level parts, in order; parts that read as nothing join the next one. */
export function segmentsOf(storage: string): PageSegment[] {
	const root = parseMarkup(storage);
	const raw: { xml: string; element: MarkupElement | null }[] = [];
	let at = 0;
	for (const child of root.children) {
		if (child.kind !== "element") continue;
		// Blank space between parts goes with the next one: an untouched page is written back as it was.
		const gap = storage.slice(at, child.start);
		const blank = gap.trim() === "";
		if (!blank) raw.push({ xml: gap, element: null });
		raw.push({ xml: (blank ? gap : "") + storage.slice(child.start, child.end), element: child });
		at = child.end;
	}
	const tail = storage.slice(at);
	const last = raw[raw.length - 1];
	if (tail.trim() !== "") raw.push({ xml: tail, element: null });
	else if (last !== undefined) last.xml += tail;

	const segments: PageSegment[] = [];
	let pending = "";
	for (const { xml, element } of raw) {
		const name = element === null ? null : macroName(element);
		if (name !== null && name !== "" && !KEPT_MACROS.has(name)) {
			const full = pending + xml;
			segments.push({
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
		segments.push({ xml: pending + xml, markdown, locked: false });
		pending = "";
	}
	if (pending !== "") {
		const last = segments.pop();
		segments.push(
			last === undefined
				? { xml: pending, markdown: "", locked: false }
				: { ...last, xml: last.xml + pending },
		);
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
	for (const segment of segments) {
		if (segment.locked) locked.set(segment.markdown, segment.xml);
	}

	const pieces: string[] = [];
	const used = new Set<number>();
	let run: string[] = [];
	const flush = (): void => {
		if (run.length > 0) pieces.push(markdownToStorage(run.join("\n\n"), atoms));
		run = [];
	};
	for (let j = 0; j < current.length; j++) {
		const text = current[j] as string;
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

	// Locked parts are written back or were deleted on purpose; neither loses anything.
	const rewritten = segments.filter((segment, index) => !segment.locked && !used.has(index));
	return { storage: pieces.join(""), losses: lossesOf(rewritten) };
}
