/**
 * Satır içi aralık düzenleme  (İş listesi: F2-07)
 *
 * Biçimlendirmenin beyni burada ve tamamı saf: DOM yok, seçim yok, sadece
 * `Inline[]` ve iki ofset. Tarayıcı tarafı (seçimin ofsete çevrilmesi,
 * bloğun yeniden basılması, imlecin geri konması) `e2e/editor.spec.ts`'te.
 */
import type { Inline } from "@kalem/core";
import { serialize } from "@kalem/core";
import { describe, expect, it } from "vitest";
import {
	applyLink,
	applyMark,
	listLength,
	markActive,
	sliceInline,
	spliceInline,
} from "./inline-edit.js";

const metin = (value: string): Inline => ({ type: "text", value });
const kalin = (...children: Inline[]): Inline => ({ type: "strong", children });
const italik = (...children: Inline[]): Inline => ({ type: "emphasis", children });

/** Sonucu Markdown olarak yazar — iddiaları okunur kılıyor. */
function md(nodes: readonly Inline[]): string {
	return serialize({
		type: "root",
		children: [{ type: "paragraph", children: [...nodes] }],
	}).replace(/\n$/, "");
}

describe("uzunluk", () => {
	it("metin karakter sayısı kadar", () => {
		expect(listLength([metin("abc")])).toBe(3);
	});

	it("satır sonu bir karakter", () => {
		// `offsets.ts` `<br>`'yi de 1 sayıyor; ikisi ayrışırsa seçim kayar.
		expect(listLength([metin("a"), { type: "break" }, metin("b")])).toBe(3);
	});

	/**
	 * Görsel tek karakterlik atomik öğe. Eskiden 0'dı ve imleç görselin iki
	 * yanında aynı ofsete düştüğü için görsel seçilemiyor, silinemiyordu.
	 */
	it("görsel bir", () => {
		expect(listLength([{ type: "image", url: "/r.png", alt: "kedi", title: null }])).toBe(1);
	});

	it("sarmalayıcı çocuklarının toplamı", () => {
		expect(listLength([kalin(metin("abc"))])).toBe(3);
	});
});

describe("sliceInline", () => {
	it("düz metni kesiyor", () => {
		expect(sliceInline([metin("abcdef")], 1, 4)).toEqual([metin("bcd")]);
	});

	/** Asıl kural: sarmalayıcı düşerse `hasMark` yanlış cevap verir. */
	it("sarmalayıcıyı koruyor", () => {
		expect(sliceInline([kalin(metin("abc"))], 1, 2)).toEqual([kalin(metin("b"))]);
	});

	it("düğüm sınırını aşan aralık", () => {
		const nodes = [metin("ab"), kalin(metin("cd")), metin("ef")];
		expect(md(sliceInline(nodes, 1, 5))).toBe("b**cd**e");
	});

	it("aralık dışındaki düğümler atlanıyor", () => {
		expect(sliceInline([metin("ab"), kalin(metin("cd"))], 0, 2)).toEqual([metin("ab")]);
	});

	it("boş aralık boş liste", () => {
		expect(sliceInline([metin("abc")], 1, 1)).toEqual([]);
	});

	/** Bir görselin yarısı diye bir şey yok. */
	it("kısmen kapsanan atomik düğüm atlanıyor", () => {
		const nodes: Inline[] = [
			metin("ab"),
			{ type: "image", url: "/r.png", alt: "", title: null },
			metin("cd"),
		];
		expect(sliceInline(nodes, 0, 1)).toEqual([metin("a")]);
	});
});

describe("applyMark", () => {
	it("düz metne kalın uyguluyor", () => {
		expect(md(applyMark([metin("abcdef")], 1, 4, "strong"))).toBe("a**bcd**ef");
	});

	/** F2-07'nin kabul kriteri: tekrar basınca kalkıyor. */
	it("tamamı kalınsa kaldırıyor", () => {
		const once = applyMark([metin("abcdef")], 1, 4, "strong");
		expect(md(applyMark(once, 1, 4, "strong"))).toBe("abcdef");
	});

	it("kalın metnin ortasını seçip kaldırmak parçalıyor", () => {
		const kalinMetin = [kalin(metin("abcdef"))];
		expect(md(applyMark(kalinMetin, 2, 4, "strong"))).toBe("**ab**cd**ef**");
	});

	it("kısmen kalın aralık tamamen kalınlaşıyor", () => {
		const nodes = [metin("ab"), kalin(metin("cd"))];
		expect(md(applyMark(nodes, 0, 4, "strong"))).toBe("**abcd**");
	});

	/**
	 * Çıktı `***abc***` değil `__*abc*__`: serileştirici, dıştaki işaret
	 * içtekiyle çakışınca alternatife geçiyor (F1-07). İkisi de geçerli,
	 * ikincisi tekanlamlı.
	 */
	it("iç içe farklı biçimler korunuyor", () => {
		expect(md(applyMark([italik(metin("abc"))], 0, 3, "strong"))).toBe("__*abc*__");
	});

	it("kod biçimi içeriği düz metne indiriyor", () => {
		// `inlineCode` çocuk taşımaz; içindeki kalınlık kaybolmak zorunda.
		expect(md(applyMark([kalin(metin("abc"))], 0, 3, "inlineCode"))).toBe("`abc`");
	});

	it("boş aralık listeyi değiştirmiyor", () => {
		const nodes = [metin("abc")];
		expect(applyMark(nodes, 2, 2, "strong")).toEqual(nodes);
	});

	/** Bölünmüş kalınlık gerçekten bozuk Markdown üretir: `**a****b**`. */
	it("bitişik aynı biçimler birleşiyor", () => {
		const nodes = [kalin(metin("ab")), metin("cd")];
		expect(md(applyMark(nodes, 2, 4, "strong"))).toBe("**abcd**");
	});

	it("Türkçe karakterlerde ofset kaymıyor", () => {
		expect(md(applyMark([metin("ışık ve gölge")], 0, 4, "strong"))).toBe("**ışık** ve gölge");
	});
});

describe("markActive", () => {
	it("tamamı kalınsa doğru", () => {
		expect(markActive([kalin(metin("abc"))], 0, 3, "strong")).toBe(true);
	});

	it("ortasını seçmek de doğru — sarmalayıcı korunduğu için", () => {
		expect(markActive([kalin(metin("abc"))], 1, 2, "strong")).toBe(true);
	});

	it("kısmen kalınsa yanlış", () => {
		expect(markActive([metin("ab"), kalin(metin("cd"))], 0, 4, "strong")).toBe(false);
	});

	/**
	 * Sabit araç çubuğu (F3-06) seçim olmadan da duruyor: imleç kalın bir
	 * kelimenin içindeyken B yanmalı. Balon çubuğu boş seçimde gizlendiği
	 * için bu durumu hiç göstermiyordu.
	 */
	it("boş imleçte soldaki karakterin biçimi geçerli", () => {
		expect(markActive([kalin(metin("abc"))], 1, 1, "strong")).toBe(true);
	});

	/** Yazmaya devam eden kullanıcı soldaki biçimi sürdürüyor. */
	it("kalın metnin hemen sağında hâlâ kalın", () => {
		expect(markActive([kalin(metin("ab")), metin("cd")], 2, 2, "strong")).toBe(true);
	});

	it("düz metnin içinde yanlış", () => {
		expect(markActive([metin("abcd")], 2, 2, "strong")).toBe(false);
	});

	/** Bloğun başında sol komşu yok; tek makul cevap sağdaki karakter. */
	it("blok başında sağdaki karaktere bakılıyor", () => {
		expect(markActive([kalin(metin("ab"))], 0, 0, "strong")).toBe(true);
		expect(markActive([metin("ab")], 0, 0, "strong")).toBe(false);
	});
});

describe("applyLink", () => {
	it("aralığı bağlantıya çeviriyor", () => {
		expect(md(applyLink([metin("abcdef")], 1, 4, "/y"))).toBe("a[bcd](/y)ef");
	});

	it("boş url bağlantıyı kaldırıyor", () => {
		const bagli = applyLink([metin("abc")], 0, 3, "/y");
		expect(md(applyLink(bagli, 0, 3, ""))).toBe("abc");
	});

	/** Markdown'da iç içe bağlantı yok; içerideki açılmak zorunda. */
	it("var olan bağlantı iç içe geçmiyor", () => {
		const bagli = applyLink([metin("abcdef")], 1, 4, "/eski");
		expect(md(applyLink(bagli, 0, 6, "/yeni"))).toBe("[abcdef](/yeni)");
	});

	it("bağlantı içindeki biçim korunuyor", () => {
		expect(md(applyLink([kalin(metin("abc"))], 0, 3, "/y"))).toBe("[**abc**](/y)");
	});
});

/**
 * Sıfır uzunluklu düğümler  (F4-01'de bulundu)
 *
 * Görselin ofset uzunluğu 0. Sıfır uzunluklu bir düğüm hiçbir aralıkla
 * çakışmadığı için eski kural onu hem baştan hem kuyruktan eliyordu:
 * imleci görselin yanına koyup bir şey eklemek görseli **siliyordu**.
 */
describe("sıfır uzunluklu düğümler", () => {
	const gorsel = (url = "u"): Inline => ({ type: "image", url, alt: "x", title: null });

	it("görselin hemen önüne ekleme onu silmiyor", () => {
		const nodes: Inline[] = [metin("ab"), gorsel()];
		expect(spliceInline(nodes, 2, 2, [metin("Z")])).toEqual([metin("abZ"), gorsel()]);
	});

	it("görselin hemen arkasına ekleme onu silmiyor", () => {
		const nodes: Inline[] = [gorsel(), metin("ab")];
		expect(spliceInline(nodes, 0, 0, [metin("Z")])).toEqual([metin("Z"), gorsel(), metin("ab")]);
	});

	/** Listenin tam sonundaki görsel kuyruk diliminde kalmalı. */
	it("sondaki görsel korunuyor", () => {
		const nodes: Inline[] = [metin("ab"), gorsel()];
		expect(spliceInline(nodes, 0, 1, [])).toEqual([metin("b"), gorsel()]);
	});

	it("iki görsel arasına ekleme ikisini de koruyor", () => {
		const nodes: Inline[] = [gorsel("1"), gorsel("2")];
		const sonuc = spliceInline(nodes, 0, 0, [metin("Z")]);
		expect(sonuc.filter((n) => n.type === "image")).toHaveLength(2);
	});

	/** Aralığın **içinde** kalan görsel silinmeli — kullanıcı onu seçmiş. */
	it("seçili aralıktaki görsel siliniyor", () => {
		// a=0 b=1 görsel=2 c=3 d=4
		const nodes: Inline[] = [metin("ab"), gorsel(), metin("cd")];
		expect(spliceInline(nodes, 1, 4, [])).toEqual([metin("ad")]);
	});

	/** Backspace görselin hemen arkasında: yalnızca görsel gidiyor. */
	it("görselin kendi aralığı yalnızca onu siliyor", () => {
		const nodes: Inline[] = [metin("ab"), gorsel(), metin("cd")];
		expect(spliceInline(nodes, 2, 3, [])).toEqual([metin("abcd")]);
	});

	it("dilim görseli ikilemiyor", () => {
		const nodes: Inline[] = [metin("ab"), gorsel(), metin("cd")];
		const sonuc = spliceInline(nodes, 2, 2, [metin("Z")]);
		expect(sonuc.filter((n) => n.type === "image")).toHaveLength(1);
	});
});
