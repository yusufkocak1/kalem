import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createSampleDocx } from "./sample-docx.test-helper.js";
import { numberHeadings, readWord, WordError } from "./word.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Headings numbered as Word numbers them: a list linked to the heading styles. */
async function numberedHeadingsDocx(): Promise<Uint8Array> {
	const style = (id: string, name: string) =>
		`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
	const level = (index: number, styleId: string) =>
		`<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="${styleId}"/></w:lvl>`;
	const heading = (styleId: string, text: string) =>
		`<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
	const zip = new JSZip();
	zip.file(
		"[Content_Types].xml",
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
	);
	zip.file(
		"_rels/.rels",
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
	);
	zip.file(
		"word/_rels/document.xml.rels",
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
	);
	zip.file(
		"word/styles.xml",
		`<w:styles ${W}>${style("Balk1", "heading 1")}${style("Balk2", "heading 2")}${style("Balk3", "heading 3")}</w:styles>`,
	);
	zip.file(
		"word/numbering.xml",
		`<w:numbering ${W}><w:abstractNum w:abstractNumId="0">${level(0, "Balk1")}${level(1, "Balk2")}${level(2, "Balk3")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
	);
	zip.file(
		"word/document.xml",
		`<w:document ${W}><w:body>${heading("Balk1", "Giriş")}${heading("Balk1", "Çözüm")}${heading("Balk2", "Fonksiyonel")}${heading("Balk3", "Vazgeç butonu")}${heading("Balk3", "Hatalar")}${heading("Balk2", "Veri")}<w:p><w:r><w:t>Gövde</w:t></w:r></w:p></w:body></w:document>`,
	);
	return zip.generateAsync({ type: "uint8array" });
}

describe("readWord", () => {
	it("extracts the document structure as HTML", async () => {
		const { html } = await readWord(await createSampleDocx());

		expect(html).toContain("<h1>Çeyrek Raporu</h1>");
		expect(html).toContain("<h1>Bulgular</h1>");
		expect(html).toContain("<h2>Sonraki adımlar</h2>");
		expect(html).toContain("<strong>üç</strong>");
		expect(html).toContain("<em>ölçüldü</em>");
		expect(html).toContain("<s>iptal</s>");
		expect(html).toContain('<a href="https://ornek.com/rapor">detaylı rapor</a>');
		expect(html).toContain("<blockquote><p>Ölçmediğin şeyi yönetemezsin.</p></blockquote>");
	});

	it("keeps list nesting and type", async () => {
		const { html } = await readWord(await createSampleDocx());
		expect(html).toContain("<li>Maliyet sabit kaldı<ul><li>Kira</li><li>Personel</li></ul></li>");
		expect(html).toContain("<ol><li>Bütçe gözden geçirilecek</li>");
	});

	it("extracts tables", async () => {
		const { html } = await readWord(await createSampleDocx());
		expect(html).toContain("<table><tr><td><p>Kalem</p></td><td><p>Tutar</p></td></tr>");
	});

	it("embeds drawable images and counts the ones it skips", async () => {
		const { html, skippedImages, warnings } = await readWord(await createSampleDocx());
		expect(html).toMatch(/<img alt="Kırmızı nokta" src="data:image\/png;base64,iVBOR[^"]+" \/>/);
		expect(html).toContain('<img alt="Kırmızı nokta" src="" />');
		expect(skippedImages).toBe(1);
		expect(warnings).toEqual([]);
	});

	it("keeps Word's heading numbers in the headings' text", async () => {
		const { html } = await readWord(await numberedHeadingsDocx());
		expect(html).toBe(
			"<h1>1 Giriş</h1><h1>2 Çözüm</h1><h2>2.1 Fonksiyonel</h2><h3>2.1.1 Vazgeç butonu</h3><h3>2.1.2 Hatalar</h3><h2>2.2 Veri</h2><p>Gövde</p>",
		);
	});

	it("numbers only headings in an ordered list, and a skipped level as 0", () => {
		const paragraph = (styleName: string, level: string | null, text: string) => ({
			type: "paragraph",
			styleName,
			numbering: level === null ? null : { level, isOrdered: true },
			children: [{ type: "run", children: [{ type: "text", value: text }] }],
		});
		const document = numberHeadings({
			type: "document",
			children: [
				paragraph("Heading 1", "0", "A"),
				paragraph("Heading 3", "2", "B"),
				paragraph("Heading 2", null, "C"),
				paragraph("List Paragraph", "0", "D"),
			],
		});
		expect(document.children.map((p) => p.children[0]?.children[0]?.value)).toEqual([
			"1 A",
			"1.0.1 B",
			"C",
			"D",
		]);
	});

	it("rejects legacy .doc files with a specific error", async () => {
		const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
		await expect(readWord(doc)).rejects.toMatchObject({
			name: "WordError",
			code: "legacy-format",
		});
	});

	it("fails cleanly on a file that is not a Word document", async () => {
		const result = readWord(new TextEncoder().encode("not a zip"));
		await expect(result).rejects.toBeInstanceOf(WordError);
		await expect(result).rejects.toMatchObject({ code: "invalid" });
	});
});
