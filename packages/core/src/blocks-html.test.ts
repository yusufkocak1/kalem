import { describe, expect, it } from "vitest";
import type { Blockquote, Definition, Html } from "./ast.js";
import { parseBlocks } from "./blocks.js";

const bloklar = (md: string) => parseBlocks(md).children;
const tipler = (md: string) => bloklar(md).map((b) => b.type);
const tek = (md: string) => bloklar(md)[0];

/**
 * Ham HTML **korunur, çalıştırılmaz**. Ayrıştırıcının görevi yalnızca bloğun
 * nerede başlayıp bittiğini doğru bulmak; kaçışlama viewer'ın işi
 * (bkz. SECURITY.md).
 */
describe("HTML blokları", () => {
	it("tür 1: script/pre/style/textarea kapanış etiketine kadar sürüyor", () => {
		const h = tek("<script>\nvar a = 1;\n\nhâlâ içeride\n</script>") as Html;
		expect(h.type).toBe("html");
		expect(h.value).toBe("<script>\nvar a = 1;\n\nhâlâ içeride\n</script>");
	});

	it("tür 1 büyük/küçük harfe duyarsız", () => {
		expect(tipler("<SCRIPT>\na\n</SCRIPT>")).toEqual(["html"]);
	});

	it("tür 2: yorum", () => {
		expect((tek("<!-- yorum -->") as Html).value).toBe("<!-- yorum -->");
	});

	it("tür 2: çok satırlı yorum", () => {
		const h = tek("<!--\nsatır\n\nboş satır geçti\n-->") as Html;
		expect(h.value).toContain("boş satır geçti");
	});

	it("tür 3: işlem talimatı", () => {
		expect((tek("<?php echo 1; ?>") as Html).value).toBe("<?php echo 1; ?>");
	});

	it("tür 4: bildirim", () => {
		expect((tek("<!DOCTYPE html>") as Html).value).toBe("<!DOCTYPE html>");
	});

	it("tür 5: CDATA", () => {
		expect((tek("<![CDATA[ veri ]]>") as Html).value).toBe("<![CDATA[ veri ]]>");
	});

	it("tür 6: bilinen blok etiketi boş satıra kadar sürüyor", () => {
		expect(tipler("<div>\niçerik\n</div>\n\nparagraf")).toEqual(["html", "paragraph"]);
		expect((tek("<div>\niçerik\n</div>\n\nparagraf") as Html).value).toBe("<div>\niçerik\n</div>");
	});

	it("tür 6: kapanış etiketiyle de açılabiliyor", () => {
		expect(tipler("</div>")).toEqual(["html"]);
	});

	it("tür 7: tek başına duran herhangi bir etiket", () => {
		expect(tipler("<custom-tag>\niçerik")).toEqual(["html"]);
	});

	/** HTML etiket adları ASCII'dir; `<özel-etiket>` geçerli bir etiket değil. */
	it("ASCII olmayan etiket adı HTML bloğu açmıyor", () => {
		expect(tipler("<özel-etiket>\niçerik")).toEqual(["paragraph"]);
	});

	it("bilinmeyen etiket satır içindeyse HTML bloğu değil", () => {
		// Tür 7 etiketin satırda TEK BAŞINA olmasını ister.
		expect(tipler("metin <span> metin")).toEqual(["paragraph"]);
	});

	/**
	 * Tür 1–6 paragrafı kesebilir, tür 7 kesemez. Aradaki fark, `<span>` gibi
	 * satır içi etiketlerin paragrafı bölmesini engeller.
	 */
	it("tür 6 paragrafı kesiyor", () => {
		expect(tipler("paragraf\n<div>")).toEqual(["paragraph", "html"]);
	});

	it("tür 2 paragrafı kesiyor", () => {
		expect(tipler("paragraf\n<!-- yorum -->")).toEqual(["paragraph", "html"]);
	});

	it("tür 7 paragrafı KESMİYOR", () => {
		expect(tipler("paragraf\n<özel-etiket>")).toEqual(["paragraph"]);
	});

	it("alıntı içinde HTML bloğu", () => {
		const bq = tek("> <div>\n> içerik") as Blockquote;
		expect(bq.children[0]?.type).toBe("html");
	});

	it("HTML bloğu içindeki Markdown ayrıştırılmıyor", () => {
		expect((tek("<div>\n# başlık değil\n</div>") as Html).value).toContain("# başlık değil");
	});

	it("ofsetleri kaynağı kesiyor", () => {
		const md = "<div>\niçerik\n</div>";
		const h = parseBlocks(md).children[0];
		expect(md.slice(h?.position?.start.offset, h?.position?.end.offset)).toBe(md);
	});
});

// ---------------------------------------------------------------------------

describe("bağlantı tanımları", () => {
	it("basit tanım", () => {
		const d = tek("[etiket]: https://ornek.com") as Definition;
		expect(d.type).toBe("definition");
		expect(d.label).toBe("etiket");
		expect(d.url).toBe("https://ornek.com");
		expect(d.title).toBeNull();
	});

	it("çift tırnaklı başlık", () => {
		expect((tek('[a]: /url "Başlık"') as Definition).title).toBe("Başlık");
	});

	it("tek tırnaklı başlık", () => {
		expect((tek("[a]: /url 'Başlık'") as Definition).title).toBe("Başlık");
	});

	it("parantezli başlık", () => {
		expect((tek("[a]: /url (Başlık)") as Definition).title).toBe("Başlık");
	});

	it("açılı ayraçlı hedefi soyuyor", () => {
		expect((tek("[a]: <boşluklu url>") as Definition).url).toBe("boşluklu url");
	});

	it("üç boşluğa kadar girinti kabul ediyor", () => {
		expect(tipler("   [a]: /url")).toEqual(["definition"]);
	});

	it("dört boşluk girinti kod bloğu yapıyor", () => {
		expect(tipler("    [a]: /url")).toEqual(["code"]);
	});

	it("art arda tanımlar", () => {
		expect(tipler("[a]: /1\n[b]: /2\n[c]: /3")).toEqual(["definition", "definition", "definition"]);
	});

	it("tanımdan sonra paragraf", () => {
		expect(tipler("[a]: /url\n\nmetin")).toEqual(["definition", "paragraph"]);
	});

	/** Bağlantı tanımı paragrafı kesemez — CommonMark kuralı. */
	it("paragrafı kesmiyor", () => {
		expect(tipler("paragraf\n[a]: /url")).toEqual(["paragraph"]);
	});

	it("alıntı içinde tanım", () => {
		const bq = tek("> [a]: /url") as Blockquote;
		expect(bq.children[0]?.type).toBe("definition");
	});
});

/**
 * Etiket eşleştirmesi CommonMark gereği **locale'den bağımsızdır**. Türkçe
 * kurallarını uygulamak (`İ` → `i`) aynı belgeyi başka bir Markdown aracıyla
 * farklı çözerdi — burada locale duyarlılığı istenmeyen şeydir ve kod bunu
 * `kalem-locale-ok` ile açıkça belirtiyor.
 */
describe("etiket normalleştirme", () => {
	it("büyük/küçük harf farkını siliyor", () => {
		expect((tek("[Etiket]: /url") as Definition).identifier).toBe("etiket");
		expect((tek("[ETİKET]: /url") as Definition).identifier).toBe(
			(tek("[etİket]: /url") as Definition).identifier,
		);
	});

	it("ham etiketi ayrıca koruyor", () => {
		const d = tek("[Karışık Yazım]: /url") as Definition;
		expect(d.label).toBe("Karışık Yazım");
		expect(d.identifier).toBe("karışık yazım");
	});

	it("iç boşlukları tek boşluğa indiriyor", () => {
		expect((tek("[a   b]: /url") as Definition).identifier).toBe("a b");
	});

	/**
	 * Buradaki fark projenin locale kuralının aynadaki görüntüsü.
	 *
	 * Unicode varsayılanı `I` → `i` der; Türkçe `I` → `ı` der. Bağlantı
	 * etiketleri için **Unicode varsayılanı doğrudur**: aynı belge her
	 * Markdown aracında aynı çözülmeli. Türkçe kuralı uygulansaydı `[IŞIK]`
	 * tanımı `[ışık]` başvurusuyla eşleşir, başka araçlarda eşleşmezdi.
	 *
	 * Yani `guards`/`ui` tarafında yasak olan çıplak `toLowerCase()`, burada
	 * tam olarak istenen şey — kod bunu `kalem-locale-ok` ile beyan ediyor.
	 */
	it("Türkçe değil, Unicode varsayılan katlaması uyguluyor", () => {
		expect((tek("[IŞIK]: /url") as Definition).identifier).toBe("işik");
		// Türkçe kuralı uygulansaydı sonuç bu olurdu — olmamalı.
		expect((tek("[IŞIK]: /url") as Definition).identifier).not.toBe("ışık");
	});

	it("İ de Unicode kuralıyla katlanıyor", () => {
		// Unicode varsayılanı "İ"yi "i" + birleşen nokta (U+0307) yapar.
		// Türkçe kuralı sade "i" verirdi. Beklenen değer somut yazılıyor:
		// aynı işlevi çağırıp karşılaştırmak testi kendi kendini doğrular
		// hale getirirdi.
		expect((tek("[İ]: /url") as Definition).identifier).toBe("i̇");
	});
});
