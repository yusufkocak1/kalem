import { describe, expect, it } from "vitest";
import { dedent } from "./metin.js";

describe("dedent", () => {
	it("HTML girintisini söküyor", () => {
		const kaynak = "\n\t\t\t# Başlık\n\n\t\t\tParagraf.\n\t\t";
		expect(dedent(kaynak)).toBe("# Başlık\n\nParagraf.");
	});

	it("göreli girintiyi koruyor", () => {
		// Liste seviyeleri ve kod blokları ortak öneğin **üstünde** kalıyor;
		// sökülseydi iç içe liste düz listeye dönerdi.
		const kaynak = "    * dış\n        * iç\n";
		expect(dedent(kaynak)).toBe("* dış\n    * iç");
	});

	it("gerçek kod bloğunu bozmuyor", () => {
		const kaynak = "  Metin\n\n      dört boşlukla girintili kod\n";
		expect(dedent(kaynak)).toBe("Metin\n\n    dört boşlukla girintili kod");
	});

	it("boş satırlar ortak öneki etkilemiyor", () => {
		// Boş satırın girintisi yok; hesaba katılsaydı ortak önek boş çıkar
		// ve hiçbir şey sökülmezdi.
		const kaynak = "\n    bir\n\n    iki\n";
		expect(dedent(kaynak)).toBe("bir\n\niki");
	});

	it("girintisiz metne dokunmuyor", () => {
		expect(dedent("# Başlık\nParagraf.")).toBe("# Başlık\nParagraf.");
	});

	it("baştaki ve sondaki boş satırları atıyor", () => {
		expect(dedent("\n\n# Başlık\n\n\n")).toBe("# Başlık");
	});

	it("yalnızca boşluktan oluşan metin boş dönüyor", () => {
		expect(dedent("\n   \n\t\n")).toBe("");
		expect(dedent("")).toBe("");
	});

	it("sekme ile boşluk karışımında ortak önek harf harf hesaplanıyor", () => {
		// `\t  ` ile `\t\t` ortak önekte yalnızca `\t` paylaşıyor; sekmeyi
		// "boşluk sayısı" sanan bir uygulama burada fazladan söker.
		expect(dedent("\t  bir\n\t\tiki")).toBe("  bir\n\tiki");
	});
});
