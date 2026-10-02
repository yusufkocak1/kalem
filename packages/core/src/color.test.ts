import { describe, expect, it } from "vitest";
import type { Color, Inline, Paragraph } from "./ast.js";
import { sanitizeColor } from "./color.js";
import { hasMark, toggleMark } from "./commands.js";
import { fromHtml, type HtmlNode } from "./html.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

const inlinesOf = (markdown: string): Inline[] =>
	(parse(markdown).children[0] as Paragraph).children;

const roundTrip = (markdown: string): string => serialize(parse(markdown));

const paragraph = (...children: Inline[]): string =>
	serialize({ type: "root", children: [{ type: "paragraph", children }] }).replace(/\n$/, "");

describe("sanitizeColor", () => {
	it("accepts hex, named and functional colors", () => {
		expect(sanitizeColor("#c00")).toBe("#c00");
		expect(sanitizeColor(" #1971C2 ")).toBe("#1971C2");
		expect(sanitizeColor("rebeccapurple")).toBe("rebeccapurple");
		expect(sanitizeColor("rgb(10, 20, 30)")).toBe("rgb(10, 20, 30)");
		expect(sanitizeColor("hsl(210deg 50% 40% / 0.5)")).toBe("hsl(210deg 50% 40% / 0.5)");
	});

	it("rejects anything that could carry more than a color", () => {
		expect(sanitizeColor("red; background: url(x)")).toBeNull();
		expect(sanitizeColor("url(javascript:alert(1))")).toBeNull();
		expect(sanitizeColor('red" onmouseover="x')).toBeNull();
		expect(sanitizeColor("#12")).toBeNull();
		expect(sanitizeColor("")).toBeNull();
	});
});

describe("parsing colored text", () => {
	it("turns a color span into a color node", () => {
		expect(inlinesOf('a <span style="color:#c00">b **c**</span> d\n')).toMatchObject([
			{ type: "text", value: "a " },
			{
				type: "color",
				color: "#c00",
				children: [
					{ type: "text", value: "b " },
					{ type: "strong", children: [{ type: "text", value: "c" }] },
				],
			},
			{ type: "text", value: " d" },
		]);
	});

	it("finds a color span inside emphasis and links", () => {
		const [strong] = inlinesOf('**<span style="color:red">a</span>**\n');
		expect(strong).toMatchObject({ type: "strong", children: [{ type: "color", color: "red" }] });
		const [link] = inlinesOf('[<span style="color:red">a</span>](https://example.com)\n');
		expect(link).toMatchObject({ type: "link", children: [{ type: "color", color: "red" }] });
	});

	it("matches the closing tag past nested spans", () => {
		const [outer] = inlinesOf(
			'<span style="color:red">a<span class="x">b</span>c<span style="color:blue">d</span></span>\n',
		);
		expect(outer).toMatchObject({ type: "color", color: "red" });
		const children = (outer as Color).children;
		expect(children.map((child) => child.type)).toEqual([
			"text",
			"html",
			"text",
			"html",
			"text",
			"color",
		]);
		expect(children[5]).toMatchObject({ color: "blue", children: [{ value: "d" }] });
	});

	it("leaves other spans and unclosed spans as raw HTML", () => {
		for (const source of [
			'<span class="x">a</span>\n',
			'<span style="color:red; font-weight:bold">a</span>\n',
			'<span style="color:url(x)">a</span>\n',
			'<span style="color:red">a\n',
			'**<span style="color:red">a**</span>\n',
		]) {
			const types = new Set<string>();
			const collect = (nodes: readonly Inline[]): void => {
				for (const node of nodes) {
					types.add(node.type);
					if ("children" in node) collect(node.children);
				}
			};
			collect(inlinesOf(source));
			expect(types.has("color"), source).toBe(false);
			expect(roundTrip(source)).toBe(source);
		}
	});

	it("does not treat a paragraph that starts with a color span as an HTML block", () => {
		expect(parse('<span style="color:red">a</span> b\n').children[0]?.type).toBe("paragraph");
	});
});

describe("serializing colored text", () => {
	it("keeps the tags exactly as written", () => {
		for (const source of [
			'<span style="color:#c00">a</span>\n',
			"<span style='color: red;'>a</span>\n",
			'<SPAN STYLE="COLOR:Red">a</SPAN >\n',
			'| a |\n| --- |\n| <span style="color:red">b</span> |\n',
			'- <span style="color:red">a</span>\n',
		]) {
			expect(roundTrip(source)).toBe(source);
		}
	});

	it("writes a new node in the canonical form", () => {
		expect(
			paragraph(
				{ type: "text", value: "a " },
				{ type: "color", color: "#1971c2", children: [{ type: "text", value: "b" }] },
			),
		).toBe('a <span style="color:#1971c2">b</span>');
	});

	it("rewrites the open tag when the color changed after parsing", () => {
		const [node] = inlinesOf("<span style='color: red;'>a</span>\n");
		expect(paragraph({ ...(node as Color), color: "blue" })).toBe(
			'<span style="color:blue">a</span>',
		);
	});

	it("drops the wrapper for an unsafe color or empty content", () => {
		expect(
			paragraph({
				type: "color",
				color: 'red" onclick="x',
				children: [{ type: "text", value: "a" }],
			}),
		).toBe("a");
		expect(
			paragraph({ type: "text", value: "a" }, { type: "color", color: "red", children: [] }),
		).toBe("a");
	});

	it("produces emphasis that survives a round trip next to letters", () => {
		const source = paragraph(
			{ type: "text", value: "x" },
			{
				type: "color",
				color: "red",
				children: [{ type: "strong", children: [{ type: "text", value: "b" }] }],
			},
			{ type: "text", value: "y" },
		);
		expect(source).toBe('x<span style="color:red">**b**</span>y');
		expect(inlinesOf(`${source}\n`)[1]).toMatchObject({
			type: "color",
			children: [{ type: "strong" }],
		});
	});
});

describe("marks on colored text", () => {
	const red = (...children: Inline[]): Inline => ({ type: "color", color: "red", children });
	const strong = (...children: Inline[]): Inline => ({ type: "strong", children });
	const text = (value: string): Inline => ({ type: "text", value });

	it("sees a mark through the color", () => {
		expect(hasMark([red(strong(text("a")))], "strong")).toBe(true);
		expect(hasMark([red(strong(text("a")), text("b"))], "strong")).toBe(false);
	});

	it("removes a mark inside the color and keeps the color", () => {
		expect(toggleMark([red(strong(text("a")))], "strong")).toEqual([red(text("a"))]);
	});
});

describe("colored text from HTML", () => {
	const t = (value: string): HtmlNode => ({
		nodeType: 3,
		nodeName: "#text",
		textContent: value,
		childNodes: [],
	});
	const span = (style: string, text: string): HtmlNode => ({
		nodeType: 1,
		nodeName: "SPAN",
		textContent: text,
		childNodes: [t(text)],
		getAttribute: (name) => (name === "style" ? style : null),
	});
	const p = (...children: HtmlNode[]): HtmlNode => ({
		nodeType: 1,
		nodeName: "P",
		textContent: null,
		childNodes: children,
		getAttribute: () => null,
	});
	const md = (...children: HtmlNode[]): string =>
		serialize(fromHtml({ ...p(), nodeName: "BODY", childNodes: [p(...children)] })).trim();

	it("keeps a span that only sets a color", () => {
		expect(md(span("color:#C00000", "a"))).toBe('<span style="color:#c00000">a</span>');
	});

	it("ignores default colors and spans carrying other styles", () => {
		expect(md(span("color:black", "a"))).toBe("a");
		expect(md(span("color:windowtext", "a"))).toBe("a");
		expect(md(span("color: rgb(32, 33, 36); font-family: Arial", "a"))).toBe("a");
	});
});
