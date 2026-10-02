import type { AlignType, Table, TableCell, TableRow } from "@kalem-editor/core";

/**
 * The parser keeps the table's raw text in `syntax.raw` and the serializer
 * reuses its delimiter row when the row count matches. After a structural
 * change that raw text no longer describes the table, so it must be dropped.
 */
function restructure(table: Table, children: TableRow[], align: (AlignType | null)[]): Table {
	const { syntax: _raw, position: _position, ...rest } = table;
	return { ...rest, align, children };
}

function emptyCell(): TableCell {
	return { type: "tableCell", children: [] };
}

function emptyRow(columns: number): TableRow {
	return { type: "tableRow", children: Array.from({ length: columns }, emptyCell) };
}

export function columnCount(table: Table): number {
	return table.children.reduce((max, row) => Math.max(max, row.children.length), 0);
}

function alignments(table: Table, columns: number): (AlignType | null)[] {
	return Array.from({ length: columns }, (_, i) => table.align[i] ?? null);
}

export function createTable(rows: number, columns: number): Table {
	const width = Math.max(1, Math.trunc(columns));
	return {
		type: "table",
		align: Array.from({ length: width }, () => null),
		children: Array.from({ length: Math.max(1, Math.trunc(rows)) }, () => emptyRow(width)),
	};
}

/** Inserting at index 0 makes the new row the header: in Markdown the header is simply the first row. */
export function insertRow(table: Table, index: number): Table {
	const at = Math.min(Math.max(0, index), table.children.length);
	const children = [...table.children];
	children.splice(at, 0, emptyRow(columnCount(table)));
	return restructure(table, children, [...table.align]);
}

/** Returns `null` when the last row is removed (the table itself should go). */
export function deleteRow(table: Table, index: number): Table | null {
	if (table.children[index] === undefined) return table;
	if (table.children.length <= 1) return null;
	return restructure(
		table,
		table.children.filter((_, i) => i !== index),
		[...table.align],
	);
}

export function insertColumn(table: Table, index: number): Table {
	const width = columnCount(table);
	const at = Math.min(Math.max(0, index), width);
	const children = table.children.map((row): TableRow => {
		const cells = [...row.children];
		while (cells.length < width) cells.push(emptyCell());
		cells.splice(at, 0, emptyCell());
		const { position: _position, ...rest } = row;
		return { ...rest, children: cells };
	});
	const align = alignments(table, width);
	align.splice(at, 0, null);
	return restructure(table, children, align);
}

/** Returns `null` when the last column is removed (the table itself should go). */
export function deleteColumn(table: Table, index: number): Table | null {
	const width = columnCount(table);
	if (index < 0 || index >= width) return table;
	if (width <= 1) return null;
	const children = table.children.map((row): TableRow => {
		const { position: _position, ...rest } = row;
		return { ...rest, children: row.children.filter((_, i) => i !== index) };
	});
	const align = alignments(table, width);
	align.splice(index, 1);
	return restructure(table, children, align);
}

export function alignColumn(table: Table, index: number, align: AlignType | null): Table {
	const width = columnCount(table);
	if (index < 0 || index >= width) return table;
	const next = alignments(table, width);
	next[index] = align;
	return restructure(table, [...table.children], next);
}

// --- Sorting ----------------------------------------------------------------

/** Plain text of a cell, without formatting. */
export function cellText(cell: TableCell | undefined): string {
	const collect = (nodes: readonly unknown[]): string =>
		nodes
			.map((node) => {
				const value = node as { type?: string; value?: unknown; alt?: unknown; children?: unknown };
				if (typeof value.value === "string") return value.value;
				if (value.type === "break") return " ";
				if (Array.isArray(value.children)) return collect(value.children);
				return typeof value.alt === "string" ? value.alt : "";
			})
			.join("");
	return cell === undefined ? "" : collect(cell.children).trim();
}

/** `12`, `-3.5` and the Turkish/European `1.234,56` and `3,5`. */
function toNumber(text: string): number | null {
	const compact = text.replace(/\s/g, "");
	if (/^[+-]?\d+(\.\d+)?$/.test(compact)) return Number(compact);
	if (/^[+-]?\d{1,3}(\.\d{3})*(,\d+)?$/.test(compact) || /^[+-]?\d+,\d+$/.test(compact)) {
		return Number(compact.replace(/\./g, "").replace(",", "."));
	}
	return null;
}

export type SortDirection = "ascending" | "descending";

/**
 * Sorts the body rows by one column; the header row stays in place. Numbers
 * sort by value, text by the rules of `locale`, and empty cells always go last.
 */
export function sortRows(
	table: Table,
	column: number,
	direction: SortDirection,
	locale: string,
): Table {
	const [header, ...body] = table.children;
	if (header === undefined || body.length < 2) return table;

	const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
	const sign = direction === "ascending" ? 1 : -1;
	const keyed = body.map((row) => {
		const text = cellText(row.children[column]);
		return { row, text, number: toNumber(text) };
	});

	const sorted = [...keyed].sort((a, b) => {
		if (a.text === "" || b.text === "") return Number(a.text === "") - Number(b.text === "");
		if (a.number !== null && b.number !== null) return sign * (a.number - b.number);
		// A column that mixes numbers and text: numbers first.
		if (a.number !== null || b.number !== null) return sign * (a.number !== null ? -1 : 1);
		return sign * collator.compare(a.text, b.text);
	});

	if (sorted.every((entry, i) => entry.row === body[i])) return table;
	return restructure(table, [header, ...sorted.map((entry) => entry.row)], [...table.align]);
}
