import { escapeHtml, parse } from "@kalem-editor/core";
import { extractTableStyles, renderStyledHtml, styleByOrder } from "./table-style.js";

export interface HtmlExportOptions {
	/** May carry table style comments; they become inline styles. */
	readonly markdown: string;
	readonly title: string;
	readonly lang: string;
	/** Text of the Kalem theme stylesheets, inlined so the file is self-contained. */
	readonly css: string;
}

const PAGE_CSS = `html { color-scheme: light dark; }
body { margin: 0 auto; max-width: 46rem; padding: 2.5rem 1.25rem 4rem; }
@media (prefers-color-scheme: dark) { html { background: #1a191f; } }
@media print { body { max-width: none; padding: 0; } }`;

export function buildHtmlDocument(options: HtmlExportOptions): string {
	const extracted = extractTableStyles(options.markdown);
	const doc = parse(extracted.markdown);
	const body = renderStyledHtml(doc, styleByOrder(doc, extracted.styles));
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
