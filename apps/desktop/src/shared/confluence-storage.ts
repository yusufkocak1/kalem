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

const CELL_BLOCKS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre"]);

interface ImportState {
	/** Languages of the code macros, in document order. */
	readonly languages: (string | null)[];
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

/** A table cell is one line in Markdown: its paragraphs run on with a space. */
function cell(node: MarkupElement, state: ImportState): HtmlNode {
	const children = node.children.flatMap((child): HtmlNode[] =>
		child.kind === "element" && CELL_BLOCKS.has(child.name)
			? [element("span", convertAll(child.children, state)), text(" ")]
			: convert(child, state),
	);
	return element(node.name, children);
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

function convert(node: MarkupNode, state: ImportState): HtmlNode[] {
	if (node.kind === "text") return [text(node.value)];
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

/** Converts Confluence storage format (or Confluence's exported HTML) to Markdown. */
export function storageToMarkdown(source: string): string {
	const state: ImportState = { languages: [] };
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

// --- Export -----------------------------------------------------------------

function cdata(value: string): string {
	return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

class StorageWriter {
	#definitions: Map<string, Definition>;
	#taskId = 0;

	constructor(doc: Root) {
		this.#definitions = definitionsOf(doc);
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

/** Converts Markdown (with Kalem's table style comments) to Confluence storage format. */
export function markdownToStorage(markdown: string): string {
	const doc = parse(extractTableStyles(markdown).markdown);
	const writer = new StorageWriter(doc);
	return writer.blocks(
		doc.children.filter((block) => block.type !== "yaml" && block.type !== "toml"),
	);
}
