/**
 * Belge dilinin tek kaynağı  (İş listesi: F6-10)
 *
 * `resolveLang` DOM'un yalnızca dört alanına dokunuyor; düz nesnelerle
 * sınanıyor (bkz. `read.test.ts`teki aynı gerekçe). Gerçek tarayıcıdaki
 * davranış — seçeneğin elemana yazılması, eklentilerin aynı dili görmesi —
 * `e2e/i18n.spec.ts`te.
 */
import { describe, expect, it } from "vitest";
import type { LangSource } from "./lang.js";
import { resolveLang } from "./lang.js";

interface Kurulum {
	/** En yakın dolu `lang` atası; yoksa `null`. */
	ata?: string | null;
	kok?: string;
	tarayici?: string;
	/** Belgeye bağlı değil (`ownerDocument` yok). */
	bagsiz?: boolean;
	pencereYok?: boolean;
}

function kaynak(k: Kurulum): LangSource & { sorulan: string[] } {
	const sorulan: string[] = [];
	return {
		sorulan,
		closest(selectors) {
			sorulan.push(selectors);
			return k.ata == null ? null : { getAttribute: () => k.ata ?? null };
		},
		ownerDocument: k.bagsiz
			? null
			: {
					documentElement: { lang: k.kok ?? "" },
					defaultView: k.pencereYok ? null : { navigator: { language: k.tarayici ?? "" } },
				},
	};
}

describe("zincir", () => {
	it("eleman ya da atası kazanıyor", () => {
		expect(resolveLang(kaynak({ ata: "tr", kok: "en", tarayici: "de" }))).toBe("tr");
	});

	it("ata yoksa <html lang>", () => {
		expect(resolveLang(kaynak({ kok: "tr-TR", tarayici: "de" }))).toBe("tr-TR");
	});

	it("sayfa dil beyan etmiyorsa tarayıcının dili", () => {
		/*
		 * F6-10'dan önce hiçbir kopyada olmayan halka buydu: dil beyan
		 * etmeyen bir sayfada Türk kullanıcı İngilizce arayüz görüyordu.
		 */
		expect(resolveLang(kaynak({ tarayici: "tr-TR" }))).toBe("tr-TR");
	});

	it("hiçbiri yoksa İngilizce", () => {
		expect(resolveLang(kaynak({}))).toBe("en");
	});

	it("belgeye bağlı olmayan eleman atsız da çözülüyor", () => {
		expect(resolveLang(kaynak({ bagsiz: true }))).toBe("en");
	});

	it("penceresiz belgede (SSR ayrıştırıcıları) patlamıyor", () => {
		expect(resolveLang(kaynak({ kok: "", pencereYok: true }))).toBe("en");
	});
});

describe("boş lang", () => {
	it("boş lang'i atlayan seçici kullanılıyor", () => {
		/*
		 * `lang=""` HTML'de "dil bilinmiyor" demek. Düz `[lang]` onu
		 * buluyor ve zincir boş dizeyle bitiyordu; her karşılaştırma
		 * sessizce köke düşüyordu.
		 */
		const k = kaynak({ kok: "tr" });
		resolveLang(k);
		expect(k.sorulan).toEqual(['[lang]:not([lang=""])']);
	});

	it("boş <html lang> tarayıcıya düşüyor", () => {
		expect(resolveLang(kaynak({ kok: "", tarayici: "tr" }))).toBe("tr");
	});

	it("boş tarayıcı dili İngilizce'ye düşüyor", () => {
		expect(resolveLang(kaynak({ tarayici: "" }))).toBe("en");
	});
});

describe("değer olduğu gibi dönüyor", () => {
	it("bölge kodu korunuyor", () => {
		// Sözlük seçimi yalnızca dil koduna bakıyor ama `Intl` bölgeyi
		// kullanıyor (tr-TR ile tr-CY sayı biçimi aynı, en-US ile en-GB
		// tarih biçimi değil) — kırpmak çağıranın işi.
		expect(resolveLang(kaynak({ ata: "en-GB" }))).toBe("en-GB");
	});

	it("büyük harf korunuyor", () => {
		// `Intl` kasa duyarsız; normalleştirmek burada kayıp olurdu.
		expect(resolveLang(kaynak({ ata: "TR" }))).toBe("TR");
	});
});
