import { beforeEach, describe, expect, it } from "vitest";
import {
	bosNot,
	DEPO_ANAHTARI,
	type Not,
	notlariOku,
	notlariYaz,
	notuGuncelle,
	sirala,
	taslakAnahtari,
	yeniKimlik,
} from "./depo.js";

/** `Storage` yüzeyini taklit eden sahte depo; kota da taklit edilebiliyor. */
function sahteDepo(options: { kota?: number } = {}): Storage & { veri: Map<string, string> } {
	const veri = new Map<string, string>();
	const kota = options.kota ?? Number.POSITIVE_INFINITY;
	return {
		veri,
		get length() {
			return veri.size;
		},
		clear: () => veri.clear(),
		getItem: (k) => veri.get(k) ?? null,
		key: (i) => [...veri.keys()][i] ?? null,
		removeItem: (k) => {
			veri.delete(k);
		},
		setItem: (k, v) => {
			if (v.length > kota) throw new DOMException("dolu", "QuotaExceededError");
			veri.set(k, v);
		},
	};
}

describe("notlariOku", () => {
	let depo: ReturnType<typeof sahteDepo>;

	beforeEach(() => {
		depo = sahteDepo();
	});

	it("boş depodan boş liste dönüyor", () => {
		expect(notlariOku(depo)).toEqual([]);
		expect(notlariOku(null)).toEqual([]);
	});

	it("yazılanı geri okuyor", () => {
		const notlar: Not[] = [{ id: "a", metin: "# Bir", guncellenme: 5 }];
		expect(notlariYaz(depo, notlar)).toBe(true);
		expect(notlariOku(depo)).toEqual(notlar);
	});

	it("bozuk JSON'da boş dönüyor, patlamıyor", () => {
		// Kullanıcıya JSON hatası göstermek yerine boş defterle açmak, bir
		// not uygulamasında daha az kötü olan sonuç.
		depo.setItem(DEPO_ANAHTARI, "{bu json değil");
		expect(notlariOku(depo)).toEqual([]);
	});

	it("dizi olmayan kaydı atıyor", () => {
		depo.setItem(DEPO_ANAHTARI, '{"id":"a"}');
		expect(notlariOku(depo)).toEqual([]);
	});

	it("eksik alanlı kayıtları eleyip sağlamları bırakıyor", () => {
		depo.setItem(
			DEPO_ANAHTARI,
			JSON.stringify([
				{ id: "a", metin: "bir", guncellenme: 1 },
				{ id: "b", metin: "iki" },
				null,
				"metin",
				{ id: 3, metin: "üç", guncellenme: 2 },
			]),
		);
		expect(notlariOku(depo)).toEqual([{ id: "a", metin: "bir", guncellenme: 1 }]);
	});

	it("fazladan alanları taşımıyor", () => {
		depo.setItem(
			DEPO_ANAHTARI,
			JSON.stringify([{ id: "a", metin: "bir", guncellenme: 1, eski: true }]),
		);
		expect(notlariOku(depo)).toEqual([{ id: "a", metin: "bir", guncellenme: 1 }]);
	});
});

describe("notlariYaz", () => {
	it("kota dolduğunda false dönüyor", () => {
		// Sessizce yutulsaydı kullanıcı kaydedilmediğini hiç öğrenmezdi.
		const depo = sahteDepo({ kota: 10 });
		expect(notlariYaz(depo, [{ id: "a", metin: "çok uzun bir metin", guncellenme: 1 }])).toBe(
			false,
		);
	});

	it("depo yoksa false dönüyor", () => {
		expect(notlariYaz(null, [])).toBe(false);
	});
});

describe("notuGuncelle", () => {
	it("yalnızca hedef notu değiştiriyor", () => {
		const notlar: Not[] = [
			{ id: "a", metin: "bir", guncellenme: 1 },
			{ id: "b", metin: "iki", guncellenme: 2 },
		];
		const yeni = notuGuncelle(notlar, "b", "iki düzeltildi");
		expect(yeni[0]).toBe(notlar[0]);
		expect(yeni[1]?.metin).toBe("iki düzeltildi");
		expect(yeni[1]?.guncellenme).toBeGreaterThanOrEqual(2);
	});

	it("olmayan kimlikte listeyi olduğu gibi bırakıyor", () => {
		const notlar: Not[] = [{ id: "a", metin: "bir", guncellenme: 1 }];
		expect(notuGuncelle(notlar, "yok", "x")).toEqual(notlar);
	});
});

describe("sirala", () => {
	it("en son değişen en üstte", () => {
		const notlar: Not[] = [
			{ id: "eski", metin: "", guncellenme: 1 },
			{ id: "yeni", metin: "", guncellenme: 9 },
		];
		expect(sirala(notlar).map((n) => n.id)).toEqual(["yeni", "eski"]);
		// Girdiyi değiştirmiyor.
		expect(notlar[0]?.id).toBe("eski");
	});
});

describe("kimlikler", () => {
	it("üretilen kimlikler çakışmıyor", () => {
		const kimlikler = new Set(Array.from({ length: 500 }, () => yeniKimlik()));
		expect(kimlikler.size).toBe(500);
	});

	it("taslak anahtarı nota özgü", () => {
		// Ortak bir anahtar, bir notun taslağını başka bir nota getirirdi.
		expect(taslakAnahtari("a")).not.toBe(taslakAnahtari("b"));
		expect(taslakAnahtari("a")).toContain("a");
	});

	it("bosNot verilen metni taşıyor", () => {
		const not = bosNot("# Başlık");
		expect(not.metin).toBe("# Başlık");
		expect(not.id).not.toBe("");
	});
});
