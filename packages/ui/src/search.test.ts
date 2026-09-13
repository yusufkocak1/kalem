/**
 * Locale duyarlı arama katlaması  (İş listesi: F3-03)
 *
 * F3-03'ün locale kabul kriteri buradaki testlerle sabitleniyor. Sıradan
 * `toLowerCase()` bu vakaların yarısında sessizce yanlış cevap veriyor;
 * kapıyı (F0-04) tamamlayan asıl güvence bu testler.
 */
import { describe, expect, it } from "vitest";
import { foldForSearch, matches, score } from "./search.js";

describe("Türkçe büyük/küçük katlaması", () => {
	it("büyük İ küçük i oluyor", () => {
		expect(foldForSearch("İSTATİSTİK", "tr")).toBe("istatistik");
	});

	/** Sıradan `toLowerCase()` burada `başlik` üretir — noktalı i ile. */
	it("büyük I noktasız ı olup i'ye katlanıyor", () => {
		expect(foldForSearch("BAŞLIK", "tr")).toBe("baslik");
	});

	it("küçük harf girdide de aynı sonuç", () => {
		expect(foldForSearch("Başlık", "tr")).toBe(foldForSearch("BAŞLIK", "tr"));
	});
});

describe("aksan katlaması", () => {
	it("Türkçe aksanlar sadeleşiyor", () => {
		expect(foldForSearch("şğüöç", "tr")).toBe("sguoc");
	});

	it("İngilizce locale'de de aksan sadeleşiyor", () => {
		expect(foldForSearch("café", "en")).toBe("cafe");
	});

	/** `ı` aksanlı harf değil, ayrı bir harf: Unicode ayrıştırması katlamıyor. */
	it("noktasız ı ayrıca eşleniyor", () => {
		expect(foldForSearch("ılık", "tr")).toBe("ilik");
	});
});

describe("eşleşme", () => {
	it("boş sorgu her şeyle eşleşiyor", () => {
		expect(matches("Başlık 1", "", "tr")).toBe(true);
	});

	/** F3-03 kabul kriteri: `/bas` ile "Başlık 1". */
	it("aksansız sorgu aksanlı metni buluyor", () => {
		expect(matches("Başlık 1", "bas", "tr")).toBe(true);
	});

	/** F3-03 kabul kriteri: `/baş` ve `/BAŞ` aynı sonucu veriyor. */
	it("büyük ve küçük sorgu aynı", () => {
		expect(matches("Başlık 1", "baş", "tr")).toBe(matches("Başlık 1", "BAŞ", "tr"));
		expect(matches("Başlık 1", "BAŞ", "tr")).toBe(true);
	});

	/** F3-03 kabul kriteri: `/ıst` ile "İstatistik". */
	it("noktasız ı ile noktalı İ eşleşiyor", () => {
		expect(matches("İstatistik", "ıst", "tr")).toBe(true);
	});

	it("eşleşmeyen sorgu yanlış dönüyor", () => {
		expect(matches("Başlık 1", "kod", "tr")).toBe(false);
	});

	it("ortadaki eşleşme de bulunuyor", () => {
		expect(matches("Kod bloğu", "blo", "tr")).toBe(true);
	});
});

describe("sıralama puanı", () => {
	/** `/bas` yazan kullanıcı "Başlık"ı, içinde "bas" geçen bir şeyden önce görmeli. */
	it("baştan eşleşme daha yüksek", () => {
		expect(score("Başlık 1", "bas", "tr")).toBeGreaterThan(score("Ana başlık", "bas", "tr"));
	});

	it("eşleşmeyen negatif", () => {
		expect(score("Kod", "xyz", "tr")).toBe(-1);
	});

	it("boş sorguda hepsi eşit", () => {
		expect(score("Başlık", "", "tr")).toBe(score("Kod", "", "tr"));
	});
});

describe("bul-değiştirden kasıtlı fark  (F6-10)", () => {
	/*
	 * Slash menü araması `ı` ile `i`yi **eşleştiriyor**; bul-değiştir
	 * eşleştirmiyor (`plugin-find-replace/src/fold.test.ts`). İkisi de
	 * doğru, çünkü işleri farklı:
	 *
	 * - Burada kullanıcı bir **komut** arıyor ve klavyesinde `ı` olmayabilir.
	 *   `/ilik` yazan "Ilık"ı bulamazsa menü işe yaramaz görünür.
	 * - Bul-değiştir **metin** değiştiriyor. "ılık"ı "sıcak" yapan
	 *   kullanıcının belgesindeki "ilik" kelimesi de değişirse bu veri kaybı.
	 *
	 * İki davranışı "tutarlı olsun" diye birleştirmek ikisinden birini
	 * bozar. Bu test ve karşı dosyadaki eşi bunun için var.
	 */
	it("komut aramasında noktasız ı noktalı i ile eşleşiyor", () => {
		expect(matches("Ilık su", "ilik", "tr")).toBe(true);
		expect(matches("İstatistik", "ıst", "tr")).toBe(true);
	});

	it("komut aramasında aksan da katlanıyor", () => {
		// `dil-ve-yon.md` tablosunun son satırı.
		expect(matches("Başlık 1", "bas", "tr")).toBe(true);
	});
});
