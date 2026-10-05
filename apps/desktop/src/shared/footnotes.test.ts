import { parse } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import { collectFootnotes, footnoteDefinitionLabel, splitReferences } from "./footnotes.js";

describe("collectFootnotes", () => {
	it("finds paragraph and one-word definitions and numbers them by first reference", () => {
		const doc = parse(
			"İkinci[^b] ve birinci[^a], yine[^b].\n\n[^a]: Kısa\n\n[^b]: Uzun **not** metni.\n\n[^c]: Kullanılmayan not.\n",
		);
		const { notes, order } = collectFootnotes(doc);
		expect(order).toEqual(["b", "a", "c"]);
		expect(notes.get("a")).toEqual([{ type: "text", value: "Kısa" }]);
		expect(notes.get("b")?.[0]).toEqual({ type: "text", value: "Uzun " });
		expect(doc.children.map(footnoteDefinitionLabel)).toEqual([null, "a", "b", "c"]);
	});

	it("leaves references without a note as text", () => {
		const notes = new Map([["1", []]]);
		expect(splitReferences("a[^1]b[^2]", notes)).toEqual(["a", { label: "1" }, "b[^2]"]);
		expect(collectFootnotes(parse("Yalnız[^x].\n")).order).toEqual([]);
	});
});
