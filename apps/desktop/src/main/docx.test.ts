import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/bridge.js";
import type { DocxImage, DocxOptions } from "./docx.js";
import { markdownToDocx } from "./docx.js";

const PNG: DocxImage = {
	data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	info: { type: "png", width: 4000, height: 1000 },
};

function options(patch: Partial<DocxOptions> = {}): DocxOptions {
	return {
		title: "Rapor",
		page: DEFAULT_SETTINGS,
		loadImage: async (url) => (url === "logo.png" ? PNG : null),
		...patch,
	};
}

async function parts(markdown: string, patch: Partial<DocxOptions> = {}) {
	const zip = await JSZip.loadAsync(await markdownToDocx(markdown, options(patch)));
	const read = async (name: string) => (await zip.file(name)?.async("string")) ?? "";
	return {
		document: await read("word/document.xml"),
		numbering: await read("word/numbering.xml"),
		files: Object.keys(zip.files),
	};
}

describe("markdownToDocx", () => {
	it("writes headings, formatting, colors and links", async () => {
		const { document } = await parts(
			'# Başlık\n\n**kalın** *eğik* ~~çizik~~ `kod` <span style="color:#e03131">kırmızı</span> [site](https://example.com)\n',
		);
		expect(document).toContain('w:val="Heading1"');
		expect(document).toContain("Başlık");
		expect(document).toMatch(/<w:b\/>.*kalın/s);
		expect(document).toMatch(/<w:i\/>.*eğik/s);
		expect(document).toMatch(/<w:strike\/>.*çizik/s);
		expect(document).toMatch(/Consolas.*kod/s);
		expect(document).toMatch(/w:val="E03131".*kırmızı/s);
		expect(document).toContain("<w:hyperlink");
	});

	it("numbers lists, restarts each ordered list and marks tasks", async () => {
		const { document, numbering } = await parts(
			"1. bir\n2. iki\n   - alt\n\nara\n\n5. beş\n\n- [x] bitti\n- [ ] kaldı\n",
		);
		expect(numbering).toContain('w:val="decimal"');
		expect(numbering).toContain('w:val="5"');
		expect(document).toMatch(/<w:ilvl w:val="1"\/>/);
		expect(document).toContain("☑ ");
		expect(document).toContain("☐ ");
		const instances = new Set(document.match(/<w:numId w:val="\d+"\/>/g));
		expect(instances.size).toBeGreaterThanOrEqual(3);
	});

	it("writes code line by line, quotes, rules and tables with their style", async () => {
		const { document } = await parts(
			[
				"> alıntı",
				"",
				"```js",
				"const a = 1;",
				"  return a;",
				"```",
				"",
				"---",
				"",
				"<!-- kalem:table color=blue widths=120,, -->",
				"",
				"| Ad | Yaş |",
				"| --- | ---: |",
				"| Ali | 30 |",
				"",
			].join("\n"),
		);
		expect(document).toContain("alıntı");
		expect(document).toMatch(/w:left[^>]*w:val="single"/);
		expect(document).toContain("const a = 1;");
		expect(document).toContain("  return a;");
		expect(document).toContain("<w:tbl>");
		expect(document).toContain('w:fill="2F6FD0"');
		expect(document).toContain('w:w="1800"');
		expect(document).toContain('w:val="right"');
		expect(document).not.toContain("kalem:table");
	});

	it("embeds images scaled to the page and falls back to the alt text", async () => {
		const { document, files } = await parts("![Logo](logo.png) ![Kayıp](yok.png)\n");
		expect(files.some((name) => name.startsWith("word/media/"))).toBe(true);
		// A4 with 2.5 cm margins leaves 16 cm: 6.3 inch at 914400 EMU per inch.
		const cx = Number(/<wp:extent cx="(\d+)"/.exec(document)?.[1]);
		expect(cx / 914400).toBeCloseTo(16 / 2.54, 1);
		expect(document).toContain("Kayıp");
	});

	it("uses the page setup and page numbers", async () => {
		const { document } = await parts("metin\n", {
			page: {
				...DEFAULT_SETTINGS,
				pageSize: "A5",
				landscape: true,
				margins: "narrow",
				pageNumbers: true,
			},
		});
		expect(document).toMatch(/<w:pgSz [^>]*w:orient="landscape"/);
		expect(document).toMatch(/<w:pgMar [^>]*w:left="720"/);
		expect(document).toContain("<w:footerReference");
	});
});

describe("a Word reader", () => {
	it("reads the exported document back", async () => {
		const mammoth = await import("mammoth");
		const docx = await markdownToDocx(
			"# Başlık\n\nMetin **kalın**.\n\n1. bir\n2. iki\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
			options(),
		);
		const { value, messages } = await mammoth.convertToHtml({ buffer: Buffer.from(docx) });
		expect(messages.filter((message) => message.type === "error")).toEqual([]);
		expect(value).toContain("<h1>Başlık</h1>");
		expect(value).toContain("<strong>kalın</strong>");
		expect(value).toContain("<ol><li>bir</li><li>iki</li></ol>");
		expect(value).toContain("<table>");
	});
});

describe("footnotes", () => {
	it("become Word footnotes and leave the body", async () => {
		const zip = await JSZip.loadAsync(
			await markdownToDocx(
				"Bir[^1] iki[^uzun].\n\n[^1]: Tek\n\n[^uzun]: Uzun bir **not**.\n",
				options(),
			),
		);
		const document = (await zip.file("word/document.xml")?.async("string")) ?? "";
		const notes = (await zip.file("word/footnotes.xml")?.async("string")) ?? "";
		expect(document.match(/<w:footnoteReference w:id="\d+"\/>/g)).toHaveLength(2);
		expect(document).not.toContain("[^");
		expect(document).not.toContain("Uzun bir");
		expect(notes).toContain("Tek");
		expect(notes).toMatch(/<w:b\/>.*not/s);
	});
});
