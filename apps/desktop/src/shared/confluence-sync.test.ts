import { describe, expect, it } from "vitest";
import { markdownToStorage, storageToMarkdown } from "./confluence-storage.js";
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

	it("reports what editing could lose, but not locked macros or inline atoms", () => {
		const { losses } = importPage(PAGE);
		expect(losses).toEqual(["merged-cells"]);
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

	it("keeps a mention when the paragraph around it is edited", () => {
		const { markdown } = importPage(PAGE);
		const edited = markdown.replace("Sorumlu:", "Sorumlu kişi:");
		const { storage, losses } = exportPage(edited, PAGE);
		expect(losses).toEqual([]);
		expect(storage).toContain(
			'<p>Sorumlu kişi: <ac:link><ri:user ri:userkey="u1" /></ac:link></p>',
		);
		expect(storage).toContain(TABLE);
		expect(storage).toContain(JIRA);
	});

	it("warns about the merged cells only when that table is edited", () => {
		const { markdown } = importPage(PAGE);
		const { losses } = exportPage(markdown.replace("birleşik", "birleşik hücre"), PAGE);
		expect(losses).toEqual(["merged-cells"]);
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

describe("inline atoms", () => {
	const LINK =
		'<ac:link><ri:page ri:content-title="Kurulum" ri:space-key="DEV" /><ac:plain-text-link-body><![CDATA[kurulum sayfası]]></ac:plain-text-link-body></ac:link>';
	const DATE = '<time datetime="2026-10-06" />';
	const STATUS =
		'<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">TAMAM</ac:parameter></ac:structured-macro>';
	const MENTION_LINK = '<ac:link><ri:user ri:userkey="u1" /></ac:link>';
	const ATOMS = `<p>Bkz. ${LINK}, son tarih ${DATE}, durum ${STATUS}.</p><p>Sorumlu: ${MENTION_LINK}</p>`;

	it("shows them as kept links with what they read as", () => {
		const { markdown, losses } = importPage(ATOMS);
		expect(markdown).toMatch(/\[kurulum sayfası\]\(#confluence-keep-[0-9a-f]{8}\)/);
		expect(markdown).toMatch(/\[2026-10-06\]\(#confluence-keep-[0-9a-f]{8}\)/);
		expect(markdown).toMatch(/\[TAMAM\]\(#confluence-keep-[0-9a-f]{8}\)/);
		expect(markdown).toMatch(/\[@u1\]\(#confluence-keep-[0-9a-f]{8}\)/);
		expect(losses).toEqual([]);
	});

	it("writes them back as they were when the text around them changes", () => {
		const { markdown } = importPage(ATOMS);
		const { storage, losses } = exportPage(markdown.replace("Bkz.", "Ayrıntı için bkz."), ATOMS);
		expect(storage).toBe(
			`<p>Ayrıntı için bkz. ${LINK}, son tarih ${DATE}, durum ${STATUS}.</p><p>Sorumlu: ${MENTION_LINK}</p>`,
		);
		expect(losses).toEqual([]);
	});

	it("keeps an atom moved to another paragraph and drops a deleted one", () => {
		const { markdown } = importPage(ATOMS);
		const status = /\[TAMAM\]\(#confluence-keep-[0-9a-f]{8}\)/.exec(markdown)?.[0] as string;
		const moved = markdown
			.replace(`, durum ${status}`, "")
			.replace("Sorumlu:", `${status} Sorumlu:`);
		const { storage } = exportPage(moved, ATOMS);
		expect(storage).toContain(`<p>${STATUS} Sorumlu: ${MENTION_LINK}</p>`);
		expect(storage.match(/ac:name="status"/g)).toHaveLength(1);

		const date = /\[2026-10-06\]\(#confluence-keep-[0-9a-f]{8}\)/.exec(markdown)?.[0] as string;
		expect(exportPage(markdown.replace(`, son tarih ${date}`, ""), ATOMS).storage).not.toContain(
			"<time",
		);
	});

	it("stays plain text outside the page sync", () => {
		expect(storageToMarkdown(ATOMS)).not.toContain("confluence-keep");
		// A link to an atom the page does not have is its text.
		expect(markdownToStorage("[x](#confluence-keep-00000000)\n")).toBe("<p>x</p>");
	});
});
