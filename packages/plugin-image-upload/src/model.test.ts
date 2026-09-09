/**
 * Görsel yükleme — model katmanı  (İş listesi: F4-01)
 *
 * Yüklemenin ağa ve DOM'a dokunmayan yarısı. Tarayıcı testleri yalnızca
 * sürükle-bırakın buraya doğru bağlandığını doğruluyor.
 */

import type { Image } from "@kalem/core";
import { parse, serialize } from "@kalem/core";
import type { Caret } from "@kalem/editor";
import { describe, expect, it } from "vitest";
import {
	altFromFilename,
	imageAltAt,
	imageUrls,
	insertImage,
	rejectionOf,
	removeImage,
	replaceImageUrl,
	setImageAlt,
} from "./model.js";

const imlec = (blockIndex: number, offset: number): Caret => ({ blockIndex, path: [], offset });
const gorsel = (url: string, alt = "alt"): Image => ({ type: "image", url, alt, title: null });

describe("dosya kabulü", () => {
	it("görseli kabul ediyor", () => {
		expect(rejectionOf({ type: "image/png", size: 10 })).toBeNull();
	});

	it("görsel olmayanı reddediyor", () => {
		expect(rejectionOf({ type: "application/pdf", size: 10 })).toBe("type");
	});

	/** Önek karşılaştırması: yarın çıkacak biçim için liste güncellenmiyor. */
	it("bilinmeyen görsel biçimi de kabul ediliyor", () => {
		expect(rejectionOf({ type: "image/jxl", size: 10 })).toBeNull();
	});

	it("boyut sınırı aşılınca reddediyor", () => {
		expect(rejectionOf({ type: "image/png", size: 2000 }, { maxSize: 1000 })).toBe("size");
		expect(rejectionOf({ type: "image/png", size: 1000 }, { maxSize: 1000 })).toBeNull();
	});

	it("kabul listesi daraltılabiliyor", () => {
		const secenek = { accept: ["image/png"] };
		expect(rejectionOf({ type: "image/png", size: 1 }, secenek)).toBeNull();
		expect(rejectionOf({ type: "image/gif", size: 1 }, secenek)).toBe("type");
	});

	/** MIME türleri ASCII; büyük harfli gelen tür de tanınmalı. */
	it("büyük harfli MIME türü tanınıyor", () => {
		expect(rejectionOf({ type: "IMAGE/PNG", size: 1 })).toBeNull();
	});
});

describe("dosya adından alt metin", () => {
	it("uzantıyı ve ayraçları atıyor", () => {
		expect(altFromFilename("tatil-fotografi_2.jpg")).toBe("tatil fotografi 2");
	});

	it("uzantısız ad da çalışıyor", () => {
		expect(altFromFilename("kapak")).toBe("kapak");
	});

	it("Türkçe karakterler bozulmuyor", () => {
		expect(altFromFilename("ışık-gölge.png")).toBe("ışık gölge");
	});
});

describe("görsel ekleme", () => {
	it("imlece ekliyor", () => {
		const sonuc = insertImage(parse("abcd\n"), imlec(0, 2), gorsel("a.png"));
		expect(serialize(sonuc.doc)).toBe("ab![alt](a.png)cd\n");
		expect(sonuc.caret?.offset).toBe(3);
	});

	/** Sürüklenen dosya sessizce kaybolamaz. */
	it("imleç yoksa belgenin sonuna ekliyor", () => {
		const sonuc = insertImage(parse("abcd\n"), null, gorsel("a.png"));
		expect(serialize(sonuc.doc)).toBe("abcd\n\n![alt](a.png)\n");
	});

	it("metin taşımayan blokta sona ekliyor", () => {
		const sonuc = insertImage(parse("---\n"), imlec(0, 0), gorsel("a.png"));
		expect(serialize(sonuc.doc)).toBe("---\n\n![alt](a.png)\n");
	});
});

describe("görsel adresini değiştirme", () => {
	it("adresi güncelliyor", () => {
		const yeni = replaceImageUrl(parse("![alt](blob:1)\n"), "blob:1", { url: "https://a/1.png" });
		expect(serialize(yeni!)).toBe("![alt](https://a/1.png)\n");
	});

	it("alt metni de güncelleyebiliyor", () => {
		const yeni = replaceImageUrl(parse("![](blob:1)\n"), "blob:1", { url: "u", alt: "yeni" });
		expect(serialize(yeni!)).toBe("![yeni](u)\n");
	});

	/** Kullanıcı yükleme biterken görseli silmiş olabilir; bu hata değil. */
	it("görsel yoksa null dönüyor", () => {
		expect(replaceImageUrl(parse("abc\n"), "blob:1", { url: "u" })).toBeNull();
	});

	/** `[![alt](a.png)](hedef)` sık bir kalıp; üst düzeye bakmak yetmiyor. */
	it("bağlantı içindeki görseli de buluyor", () => {
		const yeni = replaceImageUrl(parse("[![a](blob:1)](https://h)\n"), "blob:1", { url: "u" });
		expect(serialize(yeni!)).toBe("[![a](u)](https://h)\n");
	});

	it("liste maddesindeki görseli de buluyor", () => {
		const yeni = replaceImageUrl(parse("- ![a](blob:1)\n"), "blob:1", { url: "u" });
		expect(serialize(yeni!)).toBe("- ![a](u)\n");
	});

	/** Editörün hedefli DOM yaması nesne kimliğine dayanıyor (F2-05). */
	it("değişmeyen bloklar aynı nesne kalıyor", () => {
		const doc = parse("bir\n\n![a](blob:1)\n\nüç\n");
		const yeni = replaceImageUrl(doc, "blob:1", { url: "u" });
		expect(yeni?.children[0]).toBe(doc.children[0]);
		expect(yeni?.children[2]).toBe(doc.children[2]);
		expect(yeni?.children[1]).not.toBe(doc.children[1]);
	});
});

describe("görsel silme", () => {
	it("görseli çıkarıyor", () => {
		const yeni = removeImage(parse("ab![a](blob:1)cd\n"), "blob:1");
		expect(serialize(yeni!)).toBe("abcd\n");
	});

	/** Hedefsiz kalan boş bağlantı görünmez bir artık olurdu. */
	it("içi boşalan bağlantı da düşüyor", () => {
		const yeni = removeImage(parse("[![a](blob:1)](https://h)\n"), "blob:1");
		// Geriye boş bir paragraf kalıyor ve onun Markdown karşılığı boş
		// dize — blok duruyor, kullanıcı oraya yazmaya devam edebiliyor.
		expect(serialize(yeni!)).toBe("");
		expect(yeni?.children).toHaveLength(1);
	});

	it("metni olan bağlantı duruyor", () => {
		const yeni = removeImage(parse("[metin ![a](blob:1)](https://h)\n"), "blob:1");
		expect(serialize(yeni!)).toBe("[metin ](https://h)\n");
	});

	it("görsel yoksa null dönüyor", () => {
		expect(removeImage(parse("abc\n"), "blob:1")).toBeNull();
	});
});

describe("görsel adresleri", () => {
	it("belgedeki tüm adresleri topluyor", () => {
		const doc = parse("![a](1.png)\n\n- [![b](2.png)](h)\n");
		expect(imageUrls(doc)).toEqual(["1.png", "2.png"]);
	});
});

describe("alt metin düzenleme", () => {
	/**
	 * İndeksle çalışıyor, adresle değil: düzenlenen görsel hâlâ
	 * yükleniyor olabiliyor ve adresi o sırada geçici.
	 */
	it("belge sırasına göre alt metni okuyor", () => {
		const doc = parse("![bir](1.png) ![iki](2.png)\n");
		expect(imageAltAt(doc, 0)).toBe("bir");
		expect(imageAltAt(doc, 1)).toBe("iki");
		expect(imageAltAt(doc, 2)).toBeNull();
	});

	it("alt metni yazıyor", () => {
		const yeni = setImageAlt(parse("![eski](a.png)\n"), 0, "yeni");
		expect(serialize(yeni!)).toBe("![yeni](a.png)\n");
	});

	it("yalnızca hedeflenen görseli değiştiriyor", () => {
		const yeni = setImageAlt(parse("![bir](1.png) ![iki](2.png)\n"), 1, "X");
		expect(serialize(yeni!)).toBe("![bir](1.png) ![X](2.png)\n");
	});

	/** Değişiklik yoksa gereksiz bir yeniden çizim tetiklenmemeli. */
	it("aynı metin verilince null dönüyor", () => {
		expect(setImageAlt(parse("![a](1.png)\n"), 0, "a")).toBeNull();
	});

	it("aralık dışı indeks null dönüyor", () => {
		expect(setImageAlt(parse("![a](1.png)\n"), 5, "X")).toBeNull();
	});

	it("alt metin boşaltılabiliyor", () => {
		const yeni = setImageAlt(parse("![a](1.png)\n"), 0, "");
		expect(serialize(yeni!)).toBe("![](1.png)\n");
	});
});
