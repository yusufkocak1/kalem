import type {
	Block,
	Blockquote,
	Code,
	Definition,
	Inline,
	List,
	ListItem,
	Root,
	Table,
} from "@kalem-editor/core";
import { escapeHtml, parse, serialize } from "@kalem-editor/core";
import type { HtmlNode } from "@kalem-editor/core/html";
import { fromHtml } from "@kalem-editor/core/html";
import {
	attachmentName,
	definitionsOf,
	fileUrl,
	fromConfluenceLanguage,
	PANEL_ICONS,
	panelKind,
	quotePanel,
	toConfluenceLanguage,
} from "./confluence-common.js";
import type { MarkupElement, MarkupNode } from "./confluence-markup.js";
import { childElements, parseMarkup, textOf } from "./confluence-markup.js";
import { extractTableStyles } from "./table-style.js";

// --- Import -----------------------------------------------------------------

function text(value: string): HtmlNode {
	return { nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] };
}

function element(
	name: string,
	children: readonly HtmlNode[],
	attrs: Readonly<Record<string, string>> = {},
): HtmlNode {
	return {
		nodeType: 1,
		// kalem-locale-ok: tag names are ASCII
		nodeName: name.toUpperCase(),
		get textContent() {
			return children.map((child) => child.textContent ?? "").join("");
		},
		childNodes: children,
		getAttribute: (attr) => attrs[attr] ?? null,
	};
}

const EMOTICONS: Readonly<Record<string, string>> = {
	smile: "🙂",
	sad: "🙁",
	cheeky: "😛",
	laugh: "😀",
	wink: "😉",
	"thumbs-up": "👍",
	"thumbs-down": "👎",
	information: "ℹ️",
	tick: "✅",
	cross: "❌",
	warning: "⚠️",
	plus: "➕",
	minus: "➖",
	question: "❓",
	"light-on": "💡",
	"light-off": "💡",
	"yellow-star": "⭐",
	"red-star": "⭐",
	"green-star": "⭐",
	"blue-star": "⭐",
	heart: "❤️",
	"broken-heart": "💔",
};

interface ImportState {
	/** Languages of the code macros, in document order. */
	readonly languages: (string | null)[];
	/** The source the elements' ranges point into. */
	readonly source: string;
	/** Inline atoms become kept links (see `atomKind`) instead of plain text. */
	readonly atoms: boolean;
}

/** FNV-1a of the text: the same key for the same XML on every import. */
export function hash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

/** The link target of a kept inline atom; its XML is written back in its place. */
export const ATOM_PREFIX = "#confluence-keep-";

export type AtomKind = "mention" | "page-link" | "date" | "macro";

/**
 * Inline pieces Markdown has no form for but that sit in running text: a
 * mention, a link to another page, a date, an inline macro without a body
 * (status, Jira issue, anchor…). They are kept as they are when the
 * paragraph around them is edited.
 */
export function atomKind(node: MarkupElement): AtomKind | null {
	if (node.name === "time") return "date";
	if (node.name === "ac:link") {
		if (childElements(node, "ri:user").length > 0) return "mention";
		const target = childElements(node).some((child) =>
			["ri:page", "ri:blog-post", "ri:space"].includes(child.name),
		);
		return target ? "page-link" : null;
	}
	if (node.name === "ac:structured-macro" || node.name === "ac:macro") {
		// kalem-locale-ok: macro names are ASCII
		const name = (node.attrs.get("ac:name") ?? "").toLowerCase();
		if (KEPT_MACROS.has(name) || panelKind(name) !== null || name === "expand") return null;
		return childElements(node, "ac:rich-text-body").length === 0 ? "macro" : null;
	}
	return null;
}

function parameters(macro: MarkupElement): Map<string, string> {
	const params = new Map<string, string>();
	for (const param of childElements(macro, "ac:parameter")) {
		params.set(param.attrs.get("ac:name") ?? "", textOf(param).trim());
	}
	return params;
}

function convertAll(nodes: readonly MarkupNode[], state: ImportState): HtmlNode[] {
	return nodes.flatMap((node) => convert(node, state));
}

function macro(node: MarkupElement, state: ImportState): HtmlNode[] {
	// kalem-locale-ok: macro names are ASCII
	const name = (node.attrs.get("ac:name") ?? "").toLowerCase();
	const params = parameters(node);
	const body = childElements(node, "ac:rich-text-body")[0];
	const plain = childElements(node, "ac:plain-text-body")[0];

	if (name === "code" || name === "noformat") {
		state.languages.push(name === "code" ? fromConfluenceLanguage(params.get("language")) : null);
		return [element("pre", [text(plain === undefined ? "" : textOf(plain))])];
	}

	const kind = panelKind(name);
	if (kind !== null || name === "expand") {
		const children = body === undefined ? [] : convertAll(body.children, state);
		const title = params.get("title") ?? "";
		const icon = kind === null || kind === "panel" ? null : PANEL_ICONS[kind];
		if (title !== "") {
			const label = icon === null ? title : `${icon} ${title}`;
			children.unshift(element("p", [element("strong", [text(label)])]));
		} else if (icon !== null) {
			const index = children.findIndex((child) => child.nodeType === 1);
			const first = children[index];
			if (first !== undefined && first.nodeName === "P") {
				children[index] = element("p", [text(`${icon} `), ...Array.from(first.childNodes)]);
			} else {
				children.unshift(element("p", [text(icon)]));
			}
		}
		return [element("blockquote", children)];
	}

	if (name === "status") return [text(params.get("title") ?? "")];
	if (name === "jira") return [text(params.get("key") ?? "")];
	if (body !== undefined) return [element("div", convertAll(body.children, state))];
	if (plain !== undefined) return [element("pre", [text(textOf(plain))])];
	return [];
}

function task(node: MarkupElement, state: ImportState): HtmlNode {
	const status = textOf(childElements(node, "ac:task-status")[0] ?? { kind: "text", value: "" });
	const body = childElements(node, "ac:task-body")[0];
	const checkbox = element(
		"input",
		[],
		status.trim() === "complete" ? { type: "checkbox", checked: "" } : { type: "checkbox" },
	);
	return element("li", [checkbox, ...(body === undefined ? [] : convertAll(body.children, state))]);
}

function image(node: MarkupElement): HtmlNode[] {
	const url = childElements(node, "ri:url")[0]?.attrs.get("ri:value");
	const file = childElements(node, "ri:attachment")[0]?.attrs.get("ri:filename");
	const src = url ?? (file === undefined ? undefined : fileUrl(file));
	if (src === undefined) return [];
	const alt = node.attrs.get("ac:alt") ?? node.attrs.get("ac:title") ?? file ?? "";
	return [element("img", [], { src, alt })];
}

function link(node: MarkupElement, state: ImportState): HtmlNode[] {
	const page = childElements(node, "ri:page")[0];
	const file = childElements(node, "ri:attachment")[0]?.attrs.get("ri:filename");
	const url = childElements(node, "ri:url")[0]?.attrs.get("ri:value");
	const user = childElements(node, "ri:user")[0];
	const anchor = node.attrs.get("ac:anchor");

	const richBody = childElements(node, "ac:link-body")[0];
	const plainBody = childElements(node, "ac:plain-text-link-body")[0];
	let body: HtmlNode[] =
		richBody !== undefined
			? convertAll(richBody.children, state)
			: plainBody !== undefined
				? [text(textOf(plainBody))]
				: [];
	if (body.length === 0) {
		const fallback = user
			? `@${user.attrs.get("ri:username") ?? user.attrs.get("ri:userkey") ?? ""}`
			: (page?.attrs.get("ri:content-title") ?? file ?? url ?? anchor ?? "");
		body = [text(fallback)];
	}

	const href =
		url ??
		(file !== undefined
			? fileUrl(file)
			: page === undefined && user === undefined && anchor !== undefined
				? `#${anchor}`
				: null);
	return href === null ? [element("span", body)] : [element("a", body, { href })];
}

/** The cell's paragraphs and list items become lines of the Markdown cell (`<br>`). */
function cell(node: MarkupElement, state: ImportState): HtmlNode {
	return element(node.name, convertAll(node.children, state));
}

/** GFM tables have no merged cells: a spanned cell is followed by empty ones. */
function row(node: MarkupElement, state: ImportState): HtmlNode {
	const cells = childElements(node).flatMap((child): HtmlNode[] => {
		if (child.name !== "td" && child.name !== "th") return [];
		const span = Math.min(Math.max(1, Number(child.attrs.get("colspan") ?? 1) || 1), 64);
		return [cell(child, state), ...Array.from({ length: span - 1 }, () => element("td", []))];
	});
	return element("tr", cells);
}

/** A kept atom: a link whose target names its XML, showing what the atom shows. */
function atom(node: MarkupElement, state: ImportState): HtmlNode[] {
	const shown = plain(node, state).replace(/\s+/g, " ").trim();
	// kalem-locale-ok: macro names are ASCII
	const label =
		shown !== "" ? shown : `⟨${(node.attrs.get("ac:name") ?? node.name).toLowerCase()}⟩`;
	const href = ATOM_PREFIX + hash(state.source.slice(node.start, node.end));
	return [element("a", [text(label)], { href })];
}

/** What the element reads as when it is not kept. */
function plain(node: MarkupElement, state: ImportState): string {
	return convertElement(node, { ...state, atoms: false })
		.map((child) => child.textContent ?? "")
		.join("");
}

function convert(node: MarkupNode, state: ImportState): HtmlNode[] {
	if (node.kind === "text") return [text(node.value)];
	if (state.atoms && atomKind(node) !== null) return atom(node, state);
	return convertElement(node, state);
}

function convertElement(node: MarkupElement, state: ImportState): HtmlNode[] {
	const { name } = node;
	switch (name) {
		case "ac:structured-macro":
		case "ac:macro":
			return macro(node, state);
		case "ac:task-list":
			return [
				element(
					"ul",
					childElements(node, "ac:task").map((child) => task(child, state)),
				),
			];
		case "ac:image":
			return image(node);
		case "ac:link":
			return link(node, state);
		case "ac:emoticon":
			return [
				text(
					node.attrs.get("ac:emoji-fallback") ?? EMOTICONS[node.attrs.get("ac:name") ?? ""] ?? "",
				),
			];
		case "ac:parameter":
		case "ac:placeholder":
		case "ac:task-id":
			return [];
		case "time":
			return [text(node.attrs.get("datetime") ?? textOf(node))];
		case "tr":
			return [row(node, state)];
		default:
			if (name.startsWith("ri:")) return [];
			if (name.startsWith("ac:")) return [element("div", convertAll(node.children, state))];
			return [element(name, convertAll(node.children, state), Object.fromEntries(node.attrs))];
	}
}

function codeBlocks(doc: Root): Code[] {
	const found: Code[] = [];
	const visit = (node: { type?: string; children?: readonly unknown[] }): void => {
		if (node.type === "code") found.push(node as Code);
		for (const child of node.children ?? []) visit(child as typeof node);
	};
	visit(doc);
	return found;
}

/**
 * Converts Confluence storage format (or Confluence's exported HTML) to Markdown.
 * With `atoms`, inline atoms become kept links (`ATOM_PREFIX`); `markdownToStorage`
 * writes their XML back when it is given them.
 */
export function storageToMarkdown(source: string, options: { atoms?: boolean } = {}): string {
	const state: ImportState = { languages: [], source, atoms: options.atoms === true };
	const root = parseMarkup(source);
	const body = childElements(root, "html")[0]?.children.find(
		(child): child is MarkupElement => child.kind === "element" && child.name === "body",
	);
	const doc = fromHtml(element("body", convertAll((body ?? root).children, state)));
	const codes = codeBlocks(doc);
	// A code block that landed in a table cell is no longer a block; then the order is lost.
	if (codes.length === state.languages.length) {
		for (const [i, code] of codes.entries()) code.lang = state.languages[i] ?? null;
	}
	return serialize(doc);
}

/** Macros that survive a trip through Markdown. */
export const KEPT_MACROS = new Set(["code", "noformat", "info", "note", "warning", "tip"]);
/** Column widths and table styling are layout, not content worth a warning. */
const TABLE_PARTS = new Set(["table", "colgroup", "col", "tbody", "thead", "tr", "td", "th"]);
const STYLE_KEPT = /^\s*(text-decoration:\s*line-through|color:\s*[^;]+|text-align:\s*\w+);?\s*$/i;

/**
 * What a page would lose by being saved back from Markdown: `macro:<name>`,
 * `layout`, `mention`, `page-link`, `inline-comment`, `merged-cells`,
 * `cell-blocks`, `formatting`, `image-size`, `date`.
 */
export function storageLosses(source: string, options: { atoms?: boolean } = {}): string[] {
	const found = new Set<string>();
	const visit = (node: MarkupNode, inCell: boolean): void => {
		if (node.kind === "text") return;
		// Kept atoms lose nothing, nor does anything inside them.
		if (options.atoms === true && atomKind(node) !== null) return;
		const { name, attrs } = node;
		if (name === "ac:structured-macro" || name === "ac:macro") {
			// kalem-locale-ok: macro names are ASCII
			const macro = (attrs.get("ac:name") ?? "").toLowerCase();
			if (!KEPT_MACROS.has(macro)) found.add(`macro:${macro}`);
			if (inCell) found.add("cell-blocks");
		} else if (name.startsWith("ac:layout")) found.add("layout");
		else if (name === "ri:user") found.add("mention");
		else if (name === "ri:page" || name === "ri:blog-post" || name === "ri:space") {
			found.add("page-link");
		} else if (name === "ac:inline-comment-marker") found.add("inline-comment");
		else if (name === "ac:image" && (attrs.has("ac:width") || attrs.has("ac:height"))) {
			found.add("image-size");
		} else if (name === "time") found.add("date");
		else if (["u", "sup", "sub", "ins", "small", "big"].includes(name)) found.add("formatting");
		else if (
			attrs.has("style") &&
			!TABLE_PARTS.has(name) &&
			!STYLE_KEPT.test(attrs.get("style") ?? "")
		) {
			found.add("formatting");
		} else if (name === "td" || name === "th") {
			if (Number(attrs.get("colspan") ?? 1) > 1 || Number(attrs.get("rowspan") ?? 1) > 1) {
				found.add("merged-cells");
			}
			// Paragraphs come back as lines; lists, code and nested tables do not.
			const nested = childElements(node).some((child) =>
				["ul", "ol", "table", "ac:task-list", "blockquote", "pre"].includes(child.name),
			);
			if (nested) found.add("cell-blocks");
			for (const child of node.children) visit(child, true);
			return;
		} else if (inCell && ["ul", "ol", "pre", "table", "ac:task-list"].includes(name)) {
			found.add("cell-blocks");
		}
		for (const child of node.children) visit(child, inCell);
	};
	visit(parseMarkup(source), false);
	return [...found];
}

// --- Export -----------------------------------------------------------------

function cdata(value: string): string {
	return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

class StorageWriter {
	#definitions: Map<string, Definition>;
	#atoms: ReadonlyMap<string, string>;
	#taskId = 0;

	constructor(doc: Root, atoms: ReadonlyMap<string, string>) {
		this.#definitions = definitionsOf(doc);
		this.#atoms = atoms;
	}

	blocks(blocks: readonly (Block | { type: string })[]): string {
		return blocks.map((block) => this.block(block as Block)).join("");
	}

	block(block: Block): string {
		switch (block.type) {
			case "heading":
				return `<h${block.depth}>${this.inlines(block.children)}</h${block.depth}>`;
			case "paragraph":
				return `<p>${this.inlines(block.children)}</p>`;
			case "blockquote":
				return this.quote(block);
			case "list":
				return this.list(block);
			case "code":
				return this.code(block);
			case "thematicBreak":
				return "<hr />";
			case "table":
				return this.table(block);
			case "html":
				return block.value.trimStart().startsWith("<!--")
					? ""
					: `<p>${escapeHtml(block.value)}</p>`;
			default:
				return "";
		}
	}

	quote(quote: Blockquote): string {
		const panel = quotePanel(quote);
		if (panel === null) return `<blockquote>${this.blocks(quote.children)}</blockquote>`;
		const title =
			panel.title === null
				? ""
				: `<ac:parameter ac:name="title">${escapeHtml(panel.title)}</ac:parameter>`;
		return `<ac:structured-macro ac:name="${panel.kind}">${title}<ac:rich-text-body>${this.blocks(panel.children)}</ac:rich-text-body></ac:structured-macro>`;
	}

	code(code: Code): string {
		const lang = toConfluenceLanguage(code.lang);
		const param =
			lang === null ? "" : `<ac:parameter ac:name="language">${escapeHtml(lang)}</ac:parameter>`;
		const value = code.value.endsWith("\n") ? code.value.slice(0, -1) : code.value;
		return `<ac:structured-macro ac:name="code">${param}<ac:plain-text-body>${cdata(value)}</ac:plain-text-body></ac:structured-macro>`;
	}

	/** A tight list item's paragraphs carry no `<p>`, as Confluence writes them. */
	itemContent(item: ListItem, tight: boolean): string {
		return item.children
			.map((child) =>
				tight && child.type === "paragraph" ? this.inlines(child.children) : this.block(child),
			)
			.join("");
	}

	list(list: List): string {
		const tight = !list.spread;
		if (!list.ordered && list.children.every((item) => item.checked !== null)) {
			const tasks = list.children.map((item) => {
				const status = item.checked === true ? "complete" : "incomplete";
				return `<ac:task><ac:task-id>${++this.#taskId}</ac:task-id><ac:task-status>${status}</ac:task-status><ac:task-body>${this.itemContent(item, true)}</ac:task-body></ac:task>`;
			});
			return `<ac:task-list>${tasks.join("")}</ac:task-list>`;
		}
		const tag = list.ordered ? "ol" : "ul";
		const start =
			list.ordered && list.start !== null && list.start !== 1 ? ` start="${list.start}"` : "";
		const items = list.children.map((item) => `<li>${this.itemContent(item, tight)}</li>`);
		return `<${tag}${start}>${items.join("")}</${tag}>`;
	}

	table(table: Table): string {
		const rows = table.children.map((row, r) => {
			const tag = r === 0 ? "th" : "td";
			const cells = row.children.map((cell, c) => {
				const align = table.align[c];
				const style = align == null ? "" : ` style="text-align: ${align};"`;
				return `<${tag}${style}>${this.inlines(cell.children)}</${tag}>`;
			});
			return `<tr>${cells.join("")}</tr>`;
		});
		return `<table><tbody>${rows.join("")}</tbody></table>`;
	}

	inlines(nodes: readonly Inline[]): string {
		return nodes.map((node) => this.inline(node)).join("");
	}

	image(url: string, alt: string | null): string {
		const file = attachmentName(url);
		const target =
			file === null
				? `<ri:url ri:value="${escapeHtml(url)}" />`
				: `<ri:attachment ri:filename="${escapeHtml(file)}" />`;
		const altAttr = alt === null || alt === "" ? "" : ` ac:alt="${escapeHtml(alt)}"`;
		return `<ac:image${altAttr}>${target}</ac:image>`;
	}

	link(url: string, title: string | null, children: readonly Inline[]): string {
		if (url.startsWith(ATOM_PREFIX)) {
			// A kept atom goes back as it was; one this page never had is its text.
			return this.#atoms.get(url) ?? this.inlines(children);
		}
		const file = attachmentName(url);
		if (file !== null && /\.[a-z0-9]+$/i.test(file) && !/\.(md|markdown|html?)$/i.test(file)) {
			return `<ac:link><ri:attachment ri:filename="${escapeHtml(file)}" /><ac:link-body>${this.inlines(children)}</ac:link-body></ac:link>`;
		}
		const titleAttr = title === null ? "" : ` title="${escapeHtml(title)}"`;
		return `<a href="${escapeHtml(url)}"${titleAttr}>${this.inlines(children)}</a>`;
	}

	inline(node: Inline): string {
		switch (node.type) {
			case "text":
				return escapeHtml(node.value);
			case "strong":
				return `<strong>${this.inlines(node.children)}</strong>`;
			case "emphasis":
				return `<em>${this.inlines(node.children)}</em>`;
			case "delete":
				return `<span style="text-decoration: line-through;">${this.inlines(node.children)}</span>`;
			case "inlineCode":
				return `<code>${escapeHtml(node.value)}</code>`;
			case "link":
				return this.link(node.url, node.title, node.children);
			case "image":
				return this.image(node.url, node.alt);
			case "linkReference": {
				const definition = this.#definitions.get(node.identifier);
				return definition === undefined
					? `[${this.inlines(node.children)}]`
					: this.link(definition.url, definition.title, node.children);
			}
			case "imageReference": {
				const definition = this.#definitions.get(node.identifier);
				return definition === undefined
					? escapeHtml(`![${node.alt ?? ""}]`)
					: this.image(definition.url, node.alt);
			}
			case "color":
				return `<span style="color: ${escapeHtml(node.color)};">${this.inlines(node.children)}</span>`;
			case "break":
				return "<br />";
			case "html":
				return escapeHtml(node.value);
			default:
				return "";
		}
	}
}

/**
 * Converts Markdown (with Kalem's table style comments) to Confluence storage format.
 * `atoms` maps kept atom links to their XML.
 */
export function markdownToStorage(
	markdown: string,
	atoms: ReadonlyMap<string, string> = new Map(),
): string {
	const doc = parse(extractTableStyles(markdown).markdown);
	const writer = new StorageWriter(doc, atoms);
	return writer.blocks(
		doc.children.filter((block) => block.type !== "yaml" && block.type !== "toml"),
	);
}
