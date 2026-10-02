import { describe, expect, it } from "vitest";
import { createSampleDocx } from "./sample-docx.test-helper.js";
import { readWord, WordError } from "./word.js";

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
