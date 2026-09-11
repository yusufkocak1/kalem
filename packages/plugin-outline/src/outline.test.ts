/**
 * Başlık ağacı — testler  (İş listesi: F4-04)
 */
import { parse } from "@kalem/core";
import { assignIds } from "@kalem/editor";
import { describe, expect, it } from "vitest";
import { outlineOf, sameOutline } from "./outline.js";

/** `depth/level: metin` biçiminde okunur bir özet. */
function ozet(md: string): string[] {
	return outlineOf(parse(md)).map((h) => `${h.depth}/${h.level}: ${h.text}`);
}

describe("outlineOf", () => {
	it("başlıksız belgede boş", () => {
		expect(outlineOf(parse("Paragraf.\n"))).toEqual([]);
	});

	it("başlıkları belge sırasında veriyor", () => {
		expect(ozet("# Bir\n\n## İki\n\n# Üç\n")).toEqual(["1/1: Bir", "2/2: İki", "1/1: Üç"]);
	});

	it("atlanan derece girintiyi şişirmiyor", () => {
		// `#` sonrası `###` iki seviye girinti demek, üç değil.
		expect(ozet("# Giriş\n\n### Alt\n\n### Öteki\n\n## Sonuç\n")).toEqual([
			"1/1: Giriş",
			"3/2: Alt",
			"3/2: Öteki",
			"2/2: Sonuç",
		]);
	});

	it("belge daha derin bir başlıkla başlayabiliyor", () => {
		expect(ozet("### Sadece bu\n\n#### Alt\n")).toEqual(["3/1: Sadece bu", "4/2: Alt"]);
	});

	it("setext başlıkları da geliyor", () => {
		expect(ozet("Başlık\n======\n")).toEqual(["1/1: Başlık"]);
	});

	it("biçimlendirme düz metne iniyor", () => {
		expect(ozet("# **Kalın** ve `kod`\n")).toEqual(["1/1: Kalın ve kod"]);
	});

	it("görsel başlık metnine girmiyor", () => {
		expect(ozet("# Başlık ![alt](x.png)\n")).toEqual(["1/1: Başlık"]);
	});

	it("alıntı içindeki başlık da listede", () => {
		const [baslik] = outlineOf(parse("> ## Alıntıdaki\n"));
		expect(baslik).toMatchObject({ depth: 2, text: "Alıntıdaki", path: [0] });
	});

	it("blok kimliği ve indisi taşınıyor", () => {
		// Kimlikleri ayrıştırıcı değil editör veriyor (`assignIds`); eklenti
		// belgeyi hep editörden alıyor, yani test de aynı hâli kurmalı.
		const doc = assignIds(parse("# Bir\n\nmetin\n\n## İki\n"));
		const basliklar = outlineOf(doc);
		expect(basliklar[0]?.blockIndex).toBe(0);
		expect(basliklar[1]?.blockIndex).toBe(2);
		expect(basliklar[0]?.blockId).toBe(doc.children[0]?.id);
		expect(basliklar[1]?.blockId).toBe(doc.children[2]?.id);
	});

	it("kimliksiz belgede blok kimliği boş dize", () => {
		// Editörsüz kullanım (betik, SSR): başlıklar yine çıkıyor, yalnızca
		// DOM'a bağlanamıyorlar.
		expect(outlineOf(parse("# Bir\n"))[0]?.blockId).toBe("");
	});

	it("boş başlık metni boş dize", () => {
		expect(ozet("#\n")).toEqual(["1/1: "]);
	});

	it("tablo hücresindeki metin başlık sanılmıyor", () => {
		expect(outlineOf(parse("| # a | b |\n| --- | --- |\n| c | d |\n"))).toEqual([]);
	});
});

describe("sameOutline", () => {
	const a = outlineOf(parse("# Bir\n\n## İki\n"));

	it("aynı belgenin iki çıkarımı eşit", () => {
		const doc = assignIds(parse("# Bir\n\n## İki\n"));
		expect(sameOutline(outlineOf(doc), outlineOf(doc))).toBe(true);
	});

	it("başlık başka bir bloğa taşınınca eşit değil", () => {
		// Kimlik karşılaştırması bunun için var: metin aynı kalsa bile
		// panelin bağlantısı artık başka bir elemana gitmeli.
		const doc = assignIds(parse("# Bir\n\n## İki\n"));
		const tasinmis = outlineOf(doc).map((h) => ({ ...h, blockId: "baska" }));
		expect(sameOutline(outlineOf(doc), tasinmis)).toBe(false);
	});

	it("metin değişince eşit değil", () => {
		const doc = parse("# Bir\n");
		const bozuk = outlineOf(doc).map((h) => ({ ...h, text: "Başka" }));
		expect(sameOutline(outlineOf(doc), bozuk)).toBe(false);
	});

	it("sayı değişince eşit değil", () => {
		expect(sameOutline(a, a.slice(1))).toBe(false);
	});
});
