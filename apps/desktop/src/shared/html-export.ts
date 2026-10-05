import type { Code, Inline, Root } from "@kalem-editor/core";
import { escapeHtml, parse } from "@kalem-editor/core";
import type { Footnotes } from "./footnotes.js";
import {
	collectFootnotes,
	footnoteDefinitionLabel,
	referenceLabel,
	splitReferences,
} from "./footnotes.js";
import { extractTableStyles, renderStyledHtml, styleByOrder } from "./table-style.js";

export interface HtmlExportOptions {
	/** May carry table style comments; they become inline styles. */
	readonly markdown: string;
	readonly title: string;
	readonly lang: string;
	/** Text of the Kalem theme stylesheets, inlined so the file is self-contained. */
	readonly css: string;
	/** Markup that replaces a code block (a rendered diagram or formula), or `null` to keep it. */
	readonly preview?: (code: Code) => string | null;
}

const footnoteLink = (n: number): Inline => ({
	type: "link",
	url: `#kalem-fn-${n}`,
	title: null,
	children: [{ type: "text", value: String(n) }],
});

/** References become links to the notes; the definitions leave the body. */
function linkFootnotes(doc: Root, footnotes: Footnotes): Root {
	const number = (label: string): number => footnotes.order.indexOf(label) + 1;
	const inline = (nodes: readonly Inline[]): Inline[] =>
		nodes.flatMap((node): Inline[] => {
			if (node.type === "text") {
				return splitReferences(node.value, footnotes.notes).map((part) =>
					typeof part === "string"
						? { type: "text", value: part }
						: footnoteLink(number(part.label)),
				);
			}
			const label = referenceLabel(node, footnotes.notes);
			if (label !== null) return [footnoteLink(number(label))];
			return "children" in node ? [{ ...node, children: inline(node.children) } as Inline] : [node];
		});
	const visit = <T>(node: T): T => {
		const value = node as { type?: string; children?: readonly unknown[] };
		if (!Array.isArray(value.children)) return node;
		const inlineParent = ["paragraph", "heading", "tableCell"].includes(value.type ?? "");
		return {
			...node,
			children: inlineParent ? inline(value.children as Inline[]) : value.children.map(visit),
		} as T;
	};
	return visit({
		...doc,
		children: doc.children.filter((block) => footnoteDefinitionLabel(block) === null),
	});
}

/** The numbered notes after the body, each with a link back to its first reference. */
function footnoteSection(footnotes: Footnotes): string {
	const items = footnotes.order.map((label, i) => {
		const note: Root = {
			type: "root",
			children: [{ type: "paragraph", children: [...(footnotes.notes.get(label) ?? [])] }],
		};
		const html = renderStyledHtml(linkFootnotes(note, footnotes), () => undefined)
			.trim()
			.replace(/^<p>|<\/p>$/g, "");
		const n = i + 1;
		return `<li id="kalem-fn-${n}">${html} <a href="#kalem-fnref-${n}" aria-label="↩">↩</a></li>`;
	});
	return `<section class="kalem-footnotes"><hr><ol>${items.join("")}</ol></section>`;
}

/** Every code block, nested ones included, in document order. */
export function codeBlocks(doc: Root): Code[] {
	const found: Code[] = [];
	const visit = (node: { type?: string; children?: readonly unknown[] }): void => {
		if (node.type === "code") found.push(node as Code);
		for (const child of node.children ?? []) visit(child as typeof node);
	};
	visit(doc);
	return found;
}

const PAGE_CSS = `html { color-scheme: light dark; }
.kalem-preview { margin: 1em 0; overflow-x: auto; }
.kalem-footnotes { margin-top: 3em; font-size: 0.9em; }
.kalem-footnotes a[aria-label] { text-decoration: none; }
.kalem-preview svg { max-width: 100%; height: auto; }
body { margin: 0 auto; max-width: 46rem; padding: 2.5rem 1.25rem 4rem; }
@media (prefers-color-scheme: dark) { html { background: #1a191f; } }
@media print { body { max-width: none; padding: 0; } }`;

export function buildHtmlDocument(options: HtmlExportOptions): string {
	const extracted = extractTableStyles(options.markdown);
	const parsed = parse(extracted.markdown);
	const footnotes = collectFootnotes(parsed);
	const doc = footnotes.order.length === 0 ? parsed : linkFootnotes(parsed, footnotes);
	const { preview } = options;
	const codes = preview === undefined ? [] : codeBlocks(doc);
	const rendered = renderStyledHtml(
		doc,
		styleByOrder(doc, extracted.styles),
		preview === undefined
			? undefined
			: (index) => {
					const code = codes[index];
					if (code === undefined) return null;
					const html = preview(code);
					return html === null ? null : `<figure class="kalem-preview">${html}</figure>`;
				},
	);
	const body =
		footnotes.order.length === 0
			? rendered
			: rendered.replace(
					/<a href="#kalem-fn-(\d+)">\1<\/a>/g,
					'<sup id="kalem-fnref-$1"><a href="#kalem-fn-$1">$1</a></sup>',
				) + footnoteSection(footnotes);
	return `<!doctype html>
<html lang="${escapeHtml(options.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Kalem">
<title>${escapeHtml(options.title)}</title>
<style>
${options.css}
${PAGE_CSS}
</style>
</head>
<body class="kalem-doc kalem-theme">
${body}
</body>
</html>
`;
}
