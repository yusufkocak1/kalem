import { describe, expect, it } from "vitest";
import { diffSequence, diffText, pairedRows, revertHunk, wordDiff } from "./text-diff.js";

describe("diffSequence", () => {
	it("finds the shortest edit", () => {
		// The classic example: five changes, four kept.
		const kinds = diffSequence([..."abcabba"], [..."cbabac"]);
		expect(kinds.filter((kind) => kind !== " ").length).toBe(5);
	});

	it("handles empty sides", () => {
		expect(diffSequence([], ["x"])).toEqual(["+"]);
		expect(diffSequence(["x"], [])).toEqual(["-"]);
		expect(diffSequence([], [])).toEqual([]);
	});

	it("keeps every element of both sides once", () => {
		const a = "the quick brown fox jumps over the lazy dog".split(" ");
		const b = "a quick red fox leaps over the dog today".split(" ");
		const kinds = diffSequence(a, b);
		expect(kinds.filter((kind) => kind !== "+").length).toBe(a.length);
		expect(kinds.filter((kind) => kind !== "-").length).toBe(b.length);
	});
});

describe("diffText", () => {
	const before = "# Başlık\n\nBir\nİki\nÜç\nDört\nBeş\nAltı\nYedi\nSekiz\nDokuz\nOn\n";

	it("is empty for equal texts", () => {
		expect(diffText(before, before)).toEqual({ hunks: [], added: 0, removed: 0 });
	});

	it("cuts changes far apart into hunks with context", () => {
		const after = before.replace("Bir", "Bir!").replace("On", "On!");
		const diff = diffText(before, after, 1);
		expect(diff.added).toBe(2);
		expect(diff.removed).toBe(2);
		expect(diff.hunks).toHaveLength(2);
		const [first] = diff.hunks;
		expect(first?.rows.map((row) => `${row.kind}${row.text}`)).toEqual([
			" ",
			"-Bir",
			"+Bir!",
			" İki",
		]);
		expect(first?.heading).toBe("Başlık");
		expect(first?.oldStart).toBe(1);
	});

	it("numbers lines on both sides", () => {
		const diff = diffText("a\nb\n", "a\nx\nb\n");
		expect(diff.hunks[0]?.rows.map((row) => [row.oldLine, row.newLine])).toEqual([
			[1, 1],
			[null, 2],
			[2, 3],
		]);
	});
});

describe("revertHunk", () => {
	it("puts back one hunk and keeps the others", () => {
		const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
		const after = "A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\nk\n";
		const diff = diffText(before, after, 1);
		expect(diff.hunks).toHaveLength(2);
		const firstBack = revertHunk(after, diff.hunks[0] as never);
		expect(firstBack).toBe("a\nb\nc\nd\ne\nf\ng\nh\ni\nJ\nk\n");
		const secondBack = revertHunk(after, diff.hunks[1] as never);
		expect(secondBack).toBe("A\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");
		// Every hunk back, last first: the old text.
		let text = after;
		for (const hunk of [...diff.hunks].reverse()) text = revertHunk(text, hunk);
		expect(text).toBe(before);
	});

	it("brings back removed lines", () => {
		const diff = diffText("a\nb\nc\n", "a\nc\n");
		expect(revertHunk("a\nc\n", diff.hunks[0] as never)).toBe("a\nb\nc\n");
	});
});

describe("wordDiff", () => {
	it("marks the words that changed", () => {
		const { before, after } = wordDiff(
			"Sistem 5 saniyede yanıt verir.",
			"Sistem 2 saniyede yanıt verir.",
		);
		expect(before.filter((part) => part.changed).map((part) => part.text)).toEqual(["5"]);
		expect(after.filter((part) => part.changed).map((part) => part.text)).toEqual(["2"]);
	});
});

describe("pairedRows", () => {
	it("pairs removed lines with the added lines after them", () => {
		const diff = diffText("a\nb\nc\n", "a\nB\nc\n");
		const rows = diff.hunks[0]?.rows ?? [];
		const pairs = pairedRows(rows);
		expect(pairs.get(rows[1] as never)?.text).toBe("B");
	});
});
