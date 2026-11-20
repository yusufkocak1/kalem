import { describe, expect, it } from "vitest";
import type { ChangeDecision } from "./edit-review.js";
import {
	applyProposals,
	chunksOf,
	composeLines,
	composeReview,
	keptProposals,
	likeness,
	lineReview,
	placeProposals,
	reviewEdit,
} from "./edit-review.js";

const BEFORE = `# Başlık

İlk paragraf.

İkinci paragraf.

- madde
- madde 2

Son paragraf.
`;

const decide = (...pairs: [number, ChangeDecision][]) => new Map(pairs);

describe("the blocks of a document", () => {
	it("join into the document again, byte for byte", () => {
		const text = "---\ntitle: x\n---\n\n# A\r\n\r\npara\n\n\n```js\nx\n```\n";
		expect(
			chunksOf(text)
				.map((chunk) => chunk.text)
				.join(""),
		).toBe(text.replace(/\r\n/g, "\n"));
		expect(chunksOf("").length).toBe(0);
	});

	it("leave a table's style comment out of the editor's blocks", () => {
		const text = "<!-- kalem:table color=blue -->\n| a |\n|---|\n| b |\n\npara\n";
		expect(chunksOf(text).map((chunk) => chunk.block)).toEqual([false, true, true]);
		expect(chunksOf("<!-- just a comment -->\n\npara\n").map((chunk) => chunk.block)).toEqual([
			true,
			true,
		]);
	});
});

describe("an edit to review", () => {
	it("is one change for each rewritten block, and nothing else", () => {
		const after = BEFORE.replace("İlk paragraf.", "İlk paragraf, yeniden.").replace(
			"Son paragraf.",
			"Son paragraf!",
		);
		const review = reviewEdit(BEFORE, after);
		expect(review.changes).toEqual([
			{ id: 0, removed: [1], added: [1] },
			{ id: 1, removed: [4], added: [4] },
		]);
		const all = composeReview(review, new Map());
		expect(all.text).toBe(after);
		expect(all.pending.map((change) => change.blocks)).toEqual([[1], [4]]);
		expect(all.pending[0]?.removed).toBe("İlk paragraf.\n\n");
		expect(all.pending[0]?.added).toBe("İlk paragraf, yeniden.\n\n");
	});

	it("puts back the changes the user rejects, and keeps the others", () => {
		const after = BEFORE.replace("İlk paragraf.", "Bir.").replace("Son paragraf.", "Son.");
		const review = reviewEdit(BEFORE, after);
		const one = composeReview(review, decide([0, "rejected"]));
		expect(one.text).toBe(BEFORE.replace("Son paragraf.", "Son."));
		expect(one.pending.map((change) => change.id)).toEqual([1]);
		const both = composeReview(review, decide([0, "rejected"], [1, "rejected"]));
		expect(both.text).toBe(BEFORE);
		expect(both.pending).toEqual([]);
		const kept = composeReview(review, decide([0, "accepted"], [1, "accepted"]));
		expect(kept.text).toBe(after);
		expect(kept.pending).toEqual([]);
	});

	it("shows an insertion where it is, and a deletion before the block after it", () => {
		const inserted = BEFORE.replace(
			"İkinci paragraf.\n\n",
			"İkinci paragraf.\n\n## Yeni\n\nYeni metin.\n\n",
		);
		const added = composeReview(reviewEdit(BEFORE, inserted), new Map());
		expect(added.pending).toEqual([
			{ id: 0, blocks: [3, 4], before: null, removed: "", added: "## Yeni\n\nYeni metin.\n\n" },
		]);
		expect(composeReview(reviewEdit(BEFORE, inserted), decide([0, "rejected"])).text).toBe(BEFORE);

		const deleted = BEFORE.replace("İkinci paragraf.\n\n", "");
		const review = reviewEdit(BEFORE, deleted);
		const gone = composeReview(review, new Map());
		expect(gone.text).toBe(deleted);
		expect(gone.pending).toEqual([
			{ id: 0, blocks: [], before: 2, removed: "İkinci paragraf.\n\n", added: "" },
		]);
		expect(composeReview(review, decide([0, "rejected"])).text).toBe(BEFORE);

		const atEnd = composeReview(
			reviewEdit(BEFORE, BEFORE.replace("\nSon paragraf.\n", "")),
			new Map(),
		);
		expect(atEnd.pending[0]?.before).toBeNull();
		// Put back after the last block, which no longer ends in a blank line: it stays a block of its own.
		const last = reviewEdit(BEFORE, BEFORE.replace("\nSon paragraf.\n", ""));
		expect(composeReview(last, decide([0, "rejected"])).text).toBe(BEFORE);
		const noEnd = reviewEdit("Bir.\n\nİki.", "Bir.");
		expect(composeReview(noEnd, decide([0, "rejected"])).text).toBe("Bir.\n\nİki.");
	});

	it("pairs a rewrite with the block it most looks like, and keeps the rest apart", () => {
		const merged = BEFORE.replace("İlk paragraf.\n\nİkinci paragraf.", "Tek paragraf.");
		const review = reviewEdit(BEFORE, merged);
		expect(review.changes).toEqual([
			{ id: 0, removed: [1], added: [1] },
			{ id: 1, removed: [2], added: [] },
		]);
		expect(composeReview(review, decide([0, "rejected"], [1, "rejected"])).text).toBe(BEFORE);

		// Two rewritten and the last one deleted: three changes.
		const after = BEFORE.replace("İlk paragraf.", "İlk paragraf, yeniden.")
			.replace("İkinci paragraf.", "İkinci paragraf, yeniden.")
			.replace("\nSon paragraf.\n", "");
		expect(
			reviewEdit(BEFORE, after).changes.map((change) => [change.removed, change.added]),
		).toEqual([
			[[1], [1]],
			[[2], [2]],
			// The list did not change: only the last paragraph is gone.
			[[4], []],
		]);

		// A new block before a rewritten one: the new one is put in on its own.
		const inserted = BEFORE.replace(
			"İlk paragraf.",
			"Yepyeni bir giriş.\n\nİlk paragraf, yeniden.",
		);
		const review2 = reviewEdit(BEFORE, inserted);
		expect(review2.changes.map((change) => [change.removed, change.added])).toEqual([
			[[], [1]],
			[[1], [2]],
		]);
		expect(composeReview(review2, decide([0, "rejected"])).text).toBe(
			BEFORE.replace("İlk paragraf.", "İlk paragraf, yeniden."),
		);
	});

	it("tells how alike two blocks are by their words", () => {
		expect(likeness("İade kolay olmalı.", "iade KOLAY olmalı!")).toBe(1);
		expect(likeness("Bir iki", "üç dört")).toBe(0);
		expect(likeness("", "")).toBe(1);
	});

	it("has no change when the text is the same", () => {
		expect(reviewEdit(BEFORE, BEFORE).changes).toEqual([]);
		expect(composeReview(reviewEdit(BEFORE, BEFORE), new Map()).text).toBe(BEFORE);
	});

	it("handles a whole new document and an empty one", () => {
		const review = reviewEdit("", "# Yeni\n");
		expect(composeReview(review, new Map()).text).toBe("# Yeni\n");
		expect(composeReview(review, decide([0, "rejected"])).text).toBe("");
		expect(composeReview(reviewEdit("# Eski\n", ""), decide([0, "rejected"])).text).toBe(
			"# Eski\n",
		);
	});
});

describe("a code file's proposed change, a line at a time", () => {
	const before = "a\nb\nc\nd\n";
	const after = "A\nb\nc\nd2\nd3\n";

	it("finds each run of lines that differ", () => {
		const changes = lineReview(before, after).flatMap((step) =>
			step.kind === "change" ? [step.change] : [],
		);
		expect(changes).toEqual([
			{ id: 0, removed: ["a"], added: ["A"] },
			{ id: 1, removed: ["d"], added: ["d2", "d3"] },
		]);
	});

	it("puts the file together as decided", () => {
		const steps = lineReview(before, after);
		expect(composeLines(steps, new Map())).toBe(after);
		expect(composeLines(steps, decide([0, "rejected"]))).toBe("a\nb\nc\nd2\nd3\n");
		expect(composeLines(steps, decide([0, "rejected"], [1, "rejected"]))).toBe(before);
	});

	it("applies the proposals in order, or says the file changed since", () => {
		expect(
			applyProposals("a\r\nb\n", [
				{ oldText: "a", newText: "A" },
				{ oldText: "A", newText: "AA" },
			]),
		).toBe("AA\nb\n");
		expect(applyProposals("a\n", [{ oldText: "x", newText: "y" }])).toBeNull();
	});

	it("keeps where each proposal's new text ended up, as later ones move it", () => {
		const placed = placeProposals("a\nb\nc\n", [
			{ oldText: "c", newText: "C1\nC2" },
			{ oldText: "a", newText: "" },
			{ oldText: "b", newText: "B" },
		]);
		expect(placed?.text).toBe("\nB\nC1\nC2\n");
		const text = placed?.text ?? "";
		expect(placed?.ranges.map((range) => text.slice(range.start, range.end))).toEqual([
			"C1\nC2",
			"",
			"B",
		]);
		// One inside an earlier one's new text: the earlier one grows over it.
		const nested = placeProposals("x\n", [
			{ oldText: "x", newText: "x1 x2" },
			{ oldText: "x2", newText: "y" },
		]);
		expect(nested?.ranges).toEqual([
			{ start: 0, end: 4 },
			{ start: 3, end: 4 },
		]);
	});

	it("tells which proposals were kept from the lines the user decided", () => {
		const before = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");
		const proposals = [
			{ oldText: "line 2\n", newText: "LINE 2\n" },
			{ oldText: "line 5\n", newText: "" },
			{ oldText: "line 7", newText: "LINE 7\nnew 7b" },
		];
		const placed = placeProposals(before, proposals);
		if (placed === null) throw new Error("not placed");
		const steps = lineReview(before, placed.text);
		const ids = steps.flatMap((step) => (step.kind === "change" ? [step.change.id] : []));
		expect(ids).toHaveLength(3);
		const kept = (...rejected: number[]) =>
			keptProposals(
				placed.text,
				placed.ranges,
				steps,
				new Map(rejected.map((id) => [id, "rejected" as ChangeDecision])),
			);
		expect(kept()).toEqual([true, true, true]);
		expect(kept(0)).toEqual([false, true, true]);
		expect(kept(1)).toEqual([true, false, true]);
		expect(kept(2)).toEqual([true, true, false]);
		expect(kept(0, 1, 2)).toEqual([false, false, false]);
	});
});
