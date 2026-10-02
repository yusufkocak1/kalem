import type { Root, Table } from "@kalem-editor/core";
import { parse } from "@kalem-editor/core";

export const TABLE_COLORS = ["gray", "blue", "teal", "green", "orange", "red", "purple"] as const;
export type TableColor = (typeof TABLE_COLORS)[number];

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
