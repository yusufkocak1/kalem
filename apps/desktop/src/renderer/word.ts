import { serialize } from "@kalem-editor/core";
import { fromHtml } from "@kalem-editor/core/html";

const BLOCK_SELECTOR = "p, li, div, h1, h2, h3, h4, h5, h6, blockquote, pre";

/**
 * mammoth writes a note as `<sup><a href="#footnote-1">` in the text and an
 * `<li id="footnote-1">` in a list at the end. They become GFM footnotes:
 * `[^1]` and a `[^1]: …` paragraph. Endnotes get labels `e1`, `e2`….
 */
function convertNotes(root: HTMLElement): void {
	const doc = root.ownerDocument;
	const label = (id: string): string | null => {
		const match = /^(footnote|endnote)-(\d+)$/.exec(id);
		if (match === null) return null;
		return match[1] === "endnote" ? `e${match[2]}` : (match[2] as string);
	};

	for (const link of root.querySelectorAll<HTMLAnchorElement>(
		'a[href^="#footnote-"], a[href^="#endnote-"]',
	)) {
		const name = label(link.getAttribute("href")?.slice(1) ?? "");
		if (name === null) continue;
		const target = link.parentElement?.tagName === "SUP" ? link.parentElement : link;
		target.replaceWith(doc.createTextNode(`[^${name}]`));
	}

	const definitions: HTMLElement[] = [];
	const lists = new Set<Element>();
	for (const item of root.querySelectorAll<HTMLLIElement>(
		'li[id^="footnote-"], li[id^="endnote-"]',
	)) {
		const name = label(item.id);
		if (name === null) continue;
		for (const back of item.querySelectorAll(
			'a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]',
		)) {
			back.remove();
		}
		const paragraph = doc.createElement("p");
		paragraph.append(`[^${name}]: `);
		const blocks = Array.from(item.querySelectorAll("p"));
		for (const [i, block] of (blocks.length > 0 ? blocks : [item]).entries()) {
			if (i > 0) paragraph.append(" ");
			paragraph.append(...Array.from(block.childNodes));
		}
		definitions.push(paragraph);
		if (item.parentElement !== null) lists.add(item.parentElement);
	}
	for (const list of lists) list.remove();
	root.append(...definitions);
}

/** Bookmark targets do not exist in Markdown: keep the text, drop the link. */
function unwrapInternalLinks(root: HTMLElement): void {
	for (const back of root.querySelectorAll('a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]')) {
		back.remove();
	}
	for (const link of root.querySelectorAll('a[href^="#"]')) {
		link.replaceWith(...link.childNodes);
	}
}

/** A table row is a single line in Markdown, so cell content must be inline. */
function flattenCell(cell: HTMLTableCellElement): void {
	const doc = cell.ownerDocument;
	for (const nested of cell.querySelectorAll("table")) {
		nested.replaceWith(doc.createTextNode(` ${nested.textContent ?? ""} `));
	}
	for (const lineBreak of cell.querySelectorAll("br")) {
		lineBreak.replaceWith(doc.createTextNode(" "));
	}
	// Without a separator consecutive paragraphs would run together.
	for (const block of cell.querySelectorAll(BLOCK_SELECTOR)) {
		block.after(doc.createTextNode(" "));
	}
}

/** GFM tables have no merged cells: expand col/rowspans into a rectangular grid. */
function squareTable(table: HTMLTableElement): void {
	const doc = table.ownerDocument;
	const rows = Array.from(table.rows);
	const grid: (HTMLTableCellElement | null)[][] = rows.map(() => []);

	for (const [r, row] of rows.entries()) {
		const line = grid[r] as (HTMLTableCellElement | null)[];
		let c = 0;
		for (const cell of Array.from(row.cells)) {
			while (line[c] !== undefined) c++;
			const colSpan = Math.max(1, cell.colSpan);
			const rowSpan = Math.min(Math.max(1, cell.rowSpan), rows.length - r);
			for (let dr = 0; dr < rowSpan; dr++) {
				for (let dc = 0; dc < colSpan; dc++) {
					(grid[r + dr] as (HTMLTableCellElement | null)[])[c + dc] =
						dr === 0 && dc === 0 ? cell : null;
				}
			}
			c += colSpan;
		}
	}

	const width = grid.reduce((max, line) => Math.max(max, line.length), 0);
	for (const [r, row] of rows.entries()) {
		const line = grid[r] as (HTMLTableCellElement | null)[];
		const cells: HTMLTableCellElement[] = [];
		for (let c = 0; c < width; c++) {
			const cell = line[c] ?? doc.createElement("td");
			cell.removeAttribute("colspan");
			cell.removeAttribute("rowspan");
			cells.push(cell);
		}
		row.replaceChildren(...cells);
	}
}

function normalizeTables(root: HTMLElement): void {
	for (const cell of root.querySelectorAll<HTMLTableCellElement>("td, th")) {
		// Cells of a nested table are detached once their outer cell is flattened.
		if (cell.isConnected) flattenCell(cell);
	}
	for (const table of root.querySelectorAll("table")) squareTable(table);
}

/**
 * Converts mammoth's HTML to Markdown with the same converter Kalem uses for
 * pasting from Word, so importing a file and pasting give the same result.
 */
export function wordHtmlToMarkdown(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	convertNotes(doc.body);
	unwrapInternalLinks(doc.body);
	normalizeTables(doc.body);
	// The serializer escapes brackets in text; footnote markers must stay as written.
	return serialize(fromHtml(doc.body)).replace(/\\\[\^([^\]\s\\]+)\\\]/g, "[^$1]");
}
