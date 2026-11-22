import { describe, expect, it } from "vitest";
import { jiraKeyIn, suggestionsFor } from "./assistant-suggestions.js";
import { stringsFor } from "./i18n.js";

const tr = stringsFor("tr");

const texts = (markdown: string) => suggestionsFor(markdown, tr).map((s) => s.text);

describe("suggestionsFor", () => {
	it("offers a way to start an empty document", () => {
		expect(texts("  \n")).toEqual([tr.assistantSuggestDraft, tr.assistantSuggestOutline]);
	});

	it("puts what only this document has first: its issue, an analysis' gaps, its table", () => {
		const doc = [
			"# İptal",
			"Bkz. https://jira.example.com/browse/SIP-142",
			"## Kabul Kriterleri",
			"| Durum | Sonuç |",
			"| --- | --- |",
			"| A | B |",
		].join("\n");
		expect(texts(doc)).toEqual([
			"Bu belgeyi Jira'daki SIP-142 kaydıyla karşılaştır",
			tr.assistantSuggestGaps,
			tr.assistantSuggestTableCheck,
			tr.assistantSuggestSummary,
		]);
	});

	it("keeps the usual ones for a plain document, four at most", () => {
		expect(texts("# Not\n\nBir paragraf.")).toEqual([
			tr.assistantSuggestSummary,
			tr.assistantSuggestDiagram,
			tr.assistantSuggestFix,
			tr.assistantSuggestTable,
		]);
	});

	it("explains code, not a diagram's source", () => {
		expect(texts("```ts\nconst x = 1;\n```")).toContain(tr.assistantSuggestCode);
		expect(texts("```mermaid\ngraph TD\n```")).not.toContain(tr.assistantSuggestCode);
	});
});

describe("jiraKeyIn", () => {
	it("finds a linked issue first, then a key on its own, not UTF-8", () => {
		expect(jiraKeyIn("UTF-8 ve QR-48 ve /browse/SIP-9")).toBe("SIP-9");
		expect(jiraKeyIn("UTF-8 kodlaması, kayıt QR-48")).toBe("QR-48");
		expect(jiraKeyIn("UTF-8 ve ISO-8859")).toBeNull();
	});
});
