import type { Table } from "@kalem-editor/core";
import { parse, serialize } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import type { TableStyle } from "./table-style.js";
import {
	extractTableStyles,
	formatDirective,
	hasTableDirective,
	injectTableStyles,
	isPlain,
	NO_STYLE,
	parseDirective,
	renderStyledHtml,
	sameStyle,
	styleByOrder,
	withColumnDeleted,
	withColumnInserted,
	withColumnWidth,
} from "./table-style.js";

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";

describe("directive", () => {
	it("round-trips color and widths", () => {
		const style: TableStyle = { color: "blue", widths: [120, null, 200] };
		expect(formatDirective(style)).toBe("<!-- kalem:table color=blue widths=120,,200 -->");
		expect(parseDirective(formatDirective(style))).toEqual(style);
	});

	it("omits what is not set", () => {
		expect(formatDirective({ color: "red", widths: [] })).toBe("<!-- kalem:table color=red -->");
		expect(formatDirective({ color: null, widths: [80, null] })).toBe(
			"<!-- kalem:table widths=80 -->",
		);
	});

	it("ignores unknown keys and invalid values", () => {
		expect(parseDirective("<!-- kalem:table color=neon widths=abc,5,99999 x=1 -->")).toEqual({
			color: null,
			widths: [null, 40, 900],
		});
	});

	it("does not match other comments", () => {
		expect(parseDirective("<!-- a note -->")).toBeNull();
		expect(parseDirective("<!-- kalem:tablet color=blue -->")).toBeNull();
		expect(parseDirective("<div>kalem:table</div>")).toBeNull();
	});
});

describe("width helpers", () => {
	const style: TableStyle = { color: null, widths: [100, 200] };

	it("sets, clamps and clears a column width", () => {
		expect(withColumnWidth(style, 3, 150).widths).toEqual([100, 200, null, 150]);
		expect(withColumnWidth(style, 0, 5).widths).toEqual([40, 200]);
		expect(withColumnWidth(style, 1, null).widths).toEqual([100]);
	});

	it("moves widths with their columns", () => {
		expect(withColumnInserted(style, 1).widths).toEqual([100, null, 200]);
		expect(withColumnInserted(style, 2).widths).toEqual([100, 200]);
		expect(withColumnDeleted(style, 0).widths).toEqual([200]);
		expect(withColumnDeleted(style, 1).widths).toEqual([100]);
	});

	it("compares styles ignoring trailing automatic columns", () => {
		expect(sameStyle({ color: null, widths: [100, null] }, { color: null, widths: [100] })).toBe(
			true,
		);
		expect(sameStyle(style, { ...style, color: "blue" })).toBe(false);
		expect(isPlain({ color: null, widths: [null, null] })).toBe(true);
		expect(isPlain(style)).toBe(false);
	});
});

describe("extractTableStyles", () => {
	it("removes directives and reports one style per table", () => {
		const source = [
			"# Başlık",
			"",
			"<!-- kalem:table color=green widths=90,150 -->",
			"",
			TABLE,
			"Ara metin.",
			"",
			TABLE,
			"<!-- kalem:table color=red -->",
			TABLE,
		].join("\n");

		const { markdown, styles } = extractTableStyles(source);
		expect(markdown).toBe(["# Başlık", "", TABLE, "Ara metin.", "", TABLE, TABLE].join("\n"));
		expect(styles).toEqual([
			{ color: "green", widths: [90, 150] },
			NO_STYLE,
			{ color: "red", widths: [] },
		]);
	});

	it("leaves text without directives untouched", () => {
		const source = `Metin.\n\n${TABLE}\n<!-- sıradan yorum -->\n\nSon.\n`;
		expect(extractTableStyles(source)).toEqual({ markdown: source, styles: [NO_STYLE] });
	});

	it("keeps a directive that is not followed by a table", () => {
		const source = "<!-- kalem:table color=blue -->\n\nParagraf.\n";
		expect(extractTableStyles(source).markdown).toBe(source);
	});
});

describe("injectTableStyles", () => {
	it("writes a directive above styled tables only", () => {
		const doc = parse(`Önce.\n\n${TABLE}\n${TABLE}`);
		const tables = doc.children.filter((block): block is Table => block.type === "table");
		const styled = injectTableStyles(doc, (table) =>
			table === tables[1] ? { color: "teal", widths: [null, 64] } : NO_STYLE,
		);
		expect(serialize(styled)).toBe(
			`Önce.\n\n${TABLE}\n<!-- kalem:table color=teal widths=,64 -->\n\n${TABLE}`,
		);
	});

	it("returns the same document when nothing is styled", () => {
		const doc = parse(TABLE);
		expect(injectTableStyles(doc, () => undefined)).toBe(doc);
	});

	it("survives a save and reopen", () => {
		const style: TableStyle = { color: "purple", widths: [70, 210] };
		const saved = serialize(injectTableStyles(parse(`# A\n\n${TABLE}`), () => style));
		const reopened = extractTableStyles(saved);
		expect(reopened.styles).toEqual([style]);
		expect(reopened.markdown).toBe(`# A\n\n${TABLE}`);
	});
});

describe("styled HTML", () => {
	const doc = parse(`${TABLE}\n${TABLE}`);
	const [first, second] = doc.children;

	it("inlines the color and widths into the cells", () => {
		const html = renderStyledHtml(doc, (table) =>
			table === first ? { color: "blue", widths: [120] } : undefined,
		);
		expect(html).toContain(
			'<th style="background:#2f6fd0;color:#fff;border-color:#2f6fd0;width:120px;min-width:120px;max-width:120px">a</th>',
		);
		expect(html).toContain('<th style="background:#2f6fd0;color:#fff;border-color:#2f6fd0">b</th>');
		// Only the first table is styled.
		expect(html.match(/<th>a<\/th>/g)).toHaveLength(1);
	});

	it("tints every other body row", () => {
		const table = parse("| a |\n| --- |\n| 1 |\n| 2 |\n");
		const html = renderStyledHtml(table, () => ({ color: "red", widths: [] }));
		const cells = html.match(/<td[^>]*>/g) ?? [];
		expect(cells[0]).not.toContain("background");
		expect(cells[1]).toContain("background:#f8e9e8");
	});

	it("matches tables by order", () => {
		const styleOf = styleByOrder(doc, [NO_STYLE, { color: "red", widths: [] }]);
		expect(styleOf(first as Table)).toEqual(NO_STYLE);
		expect(styleOf(second as Table)?.color).toBe("red");
	});

	it("detects a directive on its own line", () => {
		expect(hasTableDirective(`x\n<!-- kalem:table color=red -->\n${TABLE}`)).toBe(true);
		expect(hasTableDirective("`<!-- kalem:table -->` inside text")).toBe(false);
	});
});
