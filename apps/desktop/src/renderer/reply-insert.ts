/**
 * Where the assistant's reply goes when it is inserted at the caret.
 *
 * Pasting merges the first pasted paragraph into the one at the caret,
 * which is right for a copied sentence. A reply is a piece of its own: a
 * reply of several blocks put at the end of "…ya da reddeder." came out as
 * "…reddeder.İşte akış:", glued to the sentence without even a space. So a
 * reply of several blocks always goes in as blocks of its own, and a reply
 * of one paragraph is put inside the text with a space where it meets a word.
 */
import type { Inline, Root } from "@kalem-editor/core";
import type { Caret, EditResult } from "@kalem-editor/editor";
import {
	insertFragment,
	listLength,
	newParagraph,
	plainInline,
	splitAtCaret,
} from "@kalem-editor/editor";

/** The inline content of a top-level paragraph or heading; `null` for other blocks. */
function textOf(node: Root["children"][number] | undefined): readonly Inline[] | null {
	return node?.type === "paragraph" || node?.type === "heading" ? node.children : null;
}

/** A letter or digit, in any script: where a word would run into the reply. */
const WORD = /[\p{L}\p{N}]/u;
/** What a reply starting with a word should be spaced from: a word or the end of a sentence. */
const BEFORE_SPACE = /[\p{L}\p{N}.,;:!?)\]"'”’…]/u;

/** The one-paragraph reply with a space at an end that meets a word. */
function spaced(fragment: Root, before: string, after: string): Root {
	const paragraph = fragment.children[0];
	if (paragraph?.type !== "paragraph") return fragment;
	const text = plainInline(paragraph.children);
	const children: Inline[] = [...paragraph.children];
	if (BEFORE_SPACE.test(before) && WORD.test(text.at(0) ?? "")) {
		children.unshift({ type: "text", value: " " });
	}
	if (WORD.test(after) && WORD.test(text.at(-1) ?? "")) children.push({ type: "text", value: " " });
	return { ...fragment, children: [{ ...paragraph, children }] };
}

/** Inserts the reply `fragment` at `caret`; `null` when there is nothing to insert. */
export function insertReplyFragment(doc: Root, caret: Caret, fragment: Root): EditResult | null {
	if (fragment.children.length === 0) return null;
	const text = caret.path.length === 0 ? textOf(doc.children[caret.blockIndex]) : null;
	// In a list, a table or a quote, and in an empty paragraph, a paste does the right thing.
	if (text === null || listLength(text) === 0) return insertFragment(doc, caret, fragment);

	if (fragment.children.length === 1 && fragment.children[0]?.type === "paragraph") {
		const plain = plainInline(text);
		return insertFragment(
			doc,
			caret,
			spaced(fragment, plain.slice(0, caret.offset).at(-1) ?? "", plain.at(caret.offset) ?? ""),
		);
	}

	// Several blocks: never merged into the caret's text. An empty paragraph
	// goes after the text (before it at its start, between its halves in its
	// middle), and the reply takes its place.
	let target = doc;
	let index = caret.blockIndex + 1;
	if (caret.offset === 0) index = caret.blockIndex;
	else if (caret.offset < listLength(text)) {
		const split = splitAtCaret(doc, caret);
		if (split !== null) target = split.doc;
	}
	const children = [...target.children];
	children.splice(index, 0, newParagraph());
	return insertFragment(
		{ ...target, children: children as Root["children"] },
		{ blockIndex: index, path: [], offset: 0 },
		fragment,
	);
}
