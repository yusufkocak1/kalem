import { parse, serialize } from "@kalem-editor/core";
import type { Caret, EditResult } from "@kalem-editor/editor";
import { assignIds, newParagraph } from "@kalem-editor/editor";
import { describe, expect, it } from "vitest";
import { insertReplyFragment } from "./reply-insert.js";

const doc = (markdown: string) => assignIds(parse(markdown));
const caret = (blockIndex: number, offset: number, path: number[] = []): Caret => ({
	blockIndex,
	path,
	offset,
});
const md = (result: EditResult | null): string =>
	result === null ? "<null>" : serialize(result.doc);

describe("inserting the assistant's reply", () => {
	/** Keşif testi K-06: "…reddeder.İşte akış:" */
	it("a reply of several blocks at the end of a sentence goes in as its own blocks", () => {
		const result = insertReplyFragment(
			doc("# Süreç\n\nYönetici onaylar ya da reddeder.\n"),
			caret(1, 33),
			parse("İşte akış:\n\n- Başvuru\n- Onay\n"),
		);
		expect(md(result)).toBe(
			"# Süreç\n\nYönetici onaylar ya da reddeder.\n\nİşte akış:\n\n- Başvuru\n- Onay\n",
		);
	});

	it("at the start of a paragraph the reply goes before it", () => {
		const result = insertReplyFragment(doc("Metin.\n"), caret(0, 0), parse("Bir\n\nİki\n"));
		expect(md(result)).toBe("Bir\n\nİki\n\nMetin.\n");
	});

	it("in the middle of a paragraph the paragraph is split around the reply", () => {
		const result = insertReplyFragment(doc("baştan sona\n"), caret(0, 6), parse("Bir\n\nİki\n"));
		expect(md(result)).toBe("baştan\n\nBir\n\nİki\n\n sona\n");
	});

	it("an empty paragraph is replaced by the reply", () => {
		// Markdown has no empty paragraph; the editor makes one with Enter.
		const before = doc("Önce\n");
		const withEmpty = { ...before, children: [...before.children, newParagraph()] };
		const result = insertReplyFragment(withEmpty, caret(1, 0), parse("# Başlık\n\nMetin\n"));
		expect(md(result)).toBe("Önce\n\n# Başlık\n\nMetin\n");
	});

	it("a one-paragraph reply goes into the text with a space where it meets a word", () => {
		expect(md(insertReplyFragment(doc("Önce sonra\n"), caret(0, 4), parse("orta\n")))).toBe(
			"Önce orta sonra\n",
		);
		expect(md(insertReplyFragment(doc("Cümle.\n"), caret(0, 6), parse("Ek.\n")))).toBe(
			"Cümle. Ek.\n",
		);
		expect(md(insertReplyFragment(doc("Önce\n"), caret(0, 4), parse("sonra\n")))).toBe(
			"Önce sonra\n",
		);
	});

	it("in a list item it inserts as a paste does", () => {
		expect(md(insertReplyFragment(doc("- bir\n"), caret(0, 3, [0, 0]), parse("iki\n")))).toBe(
			"- biriki\n",
		);
	});
});
