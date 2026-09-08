import { describe, expect, it } from "vitest";
import type { Blockquote, List, ListItem } from "./ast.js";
import { parseBlocks } from "./blocks.js";

const bloklar = (md: string) => parseBlocks(md).children;
const tipler = (md: string) => bloklar(md).map((b) => b.type);
const tek = (md: string) => bloklar(md)[0];

/** Bir düğüm ağacını `tip[çocuk, çocuk]` biçiminde özetler — iç içe yapıyı okunur kılar. */
function ozet(node: unknown): string {
	const n = node as { type: string; children?: unknown[]; value?: string };
	if (n.type === "text") return `text(${n.value})`;
	if (n.children === undefined) return n.type;
	return `${n.type}[${n.children.map(ozet).join(", ")}]`;
}
const yapi = (md: string) => bloklar(md).map(ozet);

// ---------------------------------------------------------------------------

describe("blockquote", () => {
	it("tek satırlık alıntı", () => {
		expect(yapi("> merhaba")).toEqual(["blockquote[paragraph[text(merhaba)]]"]);
	});

	/**
	 * `>` sonrası tek boşluk öneke aittir; fazlası içeriğe kalır. Ama paragraf
	 * kendi satır başı boşluğunu attığı için fark yalnızca 5+ boşlukta görünür:
	 * o zaman alıntının içinde girintili kod bloğu başlar.
	 */
	it("işaretten sonraki tek boşluk öneke ait", () => {
		expect(yapi(">  iki boşluk")).toEqual(["blockquote[paragraph[text(iki boşluk)]]"]);
	});

	it("beş boşluk alıntı içinde kod bloğu açıyor", () => {
		const bq = tek(">     kod") as Blockquote;
		expect(bq.children[0]).toMatchObject({ type: "code", value: "kod\n" });
	});

	it("boşluksuz > da geçerli", () => {
		expect(yapi(">merhaba")).toEqual(["blockquote[paragraph[text(merhaba)]]"]);
	});

	it("çok satırlı alıntı tek paragraf", () => {
		expect(yapi("> bir\n> iki")).toEqual(["blockquote[paragraph[text(bir\niki)]]"]);
	});

	it("alıntı içinde başlık", () => {
		expect(yapi("> # Başlık")).toEqual(["blockquote[heading[text(Başlık)]]"]);
	});

	it("alıntı içinde birden çok blok", () => {
		expect(yapi("> # Başlık\n>\n> paragraf")).toEqual([
			"blockquote[heading[text(Başlık)], paragraph[text(paragraf)]]",
		]);
	});

	it("iç içe alıntı", () => {
		expect(yapi("> > derin")).toEqual(["blockquote[blockquote[paragraph[text(derin)]]]"]);
	});

	it("alıntı içinde kod bloğu", () => {
		const bq = tek("> ```\n> kod\n> ```") as Blockquote;
		expect(bq.children[0]).toMatchObject({ type: "code", value: "kod\n" });
	});

	/**
	 * Tembel devam: alıntıdaki paragraf `>` olmadan da sürebilir. CommonMark'ın
	 * en çok şaşırtan kuralı — ve gerçek belgelerde satır kaydırma yüzünden
	 * sürekli karşılaşılır.
	 */
	it("tembel devam satırını alıntıya katıyor", () => {
		expect(yapi("> bir\niki")).toEqual(["blockquote[paragraph[text(bir\niki)]]"]);
	});

	it("boş satır tembel devamı kesiyor", () => {
		expect(tipler("> bir\n\niki")).toEqual(["blockquote", "paragraph"]);
	});

	it("yeni blok başlatan satır tembel devam olmuyor", () => {
		expect(tipler("> bir\n# Başlık")).toEqual(["blockquote", "heading"]);
		expect(tipler("> bir\n---")).toEqual(["blockquote", "thematicBreak"]);
	});

	it("alıntıdan sonra paragraf ayrı blok", () => {
		expect(tipler("> alıntı\n\nparagraf")).toEqual(["blockquote", "paragraph"]);
	});

	it("boş alıntı", () => {
		expect(yapi(">")).toEqual(["blockquote[]"]);
	});
});

// ---------------------------------------------------------------------------

describe("sırasız liste", () => {
	it("tek maddelik liste", () => {
		expect(yapi("- madde")).toEqual(["list[listItem[paragraph[text(madde)]]]"]);
	});

	it("üç işaretin üçünü de tanıyor", () => {
		for (const m of ["-", "*", "+"]) {
			const l = tek(`${m} madde`) as List;
			expect(l.type).toBe("list");
			expect(l.ordered).toBe(false);
			expect(l.syntax).toEqual({ marker: m });
		}
	});

	it("çok maddeli liste", () => {
		const l = tek("- bir\n- iki\n- üç") as List;
		expect(l.children).toHaveLength(3);
	});

	/** İşaret değişince CommonMark yeni bir liste başlatır. */
	it("işaret değişince yeni liste başlıyor", () => {
		expect(tipler("- bir\n* iki")).toEqual(["list", "list"]);
	});

	it("işaretsiz metin liste değil", () => {
		expect(tipler("-metin")).toEqual(["paragraph"]);
	});

	it("boş madde geçerli", () => {
		expect(yapi("-")).toEqual(["list[listItem[]]"]);
	});

	it("madde içinde çok satırlı paragraf", () => {
		expect(yapi("- bir\n  iki")).toEqual(["list[listItem[paragraph[text(bir\niki)]]]"]);
	});

	it("madde içinde tembel devam", () => {
		expect(yapi("- bir\niki")).toEqual(["list[listItem[paragraph[text(bir\niki)]]]"]);
	});
});

describe("sıralı liste", () => {
	it("nokta ayracını tanıyor", () => {
		const l = tek("1. madde") as List;
		expect(l.ordered).toBe(true);
		expect(l.start).toBe(1);
		expect(l.syntax).toEqual({ delimiter: ".", numbering: "incrementing" });
	});

	it("parantez ayracını tanıyor", () => {
		expect((tek("1) madde") as List).syntax?.delimiter).toBe(")");
	});

	it("başlangıç numarasını koruyor", () => {
		expect((tek("5. madde\n6. madde") as List).start).toBe(5);
	});

	it("ayraç değişince yeni liste başlıyor", () => {
		expect(tipler("1. bir\n2) iki")).toEqual(["list", "list"]);
	});

	it("dokuz basamağa kadar numara kabul ediyor", () => {
		expect(tipler("123456789. madde")).toEqual(["list"]);
	});

	/** `2020. yılında` diye başlayan bir cümle liste değildir. */
	it("on basamaklı sayı liste değil", () => {
		expect(tipler("1234567890. madde")).toEqual(["paragraph"]);
	});
});

describe("iç içe liste", () => {
	it("iki seviyeli", () => {
		expect(yapi("- dış\n  - iç")).toEqual([
			"list[listItem[paragraph[text(dış)], list[listItem[paragraph[text(iç)]]]]]",
		]);
	});

	it("üç seviyeli", () => {
		const l = tek("- a\n  - b\n    - c") as List;
		const ic = (l.children[0] as ListItem).children[1] as List;
		const enIc = (ic.children[0] as ListItem).children[1] as List;
		expect(enIc.type).toBe("list");
	});

	it("alıntı içinde liste", () => {
		expect(yapi("> - madde")).toEqual(["blockquote[list[listItem[paragraph[text(madde)]]]]"]);
	});

	it("liste içinde alıntı", () => {
		expect(yapi("- > alıntı")).toEqual(["list[listItem[blockquote[paragraph[text(alıntı)]]]]"]);
	});
});

/**
 * Sıkı (tight) / gevşek (loose) ayrımı mdast'ta `spread` alanıyla taşınır ve
 * render'ı doğrudan etkiler: gevşek listede maddeler `<p>` ile sarılır.
 */
describe("sıkı ve gevşek liste", () => {
	it("boş satırsız liste sıkı", () => {
		expect((tek("- bir\n- iki") as List).spread).toBe(false);
	});

	it("maddeler arası boş satır listeyi gevşetiyor", () => {
		expect((tek("- bir\n\n- iki") as List).spread).toBe(true);
	});

	it("madde içindeki boş satır listeyi gevşetiyor", () => {
		const l = tek("- bir\n\n  devam\n- iki") as List;
		expect(l.spread).toBe(true);
		expect((l.children[0] as ListItem).spread).toBe(true);
	});

	it("sıkı listede maddeler de sıkı", () => {
		expect(((tek("- bir\n- iki") as List).children[0] as ListItem).spread).toBe(false);
	});
});

describe("liste ile diğer bloklar", () => {
	/** `- - -` hem liste maddesi hem yatay çizgiye uyar; CommonMark çizgiyi seçer. */
	it("yatay çizgi liste maddesini yeniyor", () => {
		expect(tipler("- - -")).toEqual(["thematicBreak"]);
		expect(tipler("***")).toEqual(["thematicBreak"]);
	});

	it("liste paragrafı kesiyor", () => {
		expect(tipler("paragraf\n- madde")).toEqual(["paragraph", "list"]);
	});

	/**
	 * Listenin ortasındaki `- - -` yeni bir madde değil, yatay çizgidir —
	 * ve listeyi bitirir. Aynı işareti taşıdığı için gözden kaçması kolay.
	 */
	it("liste içinde yatay çizgi listeyi bitiriyor", () => {
		expect(tipler("- madde\n- - -")).toEqual(["list", "thematicBreak"]);
		expect((tek("- madde\n- - -") as List).children).toHaveLength(1);
	});

	/** Sıralı liste paragrafı ancak 1'den başlıyorsa kesebilir. */
	it("1 ile başlayan sıralı liste paragrafı kesiyor", () => {
		expect(tipler("paragraf\n1. madde")).toEqual(["paragraph", "list"]);
	});

	it("2 ile başlayan sıralı liste paragrafı kesmiyor", () => {
		expect(tipler("paragraf\n2. madde")).toEqual(["paragraph"]);
	});

	/**
	 * Boş madde paragrafı kesmez. Sınamak için `*` kullanılıyor: tek başına
	 * `-` bir setext alt çizgisidir ve paragrafı başlığa çevirir — bu testin
	 * ölçmek istediği şey o değil.
	 */
	it("boş madde paragrafı kesmiyor", () => {
		expect(tipler("paragraf\n*")).toEqual(["paragraph"]);
	});

	it("tek başına - paragrafı setext başlığa çeviriyor", () => {
		expect(tipler("paragraf\n-")).toEqual(["heading"]);
	});

	it("listeden sonra paragraf ayrı blok", () => {
		expect(tipler("- madde\n\nparagraf")).toEqual(["list", "paragraph"]);
	});

	it("alıntı paragrafı kesiyor", () => {
		expect(tipler("paragraf\n> alıntı")).toEqual(["paragraph", "blockquote"]);
	});

	/** `1.metin` liste değildir — ayraçtan sonra boşluk şart. */
	it("boşluksuz sıralı işaret liste değil", () => {
		expect(tipler("1.metin")).toEqual(["paragraph"]);
		expect(tipler("1)metin")).toEqual(["paragraph"]);
	});

	it("madde içinde kod bloğu", () => {
		const l = tek("- madde\n\n  ```\n  kod\n  ```") as List;
		const item = l.children[0] as ListItem;
		expect(item.children[1]).toMatchObject({ type: "code", value: "kod\n" });
	});

	it("madde içinde girintili kod", () => {
		// İçerik sütunu 2; 4 sütun daha girinti kod bloğu demek.
		const l = tek("-     kod") as List;
		expect((l.children[0] as ListItem).children[0]).toMatchObject({ type: "code" });
	});
});

/**
 * Kapsayıcılar önek soyduğu için ofsetlerin kayması en olası yer burası.
 * `position` yanlışsa editörün kaynak eşlemesi sessizce bozulur.
 */
describe("kapsayıcılarda position", () => {
	it("alıntının ofsetleri kaynağı kesiyor", () => {
		const md = "> alıntı satırı";
		const bq = parseBlocks(md).children[0];
		expect(md.slice(bq?.position?.start.offset, bq?.position?.end.offset)).toBe(md);
	});

	it("alıntı içindeki paragrafın ofseti öneki atlıyor", () => {
		const md = "> alıntı";
		const p = (parseBlocks(md).children[0] as Blockquote).children[0];
		expect(md.slice(p?.position?.start.offset, p?.position?.end.offset)).toBe("alıntı");
	});

	it("liste maddesinin ofseti işareti atlıyor", () => {
		const md = "- madde metni";
		const item = (parseBlocks(md).children[0] as List).children[0];
		const p = item?.children[0];
		expect(md.slice(p?.position?.start.offset, p?.position?.end.offset)).toBe("madde metni");
	});

	it("iç içe listede satır numarası doğru", () => {
		const md = "- dış\n  - iç";
		const dis = parseBlocks(md).children[0] as List;
		const icListe = (dis.children[0] as ListItem).children[1] as List;
		expect(icListe.position?.start.line).toBe(2);
	});
});

describe("gerçekçi belge", () => {
	it("iç içe yapıları doğru çözüyor", () => {
		const md = [
			"# Başlık",
			"",
			"> Alıntı paragrafı",
			"> devam ediyor",
			"",
			"1. Birinci",
			"2. İkinci",
			"   - iç madde",
			"   - başka iç madde",
			"3. Üçüncü",
			"",
			"Son paragraf.",
		].join("\n");

		expect(tipler(md)).toEqual(["heading", "blockquote", "list", "paragraph"]);

		const liste = bloklar(md)[2] as List;
		expect(liste.ordered).toBe(true);
		expect(liste.children).toHaveLength(3);

		const ikinci = liste.children[1] as ListItem;
		expect(ikinci.children.map((c) => c.type)).toEqual(["paragraph", "list"]);
		expect((ikinci.children[1] as List).children).toHaveLength(2);
	});
});
