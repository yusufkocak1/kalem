/**
 * Kasa katlaması — testler  (İş listesi: F4-03)
 *
 * Kabul kriterinin Türkçe yarısı burada sabitleniyor. Testlerin hiçbiri
 * çalışma zamanı locale'ine güvenmiyor: dil her çağrıda açıkça veriliyor,
 * çünkü kütüphaneyi kullanan uygulamanın makinesi Türkçe olmayabilir ve
 * asıl korunması gereken şey de o durum.
 */
import { describe, expect, it } from "vitest";
import { atWordBoundary, foldCase, isWordChar } from "./fold.js";

/** Katlanmış metinler eşit mi — aramanın "eşleşiyor" dediği şey. */
function esit(a: string, b: string, locale: string): boolean {
	return foldCase(a, locale).text === foldCase(b, locale).text;
}

describe("foldCase — Türkçe", () => {
	it("ışık ↔ IŞIK eşleşiyor", () => {
		expect(esit("ışık", "IŞIK", "tr")).toBe(true);
	});

	it("iyi ↔ İYİ eşleşiyor", () => {
		expect(esit("iyi", "İYİ", "tr")).toBe(true);
	});

	it("ışık ↔ İŞİK eşleşmiyor", () => {
		// Aksan katlansaydı ikisi de "isik" olurdu; bul-değiştir'de bu,
		// kullanıcının istemediği kelimeyi değiştirmek demek.
		expect(esit("ışık", "İŞİK", "tr")).toBe(false);
	});

	it("çıplak toLowerCase yanlış sonucu verirdi", () => {
		// Bu test kuralın kendisini değil, kuralın **gerekçesini** koruyor:
		// biri locale'i düşürürse burası kırmızıya döner.
		// kalem-locale-ok: kuralın ihlalini gösteren karşılaştırma
		expect("IŞIK".toLowerCase()).not.toBe("ışık");
		expect(foldCase("IŞIK", "tr").text).toBe("ışık");
	});

	it("İ İngilizce'de ayrışıyor, Türkçe'de ayrışmıyor", () => {
		expect(foldCase("İ", "tr").text).toBe("i");
		expect(foldCase("İ", "en").text.length).toBeGreaterThan(1);
	});
});

describe("foldCase — eşleme tablosu", () => {
	it("uzunluk değişmediğinde birebir", () => {
		const { text, map } = foldCase("ABC", "en");
		expect(text).toBe("abc");
		expect(map).toEqual([0, 1, 2, 3]);
	});

	it("uzayan katlamada özgün indisi koruyor", () => {
		// "İ" İngilizce'de i + birleştirici nokta oluyor: iki kod birimi,
		// tek özgün karakter. Tablo olmasa eşleşme bir karakter kayardı.
		const { text, map } = foldCase("İX", "en");
		expect(text.length).toBe(3);
		expect(map[0]).toBe(0);
		expect(map[1]).toBe(0);
		expect(map[2]).toBe(1);
		expect(map[3]).toBe(2);
	});

	it("tablo her zaman metinden bir uzun", () => {
		for (const ornek of ["", "abc", "İSTANBUL", "ıIiİ", "AÇIK"]) {
			for (const locale of ["tr", "en"]) {
				const katlanmis = foldCase(ornek, locale);
				expect(katlanmis.map.length, `${ornek}/${locale}`).toBe(katlanmis.text.length + 1);
			}
		}
	});

	it("vekil çifti bölmüyor", () => {
		// Kod birimi başına katlansaydı emoji ikiye bölünür ve geçersiz
		// metin üretirdi.
		const emoji = "😀a";
		const { text, map } = foldCase(emoji, "tr");
		expect(text).toBe(emoji);
		expect(map).toEqual([0, 0, 2, 3]);
	});

	it("boş metin boş katlanıyor", () => {
		expect(foldCase("", "tr")).toEqual({ text: "", map: [0] });
	});
});

describe("kelime sınırı", () => {
	it("Türkçe harfleri kelime karakteri sayıyor", () => {
		for (const ch of ["a", "ş", "İ", "ı", "ğ", "9", "_"]) {
			expect(isWordChar(ch), ch).toBe(true);
		}
	});

	it("noktalama ve boşluk kelime karakteri değil", () => {
		for (const ch of [" ", ".", "-", "\n", "("]) {
			expect(isWordChar(ch), JSON.stringify(ch)).toBe(false);
		}
	});

	it("metnin dışı sınır sayılıyor", () => {
		expect(atWordBoundary("kedi", 0, 4)).toBe(true);
	});

	it("kelimenin ortası sınır değil", () => {
		expect(atWordBoundary("kediler", 0, 4)).toBe(false);
	});

	it("Türkçe harf sınır sanılmıyor", () => {
		// `\b` ASCII tanımlı: "şeker" içinde "eker" tam kelime görünürdü.
		expect(atWordBoundary("şeker", 1, 5)).toBe(false);
	});
});
