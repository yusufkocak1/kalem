/**
 * Sözlük bütünlüğü  (İş listesi: F6-10, ilk yazımı F4-05)
 *
 * Kabul kriteri "sözlükte eksik anahtar kalmamış". Anahtar kümesinin
 * eşitliğini TypeScript zaten derlemede zorluyor; bu test onun
 * göremediklerini tutuyor:
 *
 * - **Boşluk iki dilde aynı mı.** Bazı metinler kasıtlı boş (boşta
 *   gösterge bir şey yazmıyor). Ama İngilizce'de boş, Türkçe'de dolu bir
 *   anahtar kasıt değil, eksik çeviri. "Hiç boş yok" kuralı kasıtlı
 *   boşlukları yasaklardı; doğru değişmez bu.
 * - **Fonksiyon metinleri gerçekten metin üretiyor mu.** Sayı alan
 *   metinler (`words(n)`) tip denetiminden geçip boş dize döndürebilir.
 * - **Dil seçimi.** Bölge kodu, büyük harf ve bilinmeyen dil.
 */
import { describe, expect, it } from "vitest";
import { enWordCountLabels, labelsFor, trWordCountLabels } from "./labels.js";

/** Sayı alan metinler için temsilî değerler: sıfır, tekil, çoğul, binlik. */
const SAYILAR = [0, 1, 2, 12_345];

type Sozluk = Readonly<Record<string, unknown>>;

function metinler(sozluk: Sozluk, anahtar: string): string[] {
	const deger = sozluk[anahtar];
	if (typeof deger === "string") return [deger];
	if (typeof deger === "function") return SAYILAR.map((n) => String(deger(n)));
	return [];
}

describe("sözlükler", () => {
	const en = enWordCountLabels as unknown as Sozluk;
	const tr = trWordCountLabels as unknown as Sozluk;

	it("iki sözlük aynı anahtarları taşıyor", () => {
		expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
	});

	it("her değer metin ya da metin üreten fonksiyon", () => {
		for (const [ad, deger] of [...Object.entries(en), ...Object.entries(tr)]) {
			expect(["string", "function"], ad).toContain(typeof deger);
		}
	});

	it("boş metinler iki dilde de boş", () => {
		for (const anahtar of Object.keys(en)) {
			if (typeof en[anahtar] !== "string") continue;
			expect(tr[anahtar] === "", `${anahtar}: yalnızca bir dilde boş`).toBe(en[anahtar] === "");
		}
	});

	it("fonksiyon metinleri boş dönmüyor", () => {
		for (const anahtar of Object.keys(en)) {
			if (typeof en[anahtar] !== "function") continue;
			for (const metin of [...metinler(en, anahtar), ...metinler(tr, anahtar)]) {
				expect(metin, anahtar).not.toBe("");
			}
		}
	});
});

describe("dil seçimi", () => {
	it("Türkçe bölge ve kasa farkı gözetmeden seçiliyor", () => {
		for (const dil of ["tr", "tr-TR", "TR", "tr-CY"])
			expect(labelsFor(dil)).toBe(trWordCountLabels);
	});

	it("bilinmeyen ya da verilmeyen dil İngilizce", () => {
		for (const dil of ["en", "de", "", null, undefined])
			expect(labelsFor(dil)).toBe(enWordCountLabels);
	});
});

describe("sayı biçimi", () => {
	/*
	 * F6-10'a kadar sayılar ham basılıyordu: "439689 karakter". Binlik
	 * ayırıcı dile göre değişiyor ve ters kullanılırsa sayı başka bir sayı
	 * gibi okunuyor — İngiliz okur "439.689"u dört yüz otuz dokuz virgül
	 * altı sekiz dokuz sanır.
	 */
	it("Türkçe binlik ayırıcı nokta", () => {
		expect(trWordCountLabels.characters(439_689)).toBe("439.689 karakter");
		expect(trWordCountLabels.words(12_345)).toBe("12.345 kelime");
	});

	it("İngilizce binlik ayırıcı virgül", () => {
		expect(enWordCountLabels.characters(439_689)).toBe("439,689 characters");
		expect(enWordCountLabels.words(12_345)).toBe("12,345 words");
	});

	it("dört basamaktan küçük sayılara ayırıcı girmiyor", () => {
		expect(trWordCountLabels.words(999)).toBe("999 kelime");
		expect(enWordCountLabels.words(999)).toBe("999 words");
	});

	it("tekil İngilizce'de ayrı, Türkçe'de aynı", () => {
		expect(enWordCountLabels.words(1)).toBe("1 word");
		expect(trWordCountLabels.words(1)).toBe("1 kelime");
	});
});
