import type { Root, Table } from "@kalem-editor/core";
import { parse } from "@kalem-editor/core";
import type { RenderElement } from "@kalem-editor/viewer";
import { buildPlan, stringifyPlan } from "@kalem-editor/viewer";

export const TABLE_COLORS = ["gray", "blue", "teal", "green", "orange", "red", "purple"] as const;
export type TableColor = (typeof TABLE_COLORS)[number];

/** The same values as `--table-color` in the renderer's style.css. */
export const TABLE_COLOR_VALUES: Record<TableColor, string> = {
	gray: "#6b7280",
	blue: "#2f6fd0",
	teal: "#0f7f78",
	green: "#2e8540",
	orange: "#c96a12",
	red: "#c0392b",
	purple: "#7b3fc4",
};

export const MIN_COLUMN_WIDTH = 40;
export const MAX_COLUMN_WIDTH = 900;

/**
 * Presentation of a table that Markdown itself cannot express. It is stored
 * in an HTML comment above the table, so other Markdown tools still see a
 * plain, valid table.
 */
export interface TableStyle {
	readonly color: TableColor | null;
	/** Column widths in CSS pixels at 100% zoom; `null` means automatic. */
	readonly widths: readonly (number | null)[];
}

export const NO_STYLE: TableStyle = { color: null, widths: [] };

export function clampColumnWidth(width: number): number {
	return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function trimWidths(widths: readonly (number | null)[]): (number | null)[] {
	const out = [...widths];
	while (out.length > 0 && out[out.length - 1] === null) out.pop();
	return out;
}

export function isPlain(style: TableStyle): boolean {
	return style.color === null && style.widths.every((width) => width === null);
}

export function sameStyle(a: TableStyle, b: TableStyle): boolean {
	const wa = trimWidths(a.widths);
	const wb = trimWidths(b.widths);
	return a.color === b.color && wa.length === wb.length && wa.every((w, i) => w === wb[i]);
}

export function withColumnWidth(
	style: TableStyle,
	column: number,
	width: number | null,
): TableStyle {
	const widths: (number | null)[] = [...style.widths];
	while (widths.length <= column) widths.push(null);
	widths[column] = width === null ? null : clampColumnWidth(width);
	return { ...style, widths: trimWidths(widths) };
}

/** Keeps widths attached to their columns when a column is inserted. */
export function withColumnInserted(style: TableStyle, column: number): TableStyle {
	if (column >= style.widths.length) return style;
	const widths = [...style.widths];
	widths.splice(column, 0, null);
	return { ...style, widths };
}

export function withColumnDeleted(style: TableStyle, column: number): TableStyle {
	if (column >= style.widths.length) return style;
	return { ...style, widths: trimWidths(style.widths.filter((_, i) => i !== column)) };
}

// --- The comment that carries the style --------------------------------------

const DIRECTIVE = /^<!--\s*kalem:table\b([^>]*?)-->\s*$/;

/** Whether the text carries at least one table directive. */
export function hasTableDirective(markdown: string): boolean {
	return /^[ \t]*<!--\s*kalem:table\b/m.test(markdown);
}

/** `<!-- kalem:table color=blue widths=120,,200 -->` */
export function formatDirective(style: TableStyle): string {
	const parts = ["kalem:table"];
	if (style.color !== null) parts.push(`color=${style.color}`);
	const widths = trimWidths(style.widths);
	if (widths.length > 0) parts.push(`widths=${widths.map((width) => width ?? "").join(",")}`);
	return `<!-- ${parts.join(" ")} -->`;
}

/** Returns `null` when the text is not a table directive. Unknown or invalid values are ignored. */
export function parseDirective(html: string): TableStyle | null {
	const match = DIRECTIVE.exec(html.trim());
	if (match === null) return null;

	let color: TableColor | null = null;
	let widths: (number | null)[] = [];
	for (const part of (match[1] as string).trim().split(/\s+/)) {
		const [key, value = ""] = part.split("=");
		if (key === "color" && (TABLE_COLORS as readonly string[]).includes(value)) {
			color = value as TableColor;
		} else if (key === "widths") {
			widths = value.split(",").map((raw) => {
				const width = Number(raw);
				return raw.trim() === "" || !Number.isFinite(width) ? null : clampColumnWidth(width);
			});
		}
	}
	return { color, widths: trimWidths(widths) };
}

export interface ExtractedStyles {
	/** The Markdown without the directives. */
	readonly markdown: string;
	/** One entry per top-level table, in document order. */
	readonly styles: readonly TableStyle[];
}

/**
 * Takes the directives out of the text before the editor sees it; otherwise
 * each one would show up as a raw HTML block above its table.
 */
export function extractTableStyles(markdown: string): ExtractedStyles {
	const blocks = parse(markdown).children;
	const styles: TableStyle[] = [];
	const cuts: [number, number][] = [];

	for (const [i, block] of blocks.entries()) {
		if (block.type !== "table") continue;
		const previous = blocks[i - 1];
		const style = previous?.type === "html" ? parseDirective(previous.value) : null;
		const from = previous?.position?.start.offset;
		const to = block.position?.start.offset;
		if (style === null || from === undefined || to === undefined) {
			styles.push(NO_STYLE);
			continue;
		}
		styles.push(style);
		cuts.push([from, to]);
	}

	let out = "";
	let cursor = 0;
	for (const [from, to] of cuts) {
		out += markdown.slice(cursor, from);
		cursor = to;
	}
	return { markdown: out + markdown.slice(cursor), styles };
}

/** Puts a directive above every styled top-level table, ready to be serialized. */
export function injectTableStyles(
	doc: Root,
	styleOf: (table: Table) => TableStyle | undefined,
): Root {
	const children: Root["children"][number][] = [];
	let changed = false;
	for (const block of doc.children) {
		const style = block.type === "table" ? styleOf(block) : undefined;
		if (style !== undefined && !isPlain(style)) {
			children.push({ type: "html", value: formatDirective(style) });
			changed = true;
		}
		children.push(block);
	}
	return changed ? { ...doc, children: children as Root["children"] } : doc;
}

/** Assigns styles to the top-level tables of `doc`, in document order. */
export function styleByOrder(
	doc: Root,
	styles: readonly TableStyle[],
): (table: Table) => TableStyle | undefined {
	const tables = doc.children.filter((block) => block.type === "table");
	return (table) => {
		const index = tables.indexOf(table);
		return index === -1 ? undefined : styles[index];
	};
}

// --- HTML with the styles inlined ---------------------------------------------

/** Mixes `amount` of `color` into `base`; both are `#rrggbb`. */
export function mix(color: string, base: string, amount: number): string {
	const channel = (hex: string, i: number): number =>
		Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	let out = "#";
	for (let i = 0; i < 3; i++) {
		const value = Math.round(channel(color, i) * amount + channel(base, i) * (1 - amount));
		out += value.toString(16).padStart(2, "0");
	}
	return out;
}

function withStyle(node: RenderElement, css: string): RenderElement {
	if (css === "") return node;
	const own = node.attrs.find(([name]) => name === "style")?.[1];
	const attrs = node.attrs.filter(([name]) => name !== "style");
	return { ...node, attrs: [...attrs, ["style", own === undefined ? css : `${own};${css}`]] };
}

/**
 * Inline styles that reproduce the editor's look (style.css) where no
 * stylesheet comes along: Word, e-mail and exported HTML files.
 */
function styledTable(table: RenderElement, style: TableStyle): RenderElement {
	const value = style.color === null ? null : TABLE_COLOR_VALUES[style.color];
	const width = (column: number): string => {
		const px = style.widths[column] ?? null;
		return px === null ? "" : `width:${px}px;min-width:${px}px;max-width:${px}px`;
	};
	const cellCss = (cell: string, column: number): string =>
		[cell, width(column)].filter((part) => part !== "").join(";");

	const sections = table.children.map((section) => {
		if (section.kind !== "element") return section;
		const head = section.tag === "thead";
		let row = -1;
		return {
			...section,
			children: section.children.map((tr) => {
				if (tr.kind !== "element") return tr;
				row++;
				const tint = !head && row % 2 === 1;
				let column = -1;
				return {
					...tr,
					children: tr.children.map((cell) => {
						if (cell.kind !== "element") return cell;
						column++;
						let colors = "";
						if (value !== null && head) {
							colors = `background:${value};color:#fff;border-color:${value}`;
						} else if (value !== null) {
							colors = `border-color:${mix(value, "#d4d4d8", 0.45)}`;
							if (tint) colors += `;background:${mix(value, "#ffffff", 0.11)}`;
						}
						return withStyle(cell, cellCss(colors, column));
					}),
				};
			}),
		};
	});
	return { ...table, children: sections };
}

/**
 * Renders `doc` to HTML with the table styles written into the cells, so
 * they survive where Kalem's stylesheet does not go.
 */
export function renderStyledHtml(
	doc: Root,
	styleOf: (table: Table) => TableStyle | undefined,
): string {
	const tables = doc.children.filter((block) => block.type === "table");
	// A raw HTML block renders as `raw`, so top-level `<table>` elements match
	// the top-level Markdown tables one to one.
	let index = 0;
	const plan = buildPlan(doc).map((node) => {
		if (node.kind !== "element" || node.tag !== "table") return node;
		const table = tables[index++];
		const style = table === undefined ? undefined : styleOf(table);
		return style === undefined || isPlain(style) ? node : styledTable(node, style);
	});
	return stringifyPlan(plan);
}
