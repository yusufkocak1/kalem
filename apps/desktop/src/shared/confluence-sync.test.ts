import { describe, expect, it } from "vitest";
import { exportPage, importPage, lockedLabel, segmentsOf } from "./confluence-sync.js";

const TABLE =
	'<table class="wrapped"><colgroup><col style="width: 140px;" /><col style="width: 300px;" /></colgroup><tbody><tr><th>Ad</th><th>Not</th></tr><tr><td colspan="2" style="background-color: #fffae6;"><p>birleşik</p></td></tr></tbody></table>';
const JIRA =
	'<ac:structured-macro ac:name="jira" ac:schema-version="1"><ac:parameter ac:name="key">ABC-12</ac:parameter></ac:structured-macro>';
const MENTION = '<p>Sorumlu: <ac:link><ri:user ri:userkey="u1" /></ac:link></p>';
const PAGE = `<h1>Başlık</h1>\n<p>Birinci paragraf.</p>\n${TABLE}\n${JIRA}\n${MENTION}\n<p>Son paragraf.</p>`;

describe("segmentsOf", () => {
	it("cuts the page into its top-level parts; joined, they are the page", () => {
		const segments = segmentsOf(PAGE);
		expect(segments.map((segment) => segment.xml).join("")).toBe(PAGE);
		expect(segments).toHaveLength(6);
		expect(segments.map((segment) => segment.locked)).toEqual([
			false,
			false,
			false,
			true,
			false,
			false,
		]);
	});

	it("joins parts that read as nothing to the next one", () => {
		const segments = segmentsOf("<p></p><ac:placeholder>x</ac:placeholder><p>metin</p>");
		expect(segments).toHaveLength(1);
		expect(segments[0]?.markdown).toBe("metin");
	});
});

describe("importPage", () => {
	it("shows unsupported macros as locked placeholders", () => {
		const { markdown } = importPage(PAGE);
		const box = markdown.split("\n\n").find((block) => block.startsWith("<!-- confluence:keep"));
		expect(box).toBeDefined();
		expect(lockedLabel(box as string)).toBe("jira");
		expect(lockedLabel("<!-- başka -->")).toBeNull();
	});

	it("reports what editing could lose, but not the locked macros", () => {
		const { losses } = importPage(PAGE);
		expect(losses.sort()).toEqual(["mention", "merged-cells"]);
	});
});

describe("exportPage", () => {
	it("writes an untouched page back as it was", () => {
		const { markdown } = importPage(PAGE);
		expect(exportPage(markdown, PAGE)).toEqual({ storage: PAGE, losses: [] });
	});

	it("rewrites only the edited paragraph", () => {
		const { markdown } = importPage(PAGE);
		const edited = markdown.replace("Birinci paragraf.", "Birinci **güncel** paragraf.");
		const { storage, losses } = exportPage(edited, PAGE);
		// The blank line before a part goes with it; a rewritten part has none.
		expect(storage).toBe(
			PAGE.replace(
				"\n<p>Birinci paragraf.</p>",
				"<p>Birinci <strong>güncel</strong> paragraf.</p>",
			),
		);
		// The mention and the merged cells are in parts nobody touched.
		expect(losses).toEqual([]);
	});

	it("warns only about the part that is rewritten", () => {
		const { markdown } = importPage(PAGE);
		const edited = markdown.replace("Sorumlu:", "Sorumlu kişi:");
		const { storage, losses } = exportPage(edited, PAGE);
		expect(losses).toEqual(["mention"]);
		expect(storage).toContain(TABLE);
		expect(storage).toContain(JIRA);
	});

	it("keeps a locked macro where it is moved, and drops it when deleted", () => {
		const { markdown } = importPage(PAGE);
		const blocks = markdown.trim().split("\n\n");
		const box = blocks.find((block) => block.startsWith("<!-- confluence:keep")) as string;
		const moved = [box, ...blocks.filter((block) => block !== box)].join("\n\n");
		const out = exportPage(moved, PAGE);
		expect(out.storage.trimStart().startsWith(JIRA)).toBe(true);
		expect(out.storage).toContain(TABLE);

		const deleted = blocks.filter((block) => block !== box).join("\n\n");
		expect(exportPage(deleted, PAGE).storage).not.toContain("jira");
	});

	it("converts added blocks and keeps the parts around them", () => {
		const { markdown } = importPage(PAGE);
		const edited = markdown.replace(
			"Son paragraf.",
			"Yeni madde:\n\n- bir\n- iki\n\nSon paragraf.",
		);
		const { storage } = exportPage(edited, PAGE);
		expect(storage).toContain("<p>Yeni madde:</p><ul><li>bir</li><li>iki</li></ul>");
		expect(storage.endsWith("\n<p>Son paragraf.</p>")).toBe(true);
		expect(storage).toContain(TABLE);
	});

	it("ignores Kalem's table style comments when matching", () => {
		const { markdown } = importPage(PAGE);
		const styled = markdown.replace("| Ad |", "<!-- kalem-table color=blue -->\n\n| Ad |");
		expect(exportPage(styled, PAGE).storage).toBe(PAGE);
	});

	it("is a plain conversion without a base", () => {
		expect(exportPage("# a\n\nb\n", null).storage).toBe("<h1>a</h1><p>b</p>");
	});
});
