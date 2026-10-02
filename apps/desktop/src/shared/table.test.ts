import type { Root, Table } from "@kalem-editor/core";
import { parse, serialize } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import {
	alignColumn,
	cellText,
	columnCount,
	createTable,
	deleteColumn,
	deleteRow,
	insertColumn,
	insertRow,
	sortRows,
} from "./table.js";

const SOURCE = "| Ad   | Yaş |\n|------|----:|\n| Ayşe | 30  |\n| Can  | 25  |\n";

function parseTable(markdown = SOURCE): Table {
	const block = parse(markdown).children[0];
	if (block?.type !== "table") throw new Error("expected a table");
	return block;
}

function write(table: Table): string {
	return serialize({ type: "root", children: [table] } as Root);
}

describe("createTable", () => {
	it("builds an unaligned table of the requested size", () => {
		const table = createTable(2, 3);
		expect(table.children).toHaveLength(2);
		expect(columnCount(table)).toBe(3);
		expect(table.align).toEqual([null, null, null]);
		expect(write(table)).toBe("|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n");
	});

	it("clamps zero and negative sizes to one", () => {
		const table = createTable(0, -4);
		expect(table.children).toHaveLength(1);
		expect(columnCount(table)).toBe(1);
	});

	it("produces output that parses back as a table", () => {
		expect(parse(write(createTable(3, 2))).children[0]?.type).toBe("table");
	});
});

describe("rows", () => {
	it("inserts an empty row and still serializes a valid table", () => {
		const output = write(insertRow(parseTable(), 2));
		expect(output).toBe("| Ad | Yaş |\n| --- | ---: |\n| Ayşe | 30 |\n|  |  |\n| Can | 25 |\n");
		expect(parseTable(output).children).toHaveLength(4);
	});

	it("treats an out-of-range index as append", () => {
		expect(write(insertRow(parseTable(), 3))).toBe(write(insertRow(parseTable(), 99)));
	});

	it("makes a row inserted at the top the header", () => {
		const table = insertRow(parseTable(), 0);
		expect(table.children[0]?.children.every((cell) => cell.children.length === 0)).toBe(true);
		expect(table.children[1]?.children[0]?.children[0]).toMatchObject({ value: "Ad" });
	});

	it("deletes a row", () => {
		const table = deleteRow(parseTable(), 1);
		expect(write(table as Table)).toBe("| Ad | Yaş |\n| --- | ---: |\n| Can | 25 |\n");
	});

	it("returns null when the last row is deleted", () => {
		expect(deleteRow(createTable(1, 2), 0)).toBeNull();
	});

	it("leaves the table untouched for a missing row", () => {
		const table = parseTable();
		expect(deleteRow(table, 9)).toBe(table);
	});
});

describe("columns", () => {
	it("widens the delimiter row when a column is inserted", () => {
		const output = write(insertColumn(parseTable(), 1));
		expect(output).toBe(
			"| Ad |  | Yaş |\n| --- | --- | ---: |\n| Ayşe |  | 30 |\n| Can |  | 25 |\n",
		);
		expect(columnCount(parseTable(output))).toBe(3);
	});

	it("shifts alignments with their columns", () => {
		expect(insertColumn(parseTable(), 0).align).toEqual([null, null, "right"]);
		expect(insertColumn(parseTable(), 2).align).toEqual([null, "right", null]);
	});

	it("pads ragged rows first", () => {
		const ragged: Table = {
			type: "table",
			align: [null, null],
			children: [
				{
					type: "tableRow",
					children: [
						{ type: "tableCell", children: [{ type: "text", value: "a" }] },
						{ type: "tableCell", children: [{ type: "text", value: "b" }] },
					],
				},
				{
					type: "tableRow",
					children: [{ type: "tableCell", children: [{ type: "text", value: "c" }] }],
				},
			],
		};
		expect(insertColumn(ragged, 2).children.map((row) => row.children.length)).toEqual([3, 3]);
	});

	it("deletes a column", () => {
		expect(write(deleteColumn(parseTable(), 0) as Table)).toBe(
			"| Yaş |\n| ---: |\n| 30 |\n| 25 |\n",
		);
	});

	it("returns null when the last column is deleted", () => {
		expect(deleteColumn(createTable(2, 1), 0)).toBeNull();
	});

	it("rewrites the delimiter row when alignment changes", () => {
		expect(write(alignColumn(parseTable(), 0, "center"))).toBe(
			"| Ad | Yaş |\n| :---: | ---: |\n| Ayşe | 30 |\n| Can | 25 |\n",
		);
		expect(write(alignColumn(parseTable(), 1, null))).toContain("| --- | --- |");
	});
});

describe("invariants", () => {
	it("keeps the block id the editor uses to map elements", () => {
		const table = { ...parseTable(), id: "block-7" } as Table;
		expect(insertRow(table, 1).id).toBe("block-7");
		expect(insertColumn(table, 1).id).toBe("block-7");
		expect(alignColumn(table, 0, "left").id).toBe("block-7");
	});

	it("does not mutate its input", () => {
		const table = parseTable();
		const before = JSON.stringify(table);
		insertRow(table, 1);
		insertColumn(table, 1);
		deleteColumn(table, 0);
		alignColumn(table, 0, "center");
		expect(JSON.stringify(table)).toBe(before);
	});
});

describe("sortRows", () => {
	const column = (table: Table, index: number) =>
		table.children.slice(1).map((row) => cellText(row.children[index]));

	const PEOPLE = [
		"| Ad | Yaş | Şehir |",
		"| --- | ---: | --- |",
		"| Zeynep | 9 | İzmir |",
		"| Çağla | 30 | Ankara |",
		"| ali | 100 |  |",
		"| Işıl | 25 | Iğdır |",
		"",
	].join("\n");

	it("sorts text with the locale's alphabet and keeps the header", () => {
		const sorted = sortRows(parseTable(PEOPLE), 0, "ascending", "tr");
		expect(cellText(sorted.children[0]?.children[0])).toBe("Ad");
		expect(column(sorted, 0)).toEqual(["ali", "Çağla", "Işıl", "Zeynep"]);
		expect(column(sortRows(parseTable(PEOPLE), 0, "descending", "tr"), 0)).toEqual([
			"Zeynep",
			"Işıl",
			"Çağla",
			"ali",
		]);
	});

	it("sorts numbers by value, not as text", () => {
		expect(column(sortRows(parseTable(PEOPLE), 1, "ascending", "tr"), 1)).toEqual([
			"9",
			"25",
			"30",
			"100",
		]);
		expect(column(sortRows(parseTable(PEOPLE), 1, "descending", "tr"), 0)).toEqual([
			"ali",
			"Çağla",
			"Işıl",
			"Zeynep",
		]);
	});

	it("understands decimal commas and thousands separators", () => {
		const table = parseTable("| Tutar |\n| --- |\n| 1.250,50 |\n| 99,9 |\n| 3 |\n| 12.5 |\n");
		expect(column(sortRows(table, 0, "ascending", "tr"), 0)).toEqual([
			"3",
			"12.5",
			"99,9",
			"1.250,50",
		]);
	});

	it("puts empty cells last in both directions", () => {
		expect(column(sortRows(parseTable(PEOPLE), 2, "ascending", "tr"), 2)).toEqual([
			"Ankara",
			"Iğdır",
			"İzmir",
			"",
		]);
		expect(column(sortRows(parseTable(PEOPLE), 2, "descending", "tr"), 2).at(-1)).toBe("");
	});

	it("sorts by the text of formatted cells and keeps the formatting", () => {
		const table = parseTable("| Ad |\n| --- |\n| **Veli** |\n| [Ali](https://a.b) |\n");
		const sorted = sortRows(table, 0, "ascending", "tr");
		expect(write(sorted)).toBe("| Ad |\n| --- |\n| [Ali](https://a.b) |\n| **Veli** |\n");
	});

	it("is stable and returns the same table when nothing moves", () => {
		const table = parseTable("| K | V |\n| --- | --- |\n| a | 1 |\n| a | 2 |\n| b | 3 |\n");
		expect(sortRows(table, 0, "ascending", "tr")).toBe(table);
		expect(column(sortRows(table, 0, "descending", "tr"), 1)).toEqual(["3", "1", "2"]);
		expect(sortRows(createTable(2, 2), 0, "ascending", "tr").children).toHaveLength(2);
	});

	it("writes a valid table with the alignment row intact", () => {
		expect(write(sortRows(parseTable(PEOPLE), 1, "ascending", "tr"))).toBe(
			[
				"| Ad | Yaş | Şehir |",
				"| --- | ---: | --- |",
				"| Zeynep | 9 | İzmir |",
				"| Işıl | 25 | Iğdır |",
				"| Çağla | 30 | Ankara |",
				"| ali | 100 |  |",
				"",
			].join("\n"),
		);
	});
});
