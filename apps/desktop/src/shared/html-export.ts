import type { Code, Root } from "@kalem-editor/core";
import { escapeHtml, parse } from "@kalem-editor/core";
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
.kalem-preview svg { max-width: 100%; height: auto; }
body { margin: 0 auto; max-width: 46rem; padding: 2.5rem 1.25rem 4rem; }
@media (prefers-color-scheme: dark) { html { background: #1a191f; } }
@media print { body { max-width: none; padding: 0; } }`;

export function buildHtmlDocument(options: HtmlExportOptions): string {
	const extracted = extractTableStyles(options.markdown);
	const doc = parse(extracted.markdown);
	const { preview } = options;
	const codes = preview === undefined ? [] : codeBlocks(doc);
	const body = renderStyledHtml(
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
