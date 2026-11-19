/**
 * Which line of the Markdown file each part of the shown document starts
 * on, for the line numbers beside the page. The numbers are the file's own
 * lines (as it is saved), not the page's wrapped lines: a paragraph that
 * the page wraps over five lines is still one line of the file, and a
 * table row, a list item or a line of code is one line each.
 *
 * The tree follows the shape the editor draws, so the renderer can put
 * each number next to the element it belongs to. Pure.
 */
import type { Root } from "@kalem-editor/core";

/** One numbered part of the document, and the parts inside it. */
export interface LineNode {
	/** The block's type, to pair it with the editor's own block. */
	readonly type: string;
	/** The first line of the file it is on, from 1. */
	readonly line: number;
	/** The last line of the file it is on. */
	readonly end: number;
	/**
	 * Blocks inside it, in the order of their elements: list items in a
	 * list, a list item's or a quote's blocks, a table's rows.
	 */
	readonly children: readonly LineNode[];
	/**
	 * For text kept as written (code, HTML, front matter): the line of the
	 * file its first line of text is on; each next line of text is the next
	 * line of the file.
	 */
	readonly textLine?: number;
}

interface Positioned {
	readonly type: string;
	readonly position?: { start: { line: number }; end: { line: number } };
	readonly children?: readonly unknown[];
}

const RAW_TEXT = new Set(["code", "html", "yaml", "toml"]);
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function node(block: Positioned, sourceLines: readonly string[]): LineNode | null {
	const position = block.position;
	if (position === undefined) return null;
	const line = position.start.line;
	const end = position.end.line;
	let children: LineNode[] = [];
	if (
		block.type === "list" ||
		block.type === "listItem" ||
		block.type === "blockquote" ||
		block.type === "table"
	) {
		children = (block.children ?? [])
			.map((child) => node(child as Positioned, sourceLines))
			.filter((child): child is LineNode => child !== null);
	}
	if (!RAW_TEXT.has(block.type)) return { type: block.type, line, end, children };
	// Fenced code and front matter start their text under the fence; indented code and HTML on it.
	const first = sourceLines[line - 1] ?? "";
	const fenced =
		block.type === "yaml" || block.type === "toml" || (block.type === "code" && FENCE.test(first));
	return { type: block.type, line, end, children, textLine: fenced ? line + 1 : line };
}

/**
 * The lines of `markdown`'s top-level blocks, `doc` being `markdown`
 * parsed (`parse` keeps every node's place in the text).
 */
export function lineMap(markdown: string, doc: Root): LineNode[] {
	const sourceLines = markdown.split("\n");
	return doc.children
		.map((block) => node(block as Positioned, sourceLines))
		.filter((block): block is LineNode => block !== null);
}

/**
 * Pairs the file's blocks with the editor's, in order: `shown` is the
 * editor's block types. The file can have blocks the editor does not show
 * (a table's style comment is an HTML block above it); those are skipped.
 * Returns, for each of the editor's blocks, its node or `null`.
 */
export function pairBlocks(
	nodes: readonly LineNode[],
	shown: readonly string[],
): (LineNode | null)[] {
	const paired: (LineNode | null)[] = [];
	let at = 0;
	for (const type of shown) {
		// Only an HTML block is passed over: anything else out of step stays
		// paired one to one, so a single odd block does not shift the rest.
		while (type !== "html" && nodes[at]?.type === "html" && nodes[at + 1] !== undefined) at++;
		const candidate = nodes[at];
		paired.push(candidate !== undefined && candidate.type === type ? candidate : null);
		at++;
	}
	return paired;
}

/** The number of lines `text` has: one more than its line breaks. */
export function countLines(text: string): number {
	let lines = 1;
	for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines++;
	return lines;
}
