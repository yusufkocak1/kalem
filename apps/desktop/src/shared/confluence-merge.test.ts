import { describe, expect, it } from "vitest";
import { conflictsOf, mergeBlocks, resolveMerge } from "./confluence-merge.js";
import { exportPage, importPage } from "./confluence-sync.js";

const doc = (...blocks: string[]): string => `${blocks.join("\n\n")}\n`;

describe("mergeBlocks", () => {
	it("takes each side's change where only that side changed a block", () => {
		const base = doc("# Plan", "Bir", "İki", "Üç");
		const yours = doc("# Plan", "Bir — benim", "İki", "Üç");
		const theirs = doc("# Plan", "Bir", "İki", "Üç — onların");
		const merge = mergeBlocks(base, yours, theirs);
		expect(merge?.conflicts).toBe(0);
		expect(merge?.yours).toBe(1);
		expect(merge?.theirs).toBe(1);
		expect(resolveMerge(merge!, [])).toBe(doc("# Plan", "Bir — benim", "İki", "Üç — onların"));
	});

	it("keeps additions and deletions from both sides", () => {
		const base = doc("A", "B", "C");
		const yours = doc("A", "Yeni", "B", "C");
		const theirs = doc("A", "B");
		const merge = mergeBlocks(base, yours, theirs)!;
		expect(merge.conflicts).toBe(0);
		expect(resolveMerge(merge, [])).toBe(doc("A", "Yeni", "B"));
	});

	it("takes the same change once", () => {
		const merge = mergeBlocks(doc("A", "B"), doc("A", "B!"), doc("A", "B!"))!;
		expect(merge.conflicts).toBe(0);
		expect(merge.both).toBe(1);
		expect(resolveMerge(merge, [])).toBe(doc("A", "B!"));
	});

	it("makes a block both changed differently a conflict, under its heading", () => {
		const base = doc("# Giriş", "A", "## Hedefler", "Hedef", "Son");
		const yours = doc("# Giriş", "A", "## Hedefler", "Hedef: hız", "Son");
		const theirs = doc("# Giriş", "A2", "## Hedefler", "Hedef: kalite", "Son");
		const merge = mergeBlocks(base, yours, theirs)!;
		expect(merge.theirs).toBe(1);
		const [conflict] = conflictsOf(merge);
		expect(conflict).toEqual({
			kind: "conflict",
			base: ["Hedef"],
			yours: ["Hedef: hız"],
			theirs: ["Hedef: kalite"],
			heading: "Hedefler",
		});
		expect(resolveMerge(merge, [undefined])).toBeNull();
		expect(resolveMerge(merge, ["yours"])).toBe(
			doc("# Giriş", "A2", "## Hedefler", "Hedef: hız", "Son"),
		);
		expect(resolveMerge(merge, ["theirs"])).toBe(
			doc("# Giriş", "A2", "## Hedefler", "Hedef: kalite", "Son"),
		);
		expect(resolveMerge(merge, ["both"])).toBe(
			doc("# Giriş", "A2", "## Hedefler", "Hedef: hız", "Hedef: kalite", "Son"),
		);
	});

	it("makes an edit of a block the other side deleted a conflict", () => {
		const merge = mergeBlocks(doc("A", "B", "C"), doc("A", "B düzeltildi", "C"), doc("A", "C"))!;
		const [conflict] = conflictsOf(merge);
		expect(conflict?.yours).toEqual(["B düzeltildi"]);
		expect(conflict?.theirs).toEqual([]);
		expect(resolveMerge(merge, ["theirs"])).toBe(doc("A", "C"));
	});

	it("leaves what both sides added alike out of the conflict", () => {
		const merge = mergeBlocks(
			doc("A", "Z"),
			doc("A", "X", "benim", "Y", "Z"),
			doc("A", "X", "onların", "Y", "Z"),
		)!;
		const [conflict] = conflictsOf(merge);
		expect(conflict?.yours).toEqual(["benim"]);
		expect(conflict?.theirs).toEqual(["onların"]);
		expect(resolveMerge(merge, ["yours"])).toBe(doc("A", "X", "benim", "Y", "Z"));
	});

	it("tells apart blocks the other side edited one after another", () => {
		const base = doc("A", "Tablo bir", "Kapsam", "Son");
		const yours = doc("A", "Tablo bir", "Kapsam", "Son benim");
		const theirs = doc("A", "Tablo iki", "Kapsam geniş", "Son onların");
		const merge = mergeBlocks(base, yours, theirs)!;
		expect(merge.theirs).toBe(2);
		const [conflict] = conflictsOf(merge);
		expect(merge.conflicts).toBe(1);
		expect(conflict?.base).toEqual(["Son"]);
		expect(resolveMerge(merge, ["yours"])).toBe(doc("A", "Tablo iki", "Kapsam geniş", "Son benim"));
	});

	it("keeps a new block apart from the edit of the block next to it", () => {
		const base = doc("A", "Hedef", "Z");
		const yours = doc("A", "Hedef net", "Z");
		const theirs = doc("A", "Tamamen yeni bir paragraf", "Hedef", "Z");
		const merge = mergeBlocks(base, yours, theirs)!;
		expect(merge.conflicts).toBe(0);
		expect(resolveMerge(merge, [])).toBe(doc("A", "Tamamen yeni bir paragraf", "Hedef net", "Z"));
	});

	it("tells an edit from a replacement when the other side rewrote a run of blocks", () => {
		const base = doc("A", "bir iki üç", "dört beş altı", "Z");
		const yours = doc("A", "bir iki üç", "dört beş altı yedi", "Z");
		const theirs = doc("A", "bir iki üç dört", "başka bir şey", "dört beş altı", "Z");
		const merge = mergeBlocks(base, yours, theirs)!;
		expect(merge.conflicts).toBe(0);
		expect(resolveMerge(merge, [])).toBe(
			doc("A", "bir iki üç dört", "başka bir şey", "dört beş altı yedi", "Z"),
		);
	});

	it("treats a list and a table as one block each", () => {
		const base = doc("- a\n- b", "| x |\n| - |\n| 1 |");
		const yours = doc("- a\n- b\n- c", "| x |\n| - |\n| 1 |");
		const theirs = doc("- a\n- b", "| x |\n| - |\n| 2 |");
		const merge = mergeBlocks(base, yours, theirs)!;
		expect(merge.conflicts).toBe(0);
		expect(resolveMerge(merge, [])).toBe(doc("- a\n- b\n- c", "| x |\n| - |\n| 2 |"));
	});

	it("finds nothing to merge when no one changed anything", () => {
		const text = doc("A", "B");
		const merge = mergeBlocks(text, text, text)!;
		expect(merge.chunks).toEqual([{ kind: "kept", blocks: ["A", "B"] }]);
		expect(resolveMerge(merge, [])).toBe(text);
	});
});

describe("mergeBlocks on random edits", () => {
	// A small deterministic generator: the same cases on every run.
	let seed = 7;
	const random = (n: number): number => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % n;
	};
	const edit = (blocks: string[], tag: string): string[] => {
		const out = [...blocks];
		for (let k = random(4); k >= 0; k--) {
			const at = random(out.length + 1);
			const op = random(3);
			if (op === 0) out.splice(at, 0, `${tag}${random(1000)}`);
			else if (op === 1 && at < out.length) out.splice(at, 1);
			else if (at < out.length) out[at] = `${out[at]} ${tag}`;
		}
		return out;
	};

	it("gives one side's text when the other changed nothing, and never loses a change silently", () => {
		for (let run = 0; run < 300; run++) {
			const base = Array.from({ length: 1 + random(8) }, (_, i) => `b${i}`);
			const yours = edit(base, "Y");
			const theirs = edit(base, "T");
			const text = (blocks: string[]): string => (blocks.length === 0 ? "" : doc(...blocks));

			expect(resolveMerge(mergeBlocks(text(base), text(yours), text(base))!, [])).toBe(text(yours));
			expect(resolveMerge(mergeBlocks(text(base), text(base), text(theirs))!, [])).toBe(
				text(theirs),
			);

			const merge = mergeBlocks(text(base), text(yours), text(theirs))!;
			const all = conflictsOf(merge).map(() => "both" as const);
			const merged = resolveMerge(merge, all)!;
			// Every block either side added is in the merge when conflicts keep both.
			for (const block of [...yours, ...theirs].filter((block) => !base.includes(block))) {
				expect(merged).toContain(block);
			}
		}
	});
});

describe("merging on top of the newer page", () => {
	const table =
		'<table><tbody><tr><td colspan="2" style="background-color: #fffae6;"><p>birleşik</p></td></tr></tbody></table>';
	const jira =
		'<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">ABC-12</ac:parameter></ac:structured-macro>';

	it("writes the other person's parts back as their XML, and only converts yours", () => {
		const base = `<h1>Plan</h1><p>Hedef</p>${table}<p>Son</p>`;
		// Someone added a macro and changed the table's text on Confluence.
		const theirTable = table.replace("birleşik", "güncel");
		const theirs = `<h1>Plan</h1><p>Hedef</p>${theirTable}${jira}<p>Son</p>`;
		const opened = importPage(base).markdown;
		const yours = opened.replace("Hedef", "Hedef **net**");

		const merge = mergeBlocks(opened, yours, importPage(theirs).markdown)!;
		expect(merge.conflicts).toBe(0);
		const text = resolveMerge(merge, [])!;
		const saved = exportPage(text, theirs, [base]).storage;
		expect(saved).toBe(
			`<h1>Plan</h1><p>Hedef <strong>net</strong></p>${theirTable}${jira}<p>Son</p>`,
		);
	});

	it("keeps a mention the newer page no longer has in a paragraph you edited", () => {
		const mention = '<ac:link><ri:user ri:userkey="u1" /></ac:link>';
		const base = `<p>Sor: ${mention}</p><p>Son</p>`;
		const theirs = "<p>Son değişti</p>";
		const opened = importPage(base).markdown;
		const yours = opened.replace("Sor:", "Sor hemen:");
		const merge = mergeBlocks(opened, yours, importPage(theirs).markdown)!;
		const text = resolveMerge(
			merge,
			conflictsOf(merge).map(() => "yours"),
		)!;
		expect(exportPage(text, theirs, [base]).storage).toContain(mention);
	});
});
