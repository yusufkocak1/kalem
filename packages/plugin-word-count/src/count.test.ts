/**
 * Sayma — testler  (İş listesi: F4-05)
 */
import { parse } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import { countText, countWords } from "./count.js";
import { textOf } from "./text.js";

describe("countWords", () => {
	it("boş metinde sıfır", () => {
		expect(countWords("", "tr")).toBe(0);
		expect(countWords("   \n  ", "tr")).toBe(0);
	});

	it("Türkçe cümleyi sayıyor", () => {
		expect(countWords("Işık ve gölge birlikte gelir", "tr")).toBe(5);
	});

	it("noktalama kelime sayılmıyor", () => {
		expect(countWords("Merhaba, dünya!", "tr")).toBe(2);
	});

	it("kesme işaretli kelime tek parça", () => {
		// "Türkiye'nin" bir kelime; ayrı sayılsa metin şişerdi.
		expect(countWords("Türkiye'nin başkenti", "tr")).toBe(2);
	});

	it("sayılar kelime sayılıyor", () => {
		expect(countWords("2026 yılında", "tr")).toBe(2);
	});

	it("tire ile ayrılmış sözcükler", () => {
		// Sözcük sınırı tablosu tireyi ayırıcı sayıyor; Word da öyle.
		expect(countWords("bilgi-işlem", "tr")).toBe(2);
	});

	it("boşluksuz yazılarda da sayıyor", () => {
		// Japonca bir cümle: boşluk ayırmayla 1 çıkardı.
		expect(countWords("これは日本語の文です", "ja")).toBeGreaterThan(1);
	});

	it("satır sonları ayırıcı", () => {
		expect(countWords("bir\niki\tüç", "tr")).toBe(3);
	});

	it("emoji tek başına kelime değil", () => {
		expect(countWords("merhaba 👋", "tr")).toBe(1);
	});
});

describe("countText", () => {
	it("karakterleri kod noktası olarak sayıyor", () => {
		// `String.length` emojiyi 2 sayardı.
		expect(countText("a👋", { locale: "tr" }).characters).toBe(2);
	});

	it("boşluksuz karakter ayrı", () => {
		const sonuc = countText("bir iki", { locale: "tr" });
		expect(sonuc.characters).toBe(7);
		expect(sonuc.charactersNoSpaces).toBe(6);
	});

	it("boş belgede okuma süresi sıfır", () => {
		expect(countText("", { locale: "tr" }).minutes).toBe(0);
	});

	it("tek kelime bile en az bir dakika", () => {
		expect(countText("merhaba", { locale: "tr" }).minutes).toBe(1);
	});

	it("okuma süresi yukarı yuvarlanıyor", () => {
		const metin = `${"kelime ".repeat(450)}son`;
		// 451 kelime / 200 = 2.25 → 3
		expect(countText(metin, { locale: "tr" }).minutes).toBe(3);
	});

	it("okuma hızı ayarlanabiliyor", () => {
		const metin = "kelime ".repeat(100);
		expect(countText(metin, { locale: "tr", wordsPerMinute: 50 }).minutes).toBe(2);
	});
});

describe("textOf", () => {
	it("paragraf ve başlık metni", () => {
		expect(textOf(parse("# Başlık\n\nParagraf.\n"))).toBe("Başlık\nParagraf.");
	});

	it("Markdown işaretleri sayılmıyor", () => {
		expect(textOf(parse("bu **kalın** ve *eğik*\n"))).toBe("bu kalın ve eğik");
	});

	it("liste ve alıntı içeriği geliyor", () => {
		expect(textOf(parse("- bir\n- iki\n\n> alıntı\n"))).toBe("bir\niki\nalıntı");
	});

	it("tablo hücreleri geliyor", () => {
		expect(textOf(parse("| a | b |\n| --- | --- |\n| c | d |\n"))).toBe("a\nb\nc\nd");
	});

	it("kod bloğu varsayılan olarak sayılıyor", () => {
		expect(textOf(parse("```js\nconst x = 1;\n```\n"))).toContain("const x = 1;");
	});

	it("kod bloğu dışarıda bırakılabiliyor", () => {
		const md = "Metin.\n\n```js\nconst x = 1;\n```\n";
		// Atlanan blok ayraç da bırakmıyor.
		expect(textOf(parse(md), { includeCode: false })).toBe("Metin.");
	});

	it("bağlantı tanımı sayılmıyor", () => {
		expect(textOf(parse("Metin.\n\n[a]: https://ornek.com\n"))).toBe("Metin.");
	});

	it("görselin alt metni sayılmıyor", () => {
		expect(textOf(parse("bak ![uzun bir alt metin](x.png)\n"))).toBe("bak ");
	});

	it("bağlantı metni sayılıyor, adresi sayılmıyor", () => {
		expect(textOf(parse("[Kalem](https://ornek.com) iyidir\n"))).toBe("Kalem iyidir");
	});

	it("satır içi kod sayılıyor", () => {
		expect(textOf(parse("`kod` yazısı\n"))).toBe("kod yazısı");
	});

	it("bloklar birbirine yapışmıyor", () => {
		// Ayraç olmasaydı "birikinci" tek kelime sayılırdı.
		expect(countWords(textOf(parse("bir\n\nikinci\n")), "tr")).toBe(2);
	});

	it("boş belgede boş metin", () => {
		expect(textOf(parse(""))).toBe("");
	});
});
