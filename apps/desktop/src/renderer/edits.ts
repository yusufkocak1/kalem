import type { Code, Root, Table } from "@kalem-editor/core";
import { nodeAtPath, replaceAt } from "@kalem-editor/core";
import type { Caret, EditResult } from "@kalem-editor/editor";
import { insertFragment, toggleList } from "@kalem-editor/editor";
import { createTable } from "../shared/table.js";

type Block = Root["children"][number];

function emptyParagraph(): Block {
	return { type: "paragraph", children: [] } as Block;
}

function isEmptyParagraph(block: Block | undefined): boolean {
	return block?.type === "paragraph" && block.children.length === 0;
}

/**
 * Inserts blocks below the caret's block, or in its place when that block is
 * an empty paragraph. Returns the index of the first inserted block.
 */
function insertBlocks(
	doc: Root,
	caret: Caret,
	blocks: readonly Block[],
): { doc: Root; index: number } {
	const replace = isEmptyParagraph(doc.children[caret.blockIndex]);
	const index = replace ? caret.blockIndex : caret.blockIndex + 1;
	const children = [...doc.children];
	children.splice(index, replace ? 1 : 0, ...blocks);

	const after = index + blocks.length;
	const next = children[after];
	if (next === undefined) {
		// Keep a place to continue typing below a table or divider.
		children.push(emptyParagraph());
	} else {
		// The serializer derives blank lines from `position`, which is stale
		// once the block's previous neighbour changes.
		const { position: _position, ...rest } = next;
		children[after] = rest as Block;
	}
	return { doc: { ...doc, children: children as Root["children"] }, index };
}

export function insertTable(doc: Root, caret: Caret, rows: number, columns: number): EditResult {
	const result = insertBlocks(doc, caret, [createTable(rows, columns) as Block]);
	return { doc: result.doc, caret: { blockIndex: result.index, path: [0, 0], offset: 0 } };
}

export function insertDivider(doc: Root, caret: Caret): EditResult {
	const result = insertBlocks(doc, caret, [{ type: "thematicBreak" } as Block]);
	return { doc: result.doc, caret: { blockIndex: result.index + 1, path: [], offset: 0 } };
}

/** Inserts a link at the caret; without a caret it goes into a new paragraph at the end. */
export function insertLink(doc: Root, caret: Caret | null, text: string, url: string): EditResult {
	const paragraph = {
		type: "paragraph",
		children: [
			{ type: "link", url, title: null, children: [{ type: "text", value: text }] },
			// Keeps consecutive links, and the text typed next, apart.
			{ type: "text", value: " " },
		],
	} as Block;

	const inserted =
		caret === null ? null : insertFragment(doc, caret, { type: "root", children: [paragraph] });
	if (inserted !== null) return inserted;
	return {
		doc: { ...doc, children: [...doc.children, paragraph] as Root["children"] },
		caret: { blockIndex: doc.children.length, path: [], offset: 2 },
	};
}

/** Turns the block into a task list, or toggles the checkboxes of an existing list. */
export function toggleTaskList(doc: Root, caret: Caret): EditResult | null {
	const block = doc.children[caret.blockIndex];

	if (block?.type === "list") {
		const allTasks = block.children.every((item) => item.checked !== null);
		const children = block.children.map((item) => ({
			...item,
			checked: allTasks ? null : (item.checked ?? false),
		}));
		return { doc: replaceAt(doc, [caret.blockIndex], { ...block, children }), caret };
	}

	const listed = toggleList(doc, caret, false);
	if (listed === null) return null;
	const list = listed.doc.children[caret.blockIndex];
	const first = list?.type === "list" ? list.children[0] : undefined;
	if (first === undefined) return listed;
	return {
		doc: replaceAt(listed.doc, [caret.blockIndex, 0], { ...first, checked: false }),
		caret: listed.caret,
	};
}

export interface CodeContext {
	/** Path from the root, usable with `replaceAt`. */
	readonly path: readonly number[];
	readonly code: Code;
}

/** The code block at `path`, at the top level or nested in a list or quote. */
export function codeAt(doc: Root, path: readonly number[] | null): CodeContext | null {
	if (path === null) return null;
	const node = nodeAtPath(doc, path);
	return node?.type === "code" ? { path, code: node as Code } : null;
}

export interface TableContext {
	readonly blockIndex: number;
	readonly row: number;
	readonly column: number;
	readonly table: Table;
}

/** A table change: the new table (`null` deletes it) and where the caret goes. */
export interface TableEdit {
	readonly table: Table | null;
	readonly row: number;
	readonly column: number;
}

/** The table cell the caret is in, if any. */
export function tableAt(doc: Root, caret: Caret | null): TableContext | null {
	if (caret === null) return null;
	const block = doc.children[caret.blockIndex];
	const [row, column] = caret.path;
	if (block?.type !== "table" || row === undefined || column === undefined) return null;
	return { blockIndex: caret.blockIndex, row, column, table: block };
}

/** Replaces the table (or removes it when `table` is null) and moves the caret to a cell. */
export function replaceTable(
	doc: Root,
	context: TableContext,
	table: Table | null,
	row: number,
	column: number,
): EditResult {
	if (table === null) {
		return {
			doc: replaceAt(doc, [context.blockIndex], emptyParagraph()),
			caret: { blockIndex: context.blockIndex, path: [], offset: 0 },
		};
	}
	const lastRow = table.children.length - 1;
	const lastColumn = Math.max(0, (table.children[0]?.children.length ?? 1) - 1);
	return {
		doc: replaceAt(doc, [context.blockIndex], table),
		caret: {
			blockIndex: context.blockIndex,
			path: [Math.min(Math.max(0, row), lastRow), Math.min(Math.max(0, column), lastColumn)],
			offset: 0,
		},
	};
}
