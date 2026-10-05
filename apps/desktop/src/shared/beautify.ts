import { parseAllDocuments } from "yaml";

export type BeautifyLanguage = "json" | "jsonc" | "xml" | "html" | "yaml";

export type BeautifyResult =
	| { readonly ok: true; readonly text: string; readonly language: BeautifyLanguage }
	| { readonly ok: false; readonly reason: "unsupported" }
	| {
			readonly ok: false;
			readonly reason: "invalid";
			readonly language: BeautifyLanguage;
			readonly message: string;
	  };

const INDENT = "  ";

const LANGUAGES: Readonly<Record<string, BeautifyLanguage>> = {
	json: "json",
	geojson: "json",
	webmanifest: "json",
	jsonc: "jsonc",
	html: "html",
	htm: "html",
	yaml: "yaml",
	yml: "yaml",
	xml: "xml",
	svg: "xml",
	xsd: "xml",
	xsl: "xml",
	xslt: "xml",
	rss: "xml",
	atom: "xml",
	plist: "xml",
	xhtml: "xml",
};

function hasLanguage(lang: string | null): boolean {
	// kalem-locale-ok: language names are ASCII
	const name = (lang ?? "").trim().toLowerCase();
	return name !== "" && name !== "text" && name !== "txt";
}

/** Maps a code-fence language to a formatter; guesses from the content when there is none. */
export function detectLanguage(code: string, lang: string | null): BeautifyLanguage | null {
	// kalem-locale-ok: language names are ASCII
	if (hasLanguage(lang)) return LANGUAGES[(lang as string).trim().toLowerCase()] ?? null;

	const trimmed = code.trimStart();
	const start = trimmed[0];
	if (start === "{" || start === "[") return "json";
	if (/^<(!doctype\s+html|html[\s>])/i.test(trimmed)) return "html";
	if (start === "<") return "xml";
	return null;
}

// --- JSON -------------------------------------------------------------------

type JsonToken =
	| { readonly kind: "punct" | "value"; readonly text: string }
	/** `ownLine`: nothing but whitespace precedes it on its source line. */
	| { readonly kind: "comment"; readonly text: string; readonly ownLine: boolean };

function tokenizeJson(text: string): JsonToken[] {
	const tokens: JsonToken[] = [];
	let lineStart = true;
	for (let i = 0; i < text.length; ) {
		const char = text[i] as string;
		if (/\s/.test(char)) {
			if (char === "\n") lineStart = true;
			i++;
			continue;
		}
		if (char === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
			const line = text[i + 1] === "/";
			let end = line ? text.indexOf("\n", i) : text.indexOf("*/", i + 2);
			if (end < 0) {
				if (!line) throw new Error("Unclosed comment");
				end = text.length;
			} else if (!line) {
				end += 2;
			}
			tokens.push({ kind: "comment", text: text.slice(i, end).trimEnd(), ownLine: lineStart });
			i = end;
			continue;
		}
		lineStart = false;
		if (char === '"') {
			let end = i + 1;
			while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
			tokens.push({ kind: "value", text: text.slice(i, end + 1) });
			i = end + 1;
		} else if ("{}[],:".includes(char)) {
			tokens.push({ kind: "punct", text: char });
			i++;
		} else {
			let end = i;
			while (end < text.length && !/[\s{}[\],:"/]/.test(text[end] as string)) end++;
			if (end === i) end++;
			tokens.push({ kind: "value", text: text.slice(i, end) });
			i = end;
		}
	}
	return tokens;
}

/** Comments and trailing commas removed, for validation with `JSON.parse`. */
function strictJson(tokens: readonly JsonToken[]): string {
	const kept = tokens.filter((token) => token.kind !== "comment");
	return kept
		.filter((token, i) => {
			const next = kept[i + 1]?.text;
			return !(token.text === "," && (next === "}" || next === "]"));
		})
		.map((token) => token.text)
		.join("");
}

/**
 * Re-indents JSON without re-serializing values: `JSON.stringify(JSON.parse(x))`
 * would rewrite `1.0` as `1`, lose precision on large integers and drop
 * duplicate keys. `JSON.parse` is used only to validate.
 *
 * With `comments` (JSONC), comments stay where they were — at the end of a
 * line or on a line of their own — and so do trailing commas.
 */
export function formatJson(text: string, comments = false): string {
	const tokens = comments ? tokenizeJson(text) : [];
	if (comments) JSON.parse(strictJson(tokens));
	else {
		JSON.parse(text);
		tokens.push(...tokenizeJson(text));
	}

	let out = "";
	let depth = 0;
	/** A line break is owed before the next token. */
	let pending = false;
	const emit = (piece: string): void => {
		if (pending && out !== "") out += `\n${INDENT.repeat(depth)}`;
		pending = false;
		out += piece;
	};

	for (const [i, token] of tokens.entries()) {
		const value = token.text;
		if (token.kind === "comment") {
			if (token.ownLine || out === "") {
				pending = true;
				emit(value);
			} else {
				out += ` ${value}`;
			}
			if (token.ownLine || value.startsWith("//")) pending = true;
			continue;
		}
		if (value === "{" || value === "[") {
			emit(value);
			const closing = value === "{" ? "}" : "]";
			if (tokens[i + 1]?.text !== closing) {
				depth++;
				pending = true;
			}
		} else if (value === "}" || value === "]") {
			const opening = value === "}" ? "{" : "[";
			if (tokens[i - 1]?.text !== opening) {
				depth--;
				pending = true;
			}
			emit(value);
		} else if (value === ",") {
			emit(value);
			pending = true;
		} else if (value === ":") {
			emit(": ");
		} else {
			emit(value);
		}
	}
	return out;
}

// --- XML and HTML -------------------------------------------------------------

interface XmlElement {
	readonly kind: "element";
	readonly name: string;
	readonly open: string;
	/** Empty when HTML let the closing tag be left out. */
	close: string;
	readonly children: XmlNode[];
	/** Offsets of the content between the open and close tags. */
	readonly contentStart: number;
	contentEnd: number;
}

/** Text, comment, CDATA, processing instruction, doctype or self-closing tag. */
interface XmlLeaf {
	readonly kind: "text" | "cdata" | "other";
	readonly raw: string;
}

type XmlNode = XmlElement | XmlLeaf;

const VOID_ELEMENTS = new Set(
	"area base br col embed hr img input link meta param source track wbr".split(" "),
);
/** Their content is not markup and is kept exactly. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "pre", "title"]);
/** Elements whose closing tag HTML lets authors leave out. */
const OPTIONAL_CLOSE = new Set(
	"p li dt dd tr td th thead tbody tfoot option optgroup colgroup caption head body html".split(
		" ",
	),
);

/** End offset (exclusive) of the markup starting at `<`, skipping quoted `>`. */
function tagEnd(text: string, start: number): number {
	let quote = "";
	for (let i = start + 1; i < text.length; i++) {
		const char = text[i];
		if (quote !== "") {
			if (char === quote) quote = "";
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === ">") {
			return i + 1;
		}
	}
	throw new Error("Unclosed tag");
}

function delimited(text: string, start: number, terminator: string, what: string): number {
	const end = text.indexOf(terminator, start);
	if (end < 0) throw new Error(`Unclosed ${what}`);
	return end + terminator.length;
}

/** A doctype may carry an internal subset in brackets, which contains `>`. */
function doctypeEnd(text: string, start: number): number {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (char === "[") depth++;
		else if (char === "]") depth--;
		else if (char === ">" && depth === 0) return i + 1;
	}
	throw new Error("Unclosed DOCTYPE");
}

function parseMarkup(text: string, html: boolean): XmlNode[] {
	const root: XmlNode[] = [];
	const stack: XmlElement[] = [];
	const siblings = (): XmlNode[] => stack[stack.length - 1]?.children ?? root;
	// kalem-locale-ok: tag names are ASCII
	const key = (name: string): string => (html ? name.toLowerCase() : name);
	const lower = html ? text.toLowerCase() : text; // kalem-locale-ok: searched for ASCII tag names
	/** Ends the open element if HTML lets its closing tag be left out. */
	const implicitClose = (at: number): boolean => {
		const top = stack[stack.length - 1];
		if (!html || top === undefined || !OPTIONAL_CLOSE.has(key(top.name))) return false;
		stack.pop();
		top.contentEnd = at;
		return true;
	};

	let i = 0;
	while (i < text.length) {
		if (text[i] !== "<") {
			const next = text.indexOf("<", i);
			const end = next < 0 ? text.length : next;
			siblings().push({ kind: "text", raw: text.slice(i, end) });
			i = end;
			continue;
		}

		if (text.startsWith("<!--", i)) {
			const end = delimited(text, i, "-->", "comment");
			siblings().push({ kind: "other", raw: text.slice(i, end) });
			i = end;
		} else if (text.startsWith("<![CDATA[", i)) {
			const end = delimited(text, i, "]]>", "CDATA section");
			siblings().push({ kind: "cdata", raw: text.slice(i, end) });
			i = end;
		} else if (text.startsWith("<?", i)) {
			const end = delimited(text, i, "?>", "processing instruction");
			siblings().push({ kind: "other", raw: text.slice(i, end) });
			i = end;
		} else if (text.startsWith("<!", i)) {
			const end = doctypeEnd(text, i);
			siblings().push({ kind: "other", raw: text.slice(i, end) });
			i = end;
		} else {
			const end = tagEnd(text, i);
			const raw = text.slice(i, end);
			const name = /^<\/?\s*([^\s/>]+)/.exec(raw)?.[1];
			if (name === undefined) throw new Error(`Malformed tag: ${raw}`);

			if (raw.startsWith("</")) {
				while (key(stack[stack.length - 1]?.name ?? name) !== key(name) && implicitClose(i)) {}
				const element = stack.pop();
				if (element === undefined) throw new Error(`Unexpected closing tag </${name}>`);
				if (key(element.name) !== key(name)) {
					throw new Error(`Expected </${element.name}> but found </${name}>`);
				}
				element.close = raw;
				element.contentEnd = i;
			} else if (raw.endsWith("/>") || (html && VOID_ELEMENTS.has(key(name)))) {
				siblings().push({ kind: "other", raw });
			} else if (html && RAW_TEXT_ELEMENTS.has(key(name))) {
				const closeAt = lower.indexOf(`</${key(name)}`, end);
				if (closeAt < 0) throw new Error(`Missing closing tag </${name}>`);
				const closeEnd = tagEnd(text, closeAt);
				siblings().push({
					kind: "element",
					name,
					open: raw,
					close: text.slice(closeAt, closeEnd),
					children: [{ kind: "cdata", raw: text.slice(end, closeAt) }],
					contentStart: end,
					contentEnd: closeAt,
				});
				i = closeEnd;
				continue;
			} else {
				// An `<li>` ends the open `<li>`; the same for the other repeating items.
				const top = stack[stack.length - 1];
				if (top !== undefined && key(top.name) === key(name)) implicitClose(i);
				const element: XmlElement = {
					kind: "element",
					name,
					open: raw,
					close: "",
					children: [],
					contentStart: end,
					contentEnd: end,
				};
				siblings().push(element);
				stack.push(element);
			}
			i = end;
		}
	}

	while (implicitClose(text.length)) {}
	const unclosed = stack[stack.length - 1];
	if (unclosed !== undefined) throw new Error(`Missing closing tag </${unclosed.name}>`);
	return root;
}

function isBlank(node: XmlNode): boolean {
	return node.kind === "text" && node.raw.trim() === "";
}

/**
 * Like `xmllint --format`: indentation is added only where there is no text.
 * An element that contains text (or asks for `xml:space="preserve"`) is
 * written exactly as it was, because whitespace there is content. In HTML,
 * void elements need no closing tag, optional closing tags may be left out
 * and the content of `script`, `style`, `pre`… is kept as written.
 */
export function formatXml(text: string, html = false): string {
	const lines: string[] = [];

	const write = (nodes: readonly XmlNode[], depth: number): void => {
		const pad = INDENT.repeat(depth);
		for (const node of nodes) {
			if (isBlank(node)) continue;
			if (node.kind !== "element") {
				lines.push(pad + node.raw.trim());
				continue;
			}

			const hasText = node.children.some(
				(child) => child.kind === "cdata" || (child.kind === "text" && !isBlank(child)),
			);
			const preserve = /\sxml:space\s*=\s*["']preserve["']/.test(node.open);
			if (hasText || preserve) {
				const content = text.slice(node.contentStart, node.contentEnd);
				lines.push(
					pad + node.open + (node.close === "" ? content.trimEnd() : content) + node.close,
				);
			} else if (node.children.every(isBlank)) {
				lines.push(pad + node.open + node.close);
			} else {
				lines.push(pad + node.open);
				write(node.children, depth + 1);
				if (node.close !== "") lines.push(pad + node.close);
			}
		}
	};

	const nodes = parseMarkup(text.trim(), html);
	if (!nodes.some((node) => node.kind === "element" || /^<[^!?]/.test(node.raw))) {
		throw new Error("No root element");
	}
	// Text outside the root element is not XML.
	if (!html && nodes.some((node) => node.kind === "text" && !isBlank(node))) {
		throw new Error("Text outside the root element");
	}
	write(nodes, 0);
	return lines.join("\n");
}

// --- YAML -------------------------------------------------------------------

/**
 * Re-indents YAML with two spaces. The failsafe schema reads every scalar
 * as a string, so `1E5`, `010` or `yes` are written exactly as they were;
 * comments, anchors, tags and quoting styles are kept.
 */
export function formatYaml(text: string): string {
	const documents = parseAllDocuments(text, { schema: "failsafe" });
	if (!Array.isArray(documents) || documents.length === 0) throw new Error("Empty YAML");
	for (const document of documents) {
		const error = document.errors[0];
		if (error !== undefined) throw new Error(error.message.split("\n")[0]);
	}
	return documents
		.map((document) => document.toString({ indent: 2, lineWidth: 0 }))
		.join("")
		.replace(/\n$/, "");
}

// --- Entry point ------------------------------------------------------------

function formatAs(code: string, language: BeautifyLanguage): string {
	switch (language) {
		case "json":
			return formatJson(code);
		case "jsonc":
			return formatJson(code, true);
		case "xml":
			return formatXml(code);
		case "html":
			return formatXml(code, true);
		case "yaml":
			return formatYaml(code);
	}
}

/** When a guess does not parse, a more lenient relative gets a try. */
const FALLBACK: Partial<Record<BeautifyLanguage, BeautifyLanguage>> = {
	json: "jsonc",
	xml: "html",
};

export function beautify(code: string, lang: string | null): BeautifyResult {
	let language = detectLanguage(code, lang);
	if (language === null) return { ok: false, reason: "unsupported" };
	const fallback = hasLanguage(lang) ? undefined : FALLBACK[language];
	if (fallback !== undefined) {
		try {
			return { ok: true, text: formatAs(code, language), language };
		} catch {
			language = fallback;
		}
	}
	try {
		return { ok: true, text: formatAs(code, language), language };
	} catch (error) {
		// A guess that does not parse was simply a wrong guess, not an error.
		if (!hasLanguage(lang)) return { ok: false, reason: "unsupported" };
		return {
			ok: false,
			reason: "invalid",
			language,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
