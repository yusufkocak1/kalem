export type BeautifyLanguage = "json" | "xml";

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

	const start = code.trimStart()[0];
	if (start === "{" || start === "[") return "json";
	if (start === "<") return "xml";
	return null;
}

// --- JSON -------------------------------------------------------------------

/**
 * Re-indents JSON without re-serializing values: `JSON.stringify(JSON.parse(x))`
 * would rewrite `1.0` as `1`, lose precision on large integers and drop
 * duplicate keys. `JSON.parse` is used only to validate.
 */
export function formatJson(text: string): string {
	JSON.parse(text);

	const tokens: string[] = [];
	for (let i = 0; i < text.length; ) {
		const char = text[i] as string;
		if (/\s/.test(char)) {
			i++;
		} else if (char === '"') {
			let end = i + 1;
			while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
			tokens.push(text.slice(i, end + 1));
			i = end + 1;
		} else if ("{}[],:".includes(char)) {
			tokens.push(char);
			i++;
		} else {
			let end = i;
			while (end < text.length && !/[\s{}[\],:"]/.test(text[end] as string)) end++;
			tokens.push(text.slice(i, end));
			i = end;
		}
	}

	let out = "";
	let depth = 0;
	const newline = (): string => `\n${INDENT.repeat(depth)}`;

	for (const [i, token] of tokens.entries()) {
		if (token === "{" || token === "[") {
			const closing = token === "{" ? "}" : "]";
			if (tokens[i + 1] === closing) {
				out += token;
			} else {
				depth++;
				out += token + newline();
			}
		} else if (token === "}" || token === "]") {
			const opening = token === "}" ? "{" : "[";
			if (tokens[i - 1] === opening) {
				out += token;
			} else {
				depth--;
				out += newline() + token;
			}
		} else if (token === ",") {
			out += token + newline();
		} else if (token === ":") {
			out += ": ";
		} else {
			out += token;
		}
	}
	return out;
}

// --- XML --------------------------------------------------------------------

interface XmlElement {
	readonly kind: "element";
	readonly name: string;
	readonly open: string;
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

function parseXml(text: string): XmlNode[] {
	const root: XmlNode[] = [];
	const stack: XmlElement[] = [];
	const siblings = (): XmlNode[] => stack[stack.length - 1]?.children ?? root;

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
				const element = stack.pop();
				if (element === undefined) throw new Error(`Unexpected closing tag </${name}>`);
				if (element.name !== name) {
					throw new Error(`Expected </${element.name}> but found </${name}>`);
				}
				element.close = raw;
				element.contentEnd = i;
			} else if (raw.endsWith("/>")) {
				siblings().push({ kind: "other", raw });
			} else {
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
 * written exactly as it was, because whitespace there is content.
 */
export function formatXml(text: string): string {
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
				lines.push(pad + node.open + text.slice(node.contentStart, node.contentEnd) + node.close);
			} else if (node.children.every(isBlank)) {
				lines.push(pad + node.open + node.close);
			} else {
				lines.push(pad + node.open);
				write(node.children, depth + 1);
				lines.push(pad + node.close);
			}
		}
	};

	const nodes = parseXml(text.trim());
	if (!nodes.some((node) => node.kind === "element" || /^<[^!?]/.test(node.raw))) {
		throw new Error("No root element");
	}
	// Text outside the root element is not XML.
	if (nodes.some((node) => node.kind === "text" && !isBlank(node))) {
		throw new Error("Text outside the root element");
	}
	write(nodes, 0);
	return lines.join("\n");
}

// --- Entry point ------------------------------------------------------------

export function beautify(code: string, lang: string | null): BeautifyResult {
	const language = detectLanguage(code, lang);
	if (language === null) return { ok: false, reason: "unsupported" };
	try {
		const text = language === "json" ? formatJson(code) : formatXml(code);
		return { ok: true, text, language };
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
