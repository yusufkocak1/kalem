/**
 * Blok yapısı düzenlemeleri  (İş listesi: F2-08)
 *
 * Enter, Backspace, Tab ve liste dönüşümlerinin tamamı burada saf olarak
 * sınanıyor: girdi bir belge ve bir imleç, çıktı yeni belge ve imlecin yeni
 * yeri. Tarayıcı testleri yalnızca tuşun buraya doğru bağlandığını
 * doğruluyor — davranışın kendisi burada sabitleniyor.
 */
import { parse, serialize } from "@kalem/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Caret, EditResult } from "./block-edit.js";
import {
	indentItem,
	insertBreak,
	mergeWithNext,
	mergeWithPrevious,
	normalizeDocument,
	outdentItem,
	splitAtCaret,
	toggleList,
} from "./block-edit.js";
import { assignIds, resetIds } from "./ids.js";

beforeEach(() => {
	resetIds();
});

const belge = (markdown: string) => assignIds(parse(markdown));
const imlec = (blockIndex: number, path: number[], offset: number): Caret => ({
	blockIndex,
	path,
	offset,
});

/** Sonucu Markdown olarak yazar. */
function md(sonuc: EditResult | null): string {
	if (sonuc === null) return "<null>";
	return serialize(sonuc.doc);
}

describe("Enter — bölme", () => {
	it("paragrafı ortadan bölüyor", () => {
		const sonuc = splitAtCaret(belge("abcdef\n"), imlec(0, [], 3));
		expect(md(sonuc)).toBe("abc\n\ndef\n");
		expect(sonuc?.caret).toEqual(imlec(1, [], 0));
	});

	it("paragrafın sonunda boş paragraf açıyor", () => {
		// Boş paragraf modelde gerçekten var; Markdown'da karşılığı boş satır.
		expect(md(splitAtCaret(belge("abc\n"), imlec(0, [], 3)))).toBe("abc\n\n\n");
	});

	/** Başlığın ortasında Enter ikinci bir başlık değil, altına metin açar. */
	it("başlığın ikinci yarısı paragraf oluyor", () => {
		expect(md(splitAtCaret(belge("# abcdef\n"), imlec(0, [], 3)))).toBe("# abc\n\ndef\n");
	});

	it("biçim bölünme sırasında korunuyor", () => {
		expect(md(splitAtCaret(belge("**abcd**\n"), imlec(0, [], 2)))).toBe("**ab**\n\n**cd**\n");
	});

	it("liste maddesini yeni maddeye bölüyor", () => {
		expect(md(splitAtCaret(belge("- abcd\n"), imlec(0, [0, 0], 2)))).toBe("- ab\n- cd\n");
	});

	it("görev maddesi bölününce yeni madde işaretsiz", () => {
		// Yeni bir iş eklendi; yapılmış sayılamaz.
		expect(md(splitAtCaret(belge("- [x] abcd\n"), imlec(0, [0, 0], 2)))).toBe(
			"- [x] ab\n- [ ] cd\n",
		);
	});

	/**
	 * Her editörde listeyi bitirmenin yolu.
	 *
	 * `normalizeDocument` şart: ayrıştırıcı boş maddeyi **çocuksuz** üretir
	 * ve o hâliyle imleç konulacak bir yeri yoktur.
	 */
	it("boş maddede Enter listeden çıkarıyor", () => {
		const doc = normalizeDocument(belge("- bir\n- \n"));
		expect(md(splitAtCaret(doc, imlec(0, [1, 0], 0)))).toBe("- bir\n\n\n");
	});

	it("alıntı içinde Enter alıntıdan çıkarmıyor", () => {
		expect(md(splitAtCaret(belge("> abcd\n"), imlec(0, [0], 2)))).toBe("> ab\n>\n> cd\n");
	});
});

describe("Shift+Enter — satır sonu", () => {
	it("sert satır sonu ekliyor", () => {
		const sonuc = insertBreak(belge("abcd\n"), imlec(0, [], 2));
		expect(md(sonuc)).toBe("ab\\\ncd\n");
		expect(sonuc?.caret.offset).toBe(3);
	});
});

describe("Backspace — birleştirme", () => {
	it("paragrafı öncekiyle birleştiriyor", () => {
		const sonuc = mergeWithPrevious(belge("abc\n\ndef\n"), imlec(1, [], 0));
		expect(md(sonuc)).toBe("abcdef\n");
		// İmleç birleşme noktasında: kullanıcı sildiği şeyin nereye gittiğini görmeli.
		expect(sonuc?.caret).toEqual(imlec(0, [], 3));
	});

	it("başlığa birleşince başlık kalıyor", () => {
		expect(md(mergeWithPrevious(belge("# abc\n\ndef\n"), imlec(1, [], 0)))).toBe("# abcdef\n");
	});

	it("ilk blokta hiçbir şey yapmıyor", () => {
		expect(mergeWithPrevious(belge("abc\n"), imlec(0, [], 0))).toBeNull();
	});

	/** Metin taşımayan blokla birleşme olmaz; Backspace onu siler. */
	it("yatay çizgiyi siliyor", () => {
		expect(md(mergeWithPrevious(belge("abc\n\n---\n\ndef\n"), imlec(2, [], 0)))).toBe(
			"abc\n\ndef\n",
		);
	});

	it("liste maddesini öncekiyle birleştiriyor", () => {
		expect(md(mergeWithPrevious(belge("- abc\n- def\n"), imlec(0, [1, 0], 0)))).toBe("- abcdef\n");
	});

	it("ilk maddede Backspace maddeyi listeden çıkarıyor", () => {
		expect(md(mergeWithPrevious(belge("- abc\n- def\n"), imlec(0, [0, 0], 0)))).toBe(
			"abc\n\n- def\n",
		);
	});
});

describe("Delete — sonraki bloğu çekme", () => {
	it("sonraki paragrafı ekliyor", () => {
		const sonuc = mergeWithNext(belge("abc\n\ndef\n"), imlec(0, [], 3));
		expect(md(sonuc)).toBe("abcdef\n");
	});

	it("son blokta hiçbir şey yapmıyor", () => {
		expect(mergeWithNext(belge("abc\n"), imlec(0, [], 3))).toBeNull();
	});
});

describe("Tab — liste girintisi", () => {
	it("maddeyi içeri alıyor", () => {
		expect(md(indentItem(belge("- bir\n- iki\n"), imlec(0, [1, 0], 0)))).toBe("- bir\n  - iki\n");
	});

	/** Girintili maddenin üstünde bir ana madde olmak zorunda. */
	it("ilk madde girintilenemiyor", () => {
		expect(indentItem(belge("- bir\n- iki\n"), imlec(0, [0, 0], 0))).toBeNull();
	});

	it("var olan iç listeye ekliyor", () => {
		const doc = belge("- bir\n  - ic\n- iki\n");
		expect(md(indentItem(doc, imlec(0, [1, 0], 0)))).toBe("- bir\n  - ic\n  - iki\n");
	});

	it("Shift+Tab maddeyi dışarı alıyor", () => {
		const doc = belge("- bir\n  - ic\n");
		expect(md(outdentItem(doc, imlec(0, [0, 1, 0, 0], 0)))).toBe("- bir\n- ic\n");
	});
});

describe("liste dönüşümleri", () => {
	it("paragrafı madde imli listeye çeviriyor", () => {
		expect(md(toggleList(belge("abc\n"), imlec(0, [], 0), false))).toBe("- abc\n");
	});

	it("paragrafı numaralı listeye çeviriyor", () => {
		expect(md(toggleList(belge("abc\n"), imlec(0, [], 0), true))).toBe("1. abc\n");
	});

	it("aynı türde listede maddeleri paragrafa çeviriyor", () => {
		expect(md(toggleList(belge("- bir\n- iki\n"), imlec(0, [0, 0], 0), false))).toBe(
			"bir\n\niki\n",
		);
	});

	it("madde imliden numaralıya geçiyor", () => {
		expect(md(toggleList(belge("- bir\n- iki\n"), imlec(0, [0, 0], 0), true))).toBe(
			"1. bir\n2. iki\n",
		);
	});

	it("başlığı da listeye çevirebiliyor", () => {
		expect(md(toggleList(belge("# abc\n"), imlec(0, [], 0), false))).toBe("- abc\n");
	});
});
