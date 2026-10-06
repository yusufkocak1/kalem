/**
 * A tolerant parser for Confluence storage format. It is XHTML with `ac:` and
 * `ri:` elements, but pages copied out of Confluence often carry HTML
 * entities, unclosed `<br>` tags and the like, so a strict XML parser would
 * reject them.
 */

export interface MarkupElement {
	readonly kind: "element";
	/** As written, lowercased: `p`, `ac:structured-macro`. */
	readonly name: string;
	readonly attrs: ReadonlyMap<string, string>;
	readonly children: MarkupNode[];
}

export interface MarkupText {
	readonly kind: "text";
	value: string;
}

export type MarkupNode = MarkupElement | MarkupText;

const VOID = new Set(["br", "hr", "img", "col", "input", "meta", "link", "area", "base", "wbr"]);
const RAW_TEXT = new Set(["script", "style"]);
/** Opening one of these closes an open sibling of the same kind, as in HTML. */
const SELF_CLOSING_SIBLINGS = new Set(["p", "li", "tr", "td", "th"]);

const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	bull: "•",
	middot: "·",
	copy: "©",
	reg: "®",
	trade: "™",
	times: "×",
	euro: "€",
	deg: "°",
	rarr: "→",
	larr: "←",
};

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, name: string) => {
		if (name[0] === "#") {
			const code =
				name[1] === "x" || name[1] === "X"
					? Number.parseInt(name.slice(2), 16)
					: Number.parseInt(name.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		return ENTITIES[name] ?? match;
	});
}

const TAG =
	/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attributes(source: string): Map<string, string> {
	const attrs = new Map<string, string>();
	for (const match of source.matchAll(ATTRIBUTE)) {
		const value = match[2] ?? match[3] ?? match[4] ?? "";
		// kalem-locale-ok: attribute names are ASCII
		attrs.set((match[1] as string).toLowerCase(), decodeEntities(value));
	}
	return attrs;
}

function appendText(parent: MarkupElement, value: string): void {
	if (value === "") return;
	const last = parent.children[parent.children.length - 1];
	if (last?.kind === "text") last.value += value;
	else parent.children.push({ kind: "text", value });
}

export function parseMarkup(source: string): MarkupElement {
	const root: MarkupElement = { kind: "element", name: "#root", attrs: new Map(), children: [] };
	const stack: MarkupElement[] = [root];
	const top = (): MarkupElement => stack[stack.length - 1] as MarkupElement;
	let i = 0;

	const skipTo = (marker: string, from: number): number => {
		const end = source.indexOf(marker, from);
		return end === -1 ? source.length : end;
	};

	while (i < source.length) {
		const lt = source.indexOf("<", i);
		const end = lt === -1 ? source.length : lt;
		appendText(top(), decodeEntities(source.slice(i, end)));
		if (lt === -1) break;

		if (source.startsWith("<!--", lt)) {
			i = skipTo("-->", lt + 4) + 3;
			continue;
		}
		if (source.startsWith("<![CDATA[", lt)) {
			const close = skipTo("]]>", lt + 9);
			appendText(top(), source.slice(lt + 9, close));
			i = close + 3;
			continue;
		}
		if (source.startsWith("<!", lt) || source.startsWith("<?", lt)) {
			i = skipTo(">", lt) + 1;
			continue;
		}

		TAG.lastIndex = lt;
		const tag = TAG.exec(source);
		if (tag === null) {
			appendText(top(), "<");
			i = lt + 1;
			continue;
		}
		i = TAG.lastIndex;
		// kalem-locale-ok: tag names are ASCII
		const name = (tag[2] as string).toLowerCase();

		if (tag[1] === "/") {
			let index = stack.length - 1;
			while (index > 0 && stack[index]?.name !== name) index--;
			if (index > 0) stack.length = index;
			continue;
		}

		if (SELF_CLOSING_SIBLINGS.has(name) && top().name === name) stack.pop();
		const element: MarkupElement = {
			kind: "element",
			name,
			attrs: attributes(tag[3] ?? ""),
			children: [],
		};
		top().children.push(element);
		if (tag[4] === "/" || VOID.has(name)) continue;
		if (RAW_TEXT.has(name)) {
			const close = skipTo(`</${name}`, i);
			appendText(element, source.slice(i, close));
			i = skipTo(">", close) + 1;
			continue;
		}
		stack.push(element);
	}
	return root;
}

export function textOf(node: MarkupNode): string {
	return node.kind === "text" ? node.value : node.children.map(textOf).join("");
}

export function childElements(node: MarkupElement, name?: string): MarkupElement[] {
	return node.children.filter(
		(child): child is MarkupElement =>
			child.kind === "element" && (name === undefined || child.name === name),
	);
}
