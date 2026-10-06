import type {
	Block,
	Blockquote,
	Definition,
	Inline,
	List,
	ListItem,
	Root,
	Table,
	TableCell,
} from "@kalem-editor/core";
import { isSafeUrl, parse, sanitizeColor, serialize } from "@kalem-editor/core";
import {
	definitionsOf,
	fileUrl,
	fromConfluenceLanguage,
	panelKind,
	panelQuote,
	quotePanel,
	toConfluenceLanguage,
} from "./confluence-common.js";
import { decodeEntities } from "./confluence-markup.js";
import { extractTableStyles } from "./table-style.js";

// --- Import: inline ---------------------------------------------------------

const ICONS: Readonly<Record<string, string>> = {
	"(/)": "✅",
	"(x)": "❌",
	"(!)": "⚠️",
	"(i)": "ℹ️",
	"(?)": "❓",
	"(y)": "👍",
	"(n)": "👎",
	"(on)": "💡",
	"(off)": "💡",
	"(*)": "⭐",
	"(+)": "➕",
	"(-)": "➖",
};

type Mark = "strong" | "emphasis" | "delete" | null;

/** Wiki markers and what they mean in Markdown; underline, super- and subscript have no equivalent. */
const MARKERS: Readonly<Record<string, Mark>> = {
	"*": "strong",
	_: "emphasis",
	"??": "emphasis",
	"-": "delete",
	"+": null,
	"^": null,
	"~": null,
};

const isWordChar = (ch: string | undefined): boolean =>
	ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

function mergeText(nodes: Inline[]): Inline[] {
	const out: Inline[] = [];
	for (const node of nodes) {
		const last = out[out.length - 1];
		if (node.type === "text" && last?.type === "text") {
			out[out.length - 1] = { type: "text", value: last.value + node.value };
		} else if (node.type !== "text" || node.value !== "") {
			out.push(node);
		}
	}
	return out;
}

const unescapeWiki = (value: string): string => value.replace(/\\(.)/g, "$1");

/** Index of the `close` that ends a `[` or `{`, skipping escapes; -1 if none. */
function findClose(text: string, from: number, close: string): number {
	for (let i = from; i < text.length; i++) {
		if (text[i] === "\\") i++;
		else if (text[i] === close) return i;
		else if (text[i] === "\n") return -1;
	}
	return -1;
}

/** `{*}bold{*}` is the intraword form of a marker. */
function markerAt(
	text: string,
	i: number,
): { marker: string; length: number; forced: boolean } | null {
	if (text[i] === "{" && text[i + 2] === "}" && (text[i + 1] ?? "") in MARKERS) {
		return { marker: text[i + 1] as string, length: 3, forced: true };
	}
	if (text.startsWith("??", i)) return { marker: "??", length: 2, forced: false };
	const ch = text[i] as string;
	return ch !== "?" && ch in MARKERS ? { marker: ch, length: 1, forced: false } : null;
}

function closingMarker(text: string, from: number, marker: string, forced: boolean): number {
	const forcedForm = `{${marker}}`;
	for (let j = from; j < text.length; j++) {
		if (text[j] === "\\") {
			j++;
			continue;
		}
		if (text[j] === "\n") return -1;
		if (forced) {
			if (text.startsWith(forcedForm, j)) return j;
			continue;
		}
		if (
			j > from &&
			text.startsWith(marker, j) &&
			!isSpace(text[j - 1]) &&
			!isWordChar(text[j + marker.length])
		) {
			return j;
		}
		if (text.startsWith(forcedForm, j) && j > from) return j;
	}
	return -1;
}

function linkFrom(content: string): Inline[] {
	const parts: string[] = [];
	let current = "";
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\\" && i + 1 < content.length) {
			current += content.slice(i, i + 2);
			i++;
		} else if (content[i] === "|" && parts.length < 2) {
			parts.push(current);
			current = "";
		} else {
			current += content[i];
		}
	}
	parts.push(current);
	const [first = "", second] = parts;
	const label = second === undefined ? "" : first.trim();
	const target = unescapeWiki((second ?? first).trim());
	const children = (fallback: string): Inline[] =>
		label === "" ? [{ type: "text", value: fallback }] : parseInline(label);

	if (target.startsWith("~")) return children(`@${target.slice(1)}`);
	let url: string | null = null;
	if (target.startsWith("^")) url = fileUrl(target.slice(1));
	else if (target.startsWith("#")) url = target;
	else if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[A-Z0-9]+:[^/]/.test(target)) url = target;
	// A page in this or another space (`Page title`, `SPACE:Page`): no address to link to.
	if (url === null || !isSafeUrl(url)) return children(target.replace(/^\^/, ""));
	return [{ type: "link", url, title: null, children: children(target.replace(/^\^/, "")) }];
}

function imageFrom(content: string): Inline[] {
	const [src = "", ...params] = content.split("|");
	const source = src.trim();
	const url = /^[a-z][a-z0-9+.-]*:/i.test(source) ? source : fileUrl(source);
	if (!isSafeUrl(url, { image: true })) return [];
	const alt = params
		.join("|")
		.split(",")
		.map((param) => /^\s*alt\s*=\s*"?([^"]*)"?\s*$/i.exec(param)?.[1])
		.find((value) => value !== undefined);
	return [{ type: "image", url, alt: alt ?? null, title: null }];
}

export function parseInline(text: string): Inline[] {
	const out: Inline[] = [];
	let buffer = "";
	const flush = (): void => {
		if (buffer !== "") out.push({ type: "text", value: decodeEntities(buffer) });
		buffer = "";
	};

	let i = 0;
	while (i < text.length) {
		const ch = text[i] as string;
		const prev = text[i - 1];

		if (ch === "\\") {
			if (text[i + 1] === "\\") {
				flush();
				out.push({ type: "break" });
				i += 2;
			} else {
				buffer += text[i + 1] ?? ch;
				i += 2;
			}
			continue;
		}

		if (text.startsWith("{{", i)) {
			const end = text.indexOf("}}", i + 2);
			if (end > i + 2) {
				flush();
				out.push({ type: "inlineCode", value: unescapeWiki(text.slice(i + 2, end)) });
				i = end + 2;
				continue;
			}
		}

		if (text.startsWith("{color:", i)) {
			const open = text.indexOf("}", i);
			const close = open === -1 ? -1 : text.indexOf("{color}", open);
			if (close !== -1) {
				const children = parseInline(text.slice(open + 1, close));
				const color = sanitizeColor(text.slice(i + 7, open).trim());
				flush();
				out.push(...(color === null ? children : [{ type: "color" as const, color, children }]));
				i = close + 7;
				continue;
			}
		}

		if (ch === "[") {
			const end = findClose(text, i + 1, "]");
			if (end > i + 1) {
				flush();
				out.push(...linkFrom(text.slice(i + 1, end)));
				i = end + 1;
				continue;
			}
		}

		if (ch === "!" && !isSpace(text[i + 1])) {
			const end = text.indexOf("!", i + 1);
			const content = end === -1 ? "" : text.slice(i + 1, end);
			if (content !== "" && !content.includes("\n") && !isSpace(content[content.length - 1])) {
				flush();
				out.push(...imageFrom(content));
				i = end + 1;
				continue;
			}
		}

		if (ch === "(") {
			const icon = Object.keys(ICONS).find((key) => text.startsWith(key, i));
			if (icon !== undefined) {
				buffer += ICONS[icon];
				i += icon.length;
				continue;
			}
		}

		const found = markerAt(text, i);
		if (found !== null && (found.forced || !isWordChar(prev)) && !isSpace(text[i + found.length])) {
			const end = closingMarker(text, i + found.length, found.marker, found.forced);
			if (end !== -1) {
				const closeLength = text.startsWith(`{${found.marker}}`, end) ? 3 : found.marker.length;
				const children = parseInline(text.slice(i + found.length, end));
				const mark = MARKERS[found.marker] ?? null;
				flush();
				out.push(...(mark === null ? children : [{ type: mark, children } as Inline]));
				i = end + closeLength;
				continue;
			}
		}

		buffer += ch;
		i++;
	}
	flush();
	return mergeText(out);
}

function inlineLines(lines: readonly string[]): Inline[] {
	const out: Inline[] = [];
	for (const [i, line] of lines.entries()) {
		if (i > 0) out.push({ type: "break" });
		out.push(...parseInline(line.trim()));
	}
	return mergeText(out);
}

// --- Import: blocks ---------------------------------------------------------

const MACRO = /^\{(code|noformat|quote|panel|info|note|warning|tip|expand)(?::([^}]*))?\}(.*)$/i;
const HEADING = /^h([1-6])\.\s*(.*)$/;
const QUOTE_LINE = /^bq\.\s*(.*)$/;
const RULE = /^-{4,}$/;
const LIST_ITEM = /^([*#]+|-)\s+(.*)$/;
const TABLE_ROW = /^\|/;

function macroParams(source: string | undefined): Map<string, string> {
	const params = new Map<string, string>();
	if (source === undefined) return params;
	for (const [i, part] of source.split("|").entries()) {
		const eq = part.indexOf("=");
		// kalem-locale-ok: parameter names are ASCII
		if (eq !== -1) params.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
		else if (i === 0 && part.trim() !== "") params.set("", part.trim());
	}
	return params;
}

interface WikiItem {
	readonly depth: number;
	readonly ordered: boolean;
	text: string;
}

function listItem(text: string): ListItem {
	const task = /^\((\/| )\)\s+/.exec(text);
	const children = parseInline(task === null ? text : text.slice(task[0].length));
	return {
		type: "listItem",
		checked: task === null ? null : task[1] === "/",
		spread: false,
		children: [{ type: "paragraph", children }],
	};
}

function buildList(items: readonly WikiItem[], from: number, depth: number): [List, number] {
	const ordered = items[from]?.ordered ?? false;
	const list: List = {
		type: "list",
		ordered,
		start: ordered ? 1 : null,
		spread: false,
		children: [],
	};
	let i = from;
	while (i < items.length) {
		const item = items[i] as WikiItem;
		if (item.depth < depth) break;
		if (item.depth === depth) {
			if (item.ordered !== ordered && list.children.length > 0) break;
			list.children.push(listItem(item.text));
			i++;
			continue;
		}
		const [nested, next] = buildList(items, i, depth + 1);
		let parent = list.children[list.children.length - 1];
		if (parent === undefined) {
			parent = { type: "listItem", checked: null, spread: false, children: [] };
			list.children.push(parent);
		}
		parent.children.push(nested);
		i = next;
	}
	return [list, i];
}

function splitCells(line: string): { header: boolean; cells: string[] } {
	const trimmed = line.trim();
	const header = trimmed.startsWith("||");
	const body = trimmed.replace(/^\|\|?/, "").replace(/(?<!\\)\|\|?$/, "");
	const cells: string[] = [];
	let current = "";
	let square = 0;
	let curly = 0;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i] as string;
		if (ch === "\\" && i + 1 < body.length) {
			current += body.slice(i, i + 2);
			i++;
			continue;
		}
		if (ch === "[") square++;
		else if (ch === "]") square = Math.max(0, square - 1);
		else if (ch === "{") curly++;
		else if (ch === "}") curly = Math.max(0, curly - 1);
		if (ch === "|" && square === 0 && curly === 0) {
			cells.push(current);
			current = "";
			if (body[i + 1] === "|") i++;
			continue;
		}
		current += ch;
	}
	cells.push(current);
	return { header, cells };
}

function tableFrom(lines: readonly string[]): Table {
	const rows = lines.map(splitCells);
	const width = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
	return {
		type: "table",
		align: Array.from({ length: width }, () => null),
		children: rows.map((row) => ({
			type: "tableRow",
			children: Array.from(
				{ length: width },
				(_, c): TableCell => ({
					type: "tableCell",
					children: parseInline((row.cells[c] ?? "").trim()),
				}),
			),
		})),
	};
}

function isBlockStart(line: string): boolean {
	const trimmed = line.trim();
	return (
		MACRO.test(trimmed) ||
		HEADING.test(trimmed) ||
		QUOTE_LINE.test(trimmed) ||
		RULE.test(trimmed) ||
		LIST_ITEM.test(trimmed) ||
		TABLE_ROW.test(trimmed)
	);
}

function parseBlocks(source: readonly string[]): Block[] {
	const lines = [...source];
	const out: Block[] = [];
	let paragraph: string[] = [];
	const flush = (): void => {
		if (paragraph.length > 0) out.push({ type: "paragraph", children: inlineLines(paragraph) });
		paragraph = [];
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i] as string;
		const trimmed = line.trim();
		if (trimmed === "") {
			flush();
			i++;
			continue;
		}

		const macro = MACRO.exec(trimmed);
		if (macro !== null) {
			flush();
			// kalem-locale-ok: macro names are ASCII
			const name = (macro[1] as string).toLowerCase();
			const close = `{${name}}`;
			const body: string[] = [];
			let rest = macro[3] ?? "";
			let j = i;
			let after = "";
			for (;;) {
				// kalem-locale-ok: macro names are ASCII
				const at = rest.toLowerCase().indexOf(close);
				if (at !== -1) {
					body.push(rest.slice(0, at));
					after = rest.slice(at + close.length);
					break;
				}
				body.push(rest);
				j++;
				if (j >= lines.length) break;
				rest = lines[j] as string;
			}
			if (body[0]?.trim() === "") body.shift();
			if (body[body.length - 1]?.trim() === "") body.pop();
			if (after.trim() !== "") {
				lines[j] = after;
				i = j;
			} else {
				i = j + 1;
			}

			const params = macroParams(macro[2]);
			if (name === "code" || name === "noformat") {
				const value = body.join("\n");
				const lang =
					name === "code" ? fromConfluenceLanguage(params.get("language") ?? params.get("")) : null;
				out.push({ type: "code", lang, meta: null, value: value === "" ? "" : `${value}\n` });
			} else {
				const title = params.get("title") ?? (name === "expand" ? params.get("") : undefined);
				out.push(panelQuote(panelKind(name) ?? "panel", title ?? null, parseBlocks(body)));
			}
			continue;
		}

		const heading = HEADING.exec(trimmed);
		if (heading !== null) {
			flush();
			out.push({
				type: "heading",
				depth: Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6,
				children: parseInline(heading[2] ?? ""),
			});
			i++;
			continue;
		}

		const quote = QUOTE_LINE.exec(trimmed);
		if (quote !== null) {
			flush();
			out.push({
				type: "blockquote",
				children: [{ type: "paragraph", children: parseInline(quote[1] ?? "") }],
			});
			i++;
			continue;
		}

		if (RULE.test(trimmed)) {
			flush();
			out.push({ type: "thematicBreak" });
			i++;
			continue;
		}

		if (LIST_ITEM.test(trimmed)) {
			flush();
			const items: WikiItem[] = [];
			while (i < lines.length) {
				const current = (lines[i] as string).trim();
				const match = LIST_ITEM.exec(current);
				if (match !== null && !RULE.test(current)) {
					const markers = match[1] as string;
					items.push({
						depth: markers.length,
						ordered: markers.endsWith("#"),
						text: match[2] ?? "",
					});
				} else if (current !== "" && !isBlockStart(current) && items.length > 0) {
					const last = items[items.length - 1] as WikiItem;
					last.text += `\\\\${current}`;
				} else {
					break;
				}
				i++;
			}
			let at = 0;
			while (at < items.length) {
				const [list, next] = buildList(items, at, items[at]?.depth ?? 1);
				out.push(list);
				at = next;
			}
			continue;
		}

		if (TABLE_ROW.test(trimmed)) {
			flush();
			const rows: string[] = [];
			while (i < lines.length) {
				const current = (lines[i] as string).trim();
				if (TABLE_ROW.test(current)) rows.push(current);
				else if (current !== "" && !isBlockStart(current) && rows.length > 0) {
					rows[rows.length - 1] += ` ${current}`;
				} else break;
				i++;
			}
			out.push(tableFrom(rows));
			continue;
		}

		paragraph.push(line);
		i++;
	}
	flush();
	return out;
}

/** Converts Confluence wiki markup to Markdown. */
export function wikiToMarkdown(source: string): string {
	const lines = source.trimStart().replace(/\r\n?/g, "\n").split("\n");
	return serialize({ type: "root", children: parseBlocks(lines) });
}

// --- Export -----------------------------------------------------------------

const ALWAYS_ESCAPED = /[[\]{}|]/;
const MARKER_CHARS = new Set(["*", "_", "-", "+", "^", "~", "!"]);

/** Escapes what Confluence would read as markup, leaving ordinary punctuation alone. */
export function escapeWiki(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] as string;
		const prev = text[i - 1];
		const next = text[i + 1];
		if (ALWAYS_ESCAPED.test(ch)) {
			out += `\\${ch}`;
		} else if (ch === "\\") {
			out += "&#92;";
		} else if (ch === "&" && /^&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/i.test(text.slice(i, i + 12))) {
			out += "&amp;";
		} else if (ch === "(" && Object.keys(ICONS).some((icon) => text.startsWith(icon, i))) {
			out += "\\(";
		} else if (ch === "!") {
			out += isSpace(next) ? ch : `\\${ch}`;
		} else if (MARKER_CHARS.has(ch)) {
			const opens = !isWordChar(prev) && !isSpace(next);
			const closes = !isSpace(prev) && !isWordChar(next);
			out += opens || closes ? `\\${ch}` : ch;
		} else {
			out += ch;
		}
	}
	return out;
}

/** Wiki markers do not work with spaces just inside them: they move outside. */
function wrap(marker: string, inner: string): string {
	const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner) as RegExpExecArray;
	const body = match[2] ?? "";
	return body === "" ? inner : `${match[1]}${marker}${body}${marker}${match[3]}`;
}

class WikiWriter {
	#definitions: Map<string, Definition>;

	constructor(doc: Root) {
		this.#definitions = definitionsOf(doc);
	}

	blocks(blocks: readonly Block[]): string {
		return blocks
			.map((block) => this.block(block))
			.filter((text) => text !== "")
			.join("\n\n");
	}

	block(block: Block): string {
		switch (block.type) {
			case "heading":
				return `h${block.depth}. ${this.inlines(block.children)}`;
			case "paragraph": {
				const text = this.inlines(block.children);
				return /^(?:[*#-]|h[1-6]\.|bq\.)\s/.test(text) ? `\\${text}` : text;
			}
			case "blockquote":
				return this.quote(block);
			case "list":
				return this.list(block, "");
			case "code": {
				const lang = toConfluenceLanguage(block.lang);
				const value = block.value.endsWith("\n") ? block.value.slice(0, -1) : block.value;
				return `{code${lang === null ? "" : `:language=${lang}`}}\n${value}\n{code}`;
			}
			case "thematicBreak":
				return "----";
			case "table":
				return this.table(block);
			case "html":
				return block.value.trimStart().startsWith("<!--") ? "" : escapeWiki(block.value);
			default:
				return "";
		}
	}

	quote(quote: Blockquote): string {
		const panel = quotePanel(quote);
		if (panel !== null) {
			const title = panel.title === null ? "" : `:title=${panel.title.replace(/[|}]/g, "")}`;
			return `{${panel.kind}${title}}\n${this.blocks(panel.children)}\n{${panel.kind}}`;
		}
		const [only] = quote.children;
		if (quote.children.length === 1 && only?.type === "paragraph") {
			return `bq. ${this.inlines(only.children)}`;
		}
		return `{quote}\n${this.blocks(quote.children)}\n{quote}`;
	}

	/** Wiki list items are single lines; their paragraphs are joined with a line break. */
	list(list: List, prefix: string): string {
		const marker = prefix + (list.ordered ? "#" : "*");
		const lines: string[] = [];
		for (const item of list.children) {
			const parts: string[] = [];
			const after: string[] = [];
			for (const child of item.children) {
				if (child.type === "list") after.push(this.list(child, marker));
				else if (child.type === "paragraph" || child.type === "heading") {
					parts.push(this.inlines(child.children));
				} else {
					after.push(this.block(child));
				}
			}
			const task = item.checked === null ? "" : item.checked ? "(/) " : "( ) ";
			lines.push(`${marker} ${task}${parts.join(" \\\\ ")}`, ...after);
		}
		return lines.join("\n");
	}

	table(table: Table): string {
		return table.children
			.map((row, r) => {
				const separator = r === 0 ? "||" : "|";
				const cells = row.children.map((cell) => this.inlines(cell.children) || " ");
				return `${separator}${cells.join(separator)}${separator}`;
			})
			.join("\n");
	}

	inlines(nodes: readonly Inline[]): string {
		return nodes.map((node) => this.inline(node)).join("");
	}

	link(url: string, children: readonly Inline[]): string {
		const label = this.inlines(children);
		const target = url.replace(/[|\]]/g, (ch) => encodeURIComponent(ch));
		return label === "" || label === escapeWiki(url) ? `[${target}]` : `[${label}|${target}]`;
	}

	image(url: string, alt: string | null): string {
		const src = url.replace(/[|!]/g, (ch) => encodeURIComponent(ch));
		const clean = alt?.replace(/[,|!"]/g, "").trim() ?? "";
		return clean === "" ? `!${src}!` : `!${src}|alt="${clean}"!`;
	}

	inline(node: Inline): string {
		switch (node.type) {
			case "text":
				return escapeWiki(node.value.replace(/\n/g, " "));
			case "strong":
				return wrap("*", this.inlines(node.children));
			case "emphasis":
				return wrap("_", this.inlines(node.children));
			case "delete":
				return wrap("-", this.inlines(node.children));
			case "inlineCode":
				return `{{${escapeWiki(node.value)}}}`;
			case "link":
				return this.link(node.url, node.children);
			case "image":
				return this.image(node.url, node.alt);
			case "linkReference": {
				const definition = this.#definitions.get(node.identifier);
				return definition === undefined
					? `\\[${this.inlines(node.children)}\\]`
					: this.link(definition.url, node.children);
			}
			case "imageReference": {
				const definition = this.#definitions.get(node.identifier);
				return definition === undefined ? "" : this.image(definition.url, node.alt);
			}
			case "color":
				return `{color:${node.color}}${this.inlines(node.children)}{color}`;
			case "break":
				return " \\\\ ";
			case "html":
				return escapeWiki(node.value);
			default:
				return "";
		}
	}
}

/** Converts Markdown (with Kalem's table style comments) to Confluence wiki markup. */
export function markdownToWiki(markdown: string): string {
	const doc = parse(extractTableStyles(markdown).markdown);
	const blocks = doc.children.filter(
		(block): block is Block => block.type !== "yaml" && block.type !== "toml",
	);
	return `${new WikiWriter(doc).blocks(blocks)}\n`;
}
