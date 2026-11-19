import { parse } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import type { LineNode } from "./line-map.js";
import { lineMap, pairBlocks } from "./line-map.js";

function map(markdown: string): LineNode[] {
	return lineMap(markdown, parse(markdown));
}

const DOC = [
	"---", // 1
	"title: x", // 2
	"---", // 3
	"", // 4
	"# Title", // 5
	"", // 6
	"first line", // 7
	"second line", // 8
	"", // 9
	"- one", // 10
	"- two", // 11
	"  - nested", // 12
	"", // 13
	"| a | b |", // 14
	"|---|---|", // 15
	"| 1 | 2 |", // 16
	"| 3 | 4 |", // 17
	"", // 18
	"```js", // 19
	"let a;", // 20
	"let b;", // 21
	"```", // 22
	"", // 23
	"![image](a.png)", // 24
	"",
].join("\n");

describe("lineMap", () => {
	it("gives each top-level block the file line it starts and ends on", () => {
		const nodes = map(DOC);
		expect(nodes.map((node) => [node.type, node.line, node.end])).toEqual([
			["yaml", 1, 3],
			["heading", 5, 5],
			["paragraph", 7, 8],
			["list", 10, 12],
			["table", 14, 17],
			["code", 19, 22],
			["paragraph", 24, 24],
		]);
	});

	it("numbers list items, nested ones too", () => {
		const list = map(DOC)[3];
		expect(list?.children.map((item) => item.line)).toEqual([10, 11]);
		const nested = list?.children[1]?.children[1];
		expect(nested?.type).toBe("list");
		expect(nested?.children.map((item) => item.line)).toEqual([12]);
	});

	it("numbers table rows by their own lines, past the delimiter row", () => {
		expect(map(DOC)[4]?.children.map((row) => row.line)).toEqual([14, 16, 17]);
	});

	it("starts the text of fenced code and front matter under the fence", () => {
		const nodes = map(DOC);
		expect(nodes[0]?.textLine).toBe(2);
		expect(nodes[5]?.textLine).toBe(20);
	});

	it("starts indented code's text on its own first line", () => {
		const nodes = map("para\n\n    indented\n    code\n");
		expect(nodes[1]?.type).toBe("code");
		expect(nodes[1]?.textLine).toBe(3);
	});

	it("numbers a quote's blocks", () => {
		const quote = map("> a\n>\n> b\n")[0];
		expect(quote?.children.map((child) => child.line)).toEqual([1, 3]);
	});
});

describe("pairBlocks", () => {
	it("pairs blocks one to one", () => {
		const nodes = map("# a\n\nb\n");
		expect(pairBlocks(nodes, ["heading", "paragraph"]).map((node) => node?.line)).toEqual([1, 3]);
	});

	it("passes over a table's style comment, which the editor does not show", () => {
		const nodes = map("text\n\n<!-- kalem:table color=blue -->\n| a |\n|---|\n| 1 |\n\nend\n");
		const paired = pairBlocks(nodes, ["paragraph", "table", "paragraph"]);
		expect(paired.map((node) => node?.line)).toEqual([1, 4, 8]);
	});

	it("keeps an HTML block the editor shows", () => {
		const nodes = map("<div>x</div>\n\ntext\n");
		expect(pairBlocks(nodes, ["html", "paragraph"]).map((node) => node?.line)).toEqual([1, 3]);
	});

	it("leaves a block that does not match unnumbered without shifting the rest", () => {
		const nodes = map("# a\n\nb\n\nc\n");
		const paired = pairBlocks(nodes, ["heading", "list", "paragraph"]);
		expect(paired.map((node) => node?.line ?? null)).toEqual([1, null, 5]);
	});
});
