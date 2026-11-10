/**
 * Marks over the document's text that last only while the app runs: a
 * review's findings are highlighted where their quotes are, without a
 * character written into the Markdown. A quote is Markdown; the page shows
 * it without its marks, so it is looked for as plain text.
 */

const HIGHLIGHT = "kalem-findings";
const CURRENT = "kalem-finding-current";

/** A quote as the page shows it: links as their text, emphasis and code marks left out. */
export function plainQuote(quote: string): string {
	return quote
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
		.replace(/(\*\*|__|~~|`)/g, "")
		.replace(/(^|[^\p{L}\p{N}])[*_]([^*_]+)[*_](?=[^\p{L}\p{N}]|$)/gu, "$1$2")
		.replace(/\s+/g, " ")
		.trim();
}

interface TextMap {
	/** The text of the page, its spaces folded into one. */
	readonly text: string;
	/** For each character of `text`: its node and offset. */
	readonly at: readonly { node: Text; offset: number }[];
}

function textMap(root: HTMLElement): TextMap {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let text = "";
	const at: { node: Text; offset: number }[] = [];
	let space = true;
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const value = (node as Text).data;
		for (let i = 0; i < value.length; i++) {
			const char = value[i] as string;
			if (/\s/.test(char)) {
				if (space) continue;
				space = true;
				text += " ";
			} else {
				space = false;
				text += char;
			}
			at.push({ node: node as Text, offset: i });
		}
		// Blocks are apart: their texts do not run into each other.
		if (!space) {
			space = true;
			text += " ";
			at.push({ node: node as Text, offset: value.length });
		}
	}
	return { text, at };
}

/** Where the quote is on the page; `null` when it is not there (any more). */
export function findQuote(root: HTMLElement, quote: string, map = textMap(root)): Range | null {
	const wanted = plainQuote(quote);
	if (wanted === "") return null;
	// A long quote is looked for by its start.
	const needle = wanted.length > 160 ? wanted.slice(0, 160) : wanted;
	let index = map.text.indexOf(needle);
	if (index === -1)
		index = map.text.toLocaleLowerCase("tr").indexOf(needle.toLocaleLowerCase("tr"));
	if (index === -1) return null;
	const start = map.at[index];
	const end = map.at[index + needle.length - 1];
	if (start === undefined || end === undefined) return null;
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, Math.min(end.offset + 1, end.node.data.length));
	return range;
}

const highlights = (): HighlightRegistry | null =>
	typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null;

/** Marks every quote found on the page; how many were found. */
export function markQuotes(root: HTMLElement, quotes: readonly string[]): number {
	const registry = highlights();
	if (registry === null) return 0;
	const map = textMap(root);
	const ranges = quotes
		.map((quote) => findQuote(root, quote, map))
		.filter((range): range is Range => range !== null);
	registry.set(HIGHLIGHT, new Highlight(...ranges));
	return ranges.length;
}

/** Brings the quote into view and selects it; `false` when it is not on the page. */
export function revealQuote(root: HTMLElement, quote: string): boolean {
	const range = findQuote(root, quote);
	if (range === null) return false;
	highlights()?.set(CURRENT, new Highlight(range));
	const element = range.startContainer.parentElement;
	element?.scrollIntoView({ block: "center", behavior: "smooth" });
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	return true;
}

export function clearMarks(): void {
	highlights()?.delete(HIGHLIGHT);
	highlights()?.delete(CURRENT);
}
