/**
 * Arayüz metinleri  (İş listesi: F3-03, F6-10 hazırlığı)
 *
 * İki sözlüğün **aynı anahtar kümesini** taşıması, eksik çeviriyi
 * çalışma zamanında `undefined` olarak görmenin tek alternatifi.
 */
import { describe, expect, it } from "vitest";
import { enLabels, labelsFor, trLabels } from "./labels.js";

describe("sözlükler", () => {
	it("iki sözlük aynı anahtarları taşıyor", () => {
		expect(Object.keys(trLabels).sort()).toEqual(Object.keys(enLabels).sort());
	});

	it("hiçbir metin boş değil", () => {
		for (const [ad, deger] of Object.entries(trLabels)) {
			expect(deger, ad).not.toBe("");
		}
		for (const [ad, deger] of Object.entries(enLabels)) {
			expect(deger, ad).not.toBe("");
		}
	});
});

describe("dil seçimi", () => {
	it("tr Türkçe veriyor", () => {
		expect(labelsFor("tr")).toBe(trLabels);
	});

	it("bölge kodu da tanınıyor", () => {
		expect(labelsFor("tr-TR")).toBe(trLabels);
	});

	/** Büyük harfli dil kodu da geçerli (`TR`, `TR-tr`). */
	it("büyük/küçük harf fark etmiyor", () => {
		expect(labelsFor("TR")).toBe(trLabels);
	});

	it("bilinmeyen dil İngilizce veriyor", () => {
		expect(labelsFor("de")).toBe(enLabels);
	});

	it("dil yoksa İngilizce veriyor", () => {
		expect(labelsFor(null)).toBe(enLabels);
		expect(labelsFor(undefined)).toBe(enLabels);
	});
});
