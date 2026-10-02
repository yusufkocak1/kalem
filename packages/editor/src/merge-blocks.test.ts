import { parse, serialize } from "@kalem-editor/core";
import { beforeEach, describe, expect, it } from "vitest";
import { mergeBlocks } from "./block-edit.js";
import { assignIds, resetIds } from "./ids.js";

const load = (markdown: string) => assignIds(parse(markdown));

function merged(markdown: string, from: number, count: number): string | null {
	const result = mergeBlocks(load(markdown), from, count);
	return result === null ? null : serialize(result.doc);
}

beforeEach(() => resetIds());

describe("mergeBlocks", () => {
	it("joins text blocks line by line and keeps the first block's type", () => {
		expect(merged("bir\n\niki\n\nüç\n", 0, 3)).toBe("bir\\\niki\\\nüç\n");
		expect(merged("# bir\n\n**iki**\n", 0, 2)).toBe("# bir\\\n**iki**\n");
	});

	it("leaves the blocks around the range alone", () => {
		expect(merged("önce\n\nbir\n\niki\n\nsonra\n", 1, 2)).toBe("önce\n\nbir\\\niki\n\nsonra\n");
	});

	it("puts the caret where the first block ended and keeps its id", () => {
		const doc = load("bir\n\niki\n");
		const result = mergeBlocks(doc, 0, 2);
		expect(result?.caret).toEqual({ blockIndex: 0, path: [], offset: 3 });
		expect(result?.doc.children[0]?.id).toBe(doc.children[0]?.id);
	});

	it("skips empty paragraphs instead of adding blank lines", () => {
		const doc = load("bir\n\niki\n");
		const empty = { ...doc.children[1], children: [] } as (typeof doc.children)[number];
		const result = mergeBlocks({ ...doc, children: [doc.children[0], empty] as never }, 0, 2);
		expect(result === null ? null : serialize(result.doc)).toBe("bir\n");
	});

	it("turns paragraphs into lines of the code block they are merged into", () => {
		expect(merged('```json\n{\n```\n\n"a": **1**\n\n```\n}\n```\n', 0, 3)).toBe(
			'```json\n{\n"a": 1\n}\n```\n',
		);
	});

	it("turns a code block into lines of the paragraph it is merged into", () => {
		expect(merged("metin\n\n```\na\n\nb\n```\n", 0, 2)).toBe("metin\\\na\\\n\\\nb\n");
	});

	it("appends lists, paragraphs and code blocks to a list as items", () => {
		expect(merged("- bir\n\n1. iki\n\nüç\n", 0, 3)).toBe("- bir\n- iki\n- üç\n");
	});

	it("moves blocks into a quote", () => {
		expect(merged("> bir\n\niki\n\n> üç\n\n- dört\n", 0, 4)).toBe(
			"> bir\n>\n> iki\n>\n> üç\n>\n> - dört\n",
		);
	});

	it("refuses blocks that have no place in the first one", () => {
		expect(merged("bir\n\n| a |\n| --- |\n| b |\n", 0, 2)).toBeNull();
		expect(merged("bir\n\n- iki\n", 0, 2)).toBeNull();
		expect(merged("---\n\nbir\n", 0, 2)).toBeNull();
		expect(merged("```\na\n```\n\n- b\n", 0, 2)).toBeNull();
	});

	it("refuses frontmatter and ranges outside the document", () => {
		expect(merged("---\na: 1\n---\n\nbir\n", 0, 2)).toBeNull();
		expect(merged("bir\n\niki\n", 0, 1)).toBeNull();
		expect(merged("bir\n\niki\n", 1, 2)).toBeNull();
		expect(merged("bir\n\niki\n", -1, 2)).toBeNull();
	});
});
