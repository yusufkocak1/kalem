/**
 * @kalem-editor/core — Text color
 *
 * Markdown has no syntax for colored text, so it is written as inline HTML:
 * `<span style="color:#c00">text</span>`. The parser turns exactly that shape
 * into a `color` node; any other `<span>` stays raw HTML.
 */
import type { Color, Inline } from "./ast.js";

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED = /^[a-z]{3,30}$/i;
const FUNCTIONAL = /^(?:rgb|hsl)a?\([0-9a-z.,%/\s+-]{1,64}\)$/i;

const OPEN_TAG = /^<span\s+style\s*=\s*(["'])\s*color\s*:\s*([^;"']+?)\s*;?\s*\1\s*>$/i;
const ANY_SPAN_OPEN = /^<span(?:\s[^>]*)?>$/i;
const SPAN_CLOSE = /^<\/span\s*>$/i;

/**
 * Returns the color if it is safe to put into a `style` attribute, else `null`.
 *
 * The value ends up in HTML the viewer emits even under `html: "escape"`, so
 * anything that could carry another declaration or a `url()` is rejected.
 */
export function sanitizeColor(value: string): string | null {
	const color = value.trim();
	return HEX.test(color) || NAMED.test(color) || FUNCTIONAL.test(color) ? color : null;
}

export function colorOpenTag(color: string): string {
	return `<span style="color:${color}">`;
}

export function colorOfOpenTag(tag: string): string | null {
	const match = OPEN_TAG.exec(tag);
	return match === null ? null : sanitizeColor(match[2] as string);
}

/** Pairs `<span style="color:…">` … `</span>` raw HTML nodes into `color` nodes. */
export function pairColors(nodes: readonly Inline[]): Inline[] {
	const out: Inline[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i] as Inline;
		const color = node.type === "html" ? colorOfOpenTag(node.value) : null;
		const close = color === null ? -1 : closingIndex(nodes, i + 1);
		if (node.type === "html" && color !== null && close !== -1) {
			const colored: Color = {
				type: "color",
				color,
				children: pairColors(nodes.slice(i + 1, close)),
				syntax: { open: node.value, close: (nodes[close] as { value: string }).value },
			};
			out.push(colored);
			i = close;
			continue;
		}
		out.push(withPairedChildren(node));
	}
	return out;
}

function withPairedChildren(node: Inline): Inline {
	if (!("children" in node) || !node.children.some((child) => child.type === "html")) return node;
	return { ...node, children: pairColors(node.children) } as Inline;
}

function closingIndex(nodes: readonly Inline[], from: number): number {
	let depth = 1;
	for (let i = from; i < nodes.length; i++) {
		const node = nodes[i] as Inline;
		if (node.type !== "html") continue;
		if (ANY_SPAN_OPEN.test(node.value)) depth++;
		else if (SPAN_CLOSE.test(node.value) && --depth === 0) return i;
	}
	return -1;
}
