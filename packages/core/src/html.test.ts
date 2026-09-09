import { describe, expect, it } from "vitest";
import { fromHtml, type HtmlNode } from "./html.js";
import { serialize } from "./serialize.js";

/**
 * Dönüştürücü DOM tiplerine değil, **yapısal** bir arayüze dayanıyor.
 * Bu sayede testler jsdom olmadan düz nesnelerle yazılabiliyor — ve aynı
 * kod tarayıcıda gerçek `Element`'lerle çalışıyor.
 */

/** Metin düğümü. */
const t = (value: string): HtmlNode => ({
	nodeType: 3,
	nodeName: "#text",
	textContent: value,
	childNodes: [],
});

/** Eleman düğümü. */
function e(tag: string, children: HtmlNode[] = [], attrs: Record<string, string> = {}): HtmlNode {
	return {
		nodeType: 1,
		nodeName: tag,
		textContent: children.map((c) => c.textContent ?? "").join(""),
		childNodes: children,
		getAttribute: (name) => attrs[name] ?? null,
	};
}

/** Sonucu Markdown olarak okumak, ağaç karşılaştırmaktan okunurdur. */
const md = (root: HtmlNode) => serialize(fromHtml(root)).replace(/\n$/, "");

// ---------------------------------------------------------------------------

describe("blok elemanları", () => {
	it("başlıklar", () => {
		expect(md(e("BODY", [e("H1", [t("Bir")]), e("H3", [t("Üç")])]))).toBe("# Bir\n\n### Üç");
	});

	it("paragraflar", () => {
		expect(md(e("BODY", [e("P", [t("bir")]), e("P", [t("iki")])]))).toBe("bir\n\niki");
	});

	it("alıntı", () => {
		expect(md(e("BODY", [e("BLOCKQUOTE", [e("P", [t("alıntı")])])]))).toBe("> alıntı");
	});

	it("yatay çizgi", () => {
		expect(md(e("BODY", [e("HR")]))).toBe("---");
	});

	it("kod bloğu", () => {
		expect(md(e("BODY", [e("PRE", [t("const a = 1;")])]))).toBe("```\nconst a = 1;\n```");
	});

	it("sırasız liste", () => {
		expect(md(e("BODY", [e("UL", [e("LI", [t("a")]), e("LI", [t("b")])])]))).toBe("- a\n- b");
	});

	it("sıralı liste ve başlangıç numarası", () => {
		expect(md(e("BODY", [e("OL", [e("LI", [t("a")])], { start: "5" })]))).toBe("5. a");
	});

	it("iç içe liste", () => {
		const ic = e("UL", [e("LI", [t("iç")])]);
		expect(md(e("BODY", [e("UL", [e("LI", [t("dış"), ic])])]))).toBe("- dış\n  - iç");
	});

	it("görev listesi onay kutusundan tanınıyor", () => {
		const kutulu = e("LI", [e("INPUT", [], { type: "checkbox", checked: "" }), t(" bitti")]);
		const bos = e("LI", [e("INPUT", [], { type: "checkbox" }), t(" yapılacak")]);
		expect(md(e("BODY", [e("UL", [kutulu, bos])]))).toBe("- [x] bitti\n- [ ] yapılacak");
	});

	it("tablo", () => {
		const satir = (hucreler: string[]) =>
			e(
				"TR",
				hucreler.map((h) => e("TD", [t(h)])),
			);
		expect(md(e("BODY", [e("TABLE", [e("TBODY", [satir(["a", "b"]), satir(["1", "2"])])])]))).toBe(
			"| a | b |\n| --- | --- |\n| 1 | 2 |",
		);
	});
});

describe("satır içi biçimler", () => {
	it("semantik etiketler", () => {
		expect(md(e("BODY", [e("P", [e("STRONG", [t("a")])])]))).toBe("**a**");
		expect(md(e("BODY", [e("P", [e("EM", [t("a")])])]))).toBe("*a*");
		expect(md(e("BODY", [e("P", [e("DEL", [t("a")])])]))).toBe("~~a~~");
	});

	it("eski etiketler de tanınıyor", () => {
		expect(md(e("BODY", [e("P", [e("B", [t("a")])])]))).toBe("**a**");
		expect(md(e("BODY", [e("P", [e("I", [t("a")])])]))).toBe("*a*");
		expect(md(e("BODY", [e("P", [e("STRIKE", [t("a")])])]))).toBe("~~a~~");
	});

	it("satır içi kod", () => {
		expect(md(e("BODY", [e("P", [e("CODE", [t("kod")])])]))).toBe("`kod`");
	});

	it("satır sonu", () => {
		// Yapıştırmadan gelen satır sonunun kaynak tercihi yok; serileştirici
		// varsayılanı ters bölü (iki boşluk kırpılınca sessizce kaybolur).
		expect(md(e("BODY", [e("P", [t("a"), e("BR"), t("b")])]))).toBe("a\\\nb");
	});

	it("bağlantı", () => {
		expect(md(e("BODY", [e("P", [e("A", [t("m")], { href: "https://a.b" })])]))).toBe(
			"[m](https://a.b)",
		);
	});

	it("görsel", () => {
		expect(md(e("BODY", [e("P", [e("IMG", [], { src: "/r.png", alt: "k" })])]))).toBe(
			"![k](/r.png)",
		);
	});

	/**
	 * `***a***` belirsizdir: ayrıştırıcı hangi katmanın kalın hangisinin
	 * italik olduğunu sözdiziminden çıkaramaz. Serileştirici bu yüzden
	 * dıştaki işareti değiştiriyor — anlam aynı, okuma tek türlü.
	 */
	it("iç içe biçimler belirsizlik olmadan yazılıyor", () => {
		expect(md(e("BODY", [e("P", [e("STRONG", [e("EM", [t("a")])])])]))).toBe("__*a*__");
	});
});

/**
 * Word ve Google Docs semantik etiket yerine **stil** kullanır. Bu çıkarım
 * olmadan yapıştırılan metnin bütün biçimi kaybolur.
 */
describe("stil çıkarımı", () => {
	it("font-weight kalın yapıyor", () => {
		expect(md(e("BODY", [e("P", [e("SPAN", [t("a")], { style: "font-weight:bold" })])]))).toBe(
			"**a**",
		);
		expect(md(e("BODY", [e("P", [e("SPAN", [t("a")], { style: "font-weight:700" })])]))).toBe(
			"**a**",
		);
	});

	it("font-style italik yapıyor", () => {
		expect(md(e("BODY", [e("P", [e("SPAN", [t("a")], { style: "font-style:italic" })])]))).toBe(
			"*a*",
		);
	});

	it("text-decoration üstü çizili yapıyor", () => {
		expect(
			md(e("BODY", [e("P", [e("SPAN", [t("a")], { style: "text-decoration:line-through" })])])),
		).toBe("~~a~~");
	});

	it("normal ağırlık biçim üretmiyor", () => {
		expect(md(e("BODY", [e("P", [e("SPAN", [t("a")], { style: "font-weight:400" })])]))).toBe("a");
	});

	it("bozuk style özniteliği patlatmıyor", () => {
		expect(md(e("BODY", [e("P", [e("SPAN", [t("a")], { style: ";;garip;:;" })])]))).toBe("a");
	});
});

/** Word ve Google Docs'un bilinen tuzakları. */
describe("Word ve Google Docs temizliği", () => {
	it("o:p etiketi atılıyor", () => {
		expect(md(e("BODY", [e("P", [t("a"), e("O:P", [t("çöp")])])]))).toBe("a");
	});

	it("script ve style tamamen atılıyor", () => {
		expect(md(e("BODY", [e("SCRIPT", [t("alert(1)")]), e("P", [t("a")])]))).toBe("a");
		expect(md(e("BODY", [e("STYLE", [t(".x{}")]), e("P", [t("a")])]))).toBe("a");
	});

	it("boş span yığınları düzleşiyor", () => {
		const yigin = e("SPAN", [e("SPAN", [e("SPAN", [t("a")])])]);
		expect(md(e("BODY", [e("P", [yigin])]))).toBe("a");
	});

	/**
	 * Google Docs yapıştırmanın tamamını `<b style="font-weight:normal">` ile
	 * sarar. Etiketi olduğu gibi almak bütün metni kalın yapardı.
	 */
	it("Google Docs sahte kalını açılıyor", () => {
		const sahte = e("B", [e("P", [t("a")])], { style: "font-weight:normal" });
		expect(md(e("BODY", [sahte]))).toBe("a");
	});

	it("gerçek kalın etkilenmiyor", () => {
		expect(md(e("BODY", [e("P", [e("B", [t("a")])])]))).toBe("**a**");
	});

	it("div ve section saydam", () => {
		expect(md(e("BODY", [e("DIV", [e("SECTION", [e("P", [t("a")])])])]))).toBe("a");
	});

	it("bilinmeyen etiket içeriği düz metne düşüyor", () => {
		expect(md(e("BODY", [e("P", [e("CUSTOM-TAG", [t("a")])])]))).toBe("a");
	});

	it("blok kabı olmayan metin paragrafa sarılıyor", () => {
		expect(md(e("BODY", [t("başıboş metin")]))).toBe("başıboş metin");
	});
});

describe("boşluk normalleştirmesi", () => {
	it("ardışık boşluklar tek boşluğa iniyor", () => {
		expect(md(e("BODY", [e("P", [t("a     b")])]))).toBe("a b");
	});

	it("satır sonları boşluğa dönüyor", () => {
		expect(md(e("BODY", [e("P", [t("a\n\tb")])]))).toBe("a b");
	});

	it("kırılmaz boşluk normal boşluğa dönüyor", () => {
		expect(md(e("BODY", [e("P", [t("a b")])]))).toBe("a b");
	});

	it("paragraf kenarlarındaki boşluk kırpılıyor", () => {
		expect(md(e("BODY", [e("P", [t("   a   ")])]))).toBe("a");
	});

	it("tamamen boş paragraf blok üretmiyor", () => {
		expect(md(e("BODY", [e("P", [t("   ")]), e("P", [t("a")])]))).toBe("a");
	});
});

/** Yapıştırma en olası XSS yüzeyi: içerik doğrudan dışarıdan geliyor. */
describe("güvenlik", () => {
	it("javascript: bağlantısı düşüyor, metni kalıyor", () => {
		expect(md(e("BODY", [e("P", [e("A", [t("tıkla")], { href: "javascript:alert(1)" })])]))).toBe(
			"tıkla",
		);
	});

	it("kodlama numaralı vektör de düşüyor", () => {
		expect(md(e("BODY", [e("P", [e("A", [t("x")], { href: "java\tscript:alert(1)" })])]))).toBe(
			"x",
		);
	});

	it("güvenli olmayan görsel kaynağı düşüyor", () => {
		expect(md(e("BODY", [e("P", [t("a"), e("IMG", [], { src: "javascript:alert(1)" })])]))).toBe(
			"a",
		);
	});

	it("SVG data URI görseli düşüyor", () => {
		expect(
			md(e("BODY", [e("P", [t("a"), e("IMG", [], { src: "data:image/svg+xml,<svg/onload=x>" })])])),
		).toBe("a");
	});

	it("izin verilen görsel data URI'si kalıyor", () => {
		expect(
			md(e("BODY", [e("P", [e("IMG", [], { src: "data:image/png;base64,AA", alt: "k" })])])),
		).toBe("![k](data:image/png;base64,AA)");
	});
});

describe("Türkçe içerik", () => {
	it("karakterler bozulmuyor", () => {
		expect(md(e("BODY", [e("P", [t("Işık ışıldıyor İĞÜŞÇÖ")])]))).toBe("Işık ışıldıyor İĞÜŞÇÖ");
	});

	it("büyük harfli etiket adları tanınıyor", () => {
		// `IMG` etiketi Türkçe locale'de küçültülseydi `ımg` olurdu.
		expect(md(e("BODY", [e("p", [e("strong", [t("a")])])]))).toBe("**a**");
	});
});

describe("boş girdi", () => {
	it("boş gövde boş belge", () => {
		expect(fromHtml(e("BODY")).children).toEqual([]);
	});
});

/** Kapsam raporunun gösterdiği, testsiz kalmış yollar. */
describe("daha az yürünen yollar", () => {
	it("unsafeUrls: keep bağlantıyı etkisizleştirerek koruyor", () => {
		const kaynak = e("BODY", [e("P", [e("A", [t("tıkla")], { href: "javascript:alert(1)" })])]);
		expect(serialize(fromHtml(kaynak, { unsafeUrls: "keep" })).trim()).toBe("[tıkla](#)");
	});

	it("stil ve semantik etiket birlikte tekilleşiyor", () => {
		// `<b style="font-weight:bold">` iki kez kalın uygulamamalı.
		expect(md(e("BODY", [e("P", [e("B", [t("a")], { style: "font-weight:bold" })])]))).toBe(
			"**a**",
		);
	});

	it("sahte kalın içindeki italik stili korunuyor", () => {
		const sahte = e("B", [t("a")], { style: "font-weight:normal;font-style:italic" });
		expect(md(e("BODY", [e("P", [sahte])]))).toBe("*a*");
	});

	it("ardışık metin düğümleri birleşiyor", () => {
		expect(md(e("BODY", [e("P", [t("bir "), t("iki "), t("üç")])]))).toBe("bir iki üç");
	});

	it("yorum düğümleri yok sayılıyor", () => {
		const yorum: HtmlNode = { nodeType: 8, nodeName: "#comment", textContent: "x", childNodes: [] };
		expect(md(e("BODY", [e("P", [t("a"), yorum])]))).toBe("a");
	});

	it("boş liste maddesi boş paragraf alıyor", () => {
		expect(md(e("BODY", [e("UL", [e("LI", [])])]))).toBe("-");
	});

	it("geçersiz start özniteliği 1'e düşüyor", () => {
		expect(md(e("BODY", [e("OL", [e("LI", [t("a")])], { start: "abc" })]))).toBe("1. a");
	});

	it("boş pre bloğu", () => {
		expect(md(e("BODY", [e("PRE", [])]))).toBe("```\n\n```");
	});

	it("saydam kapta blok yoksa satır içi olarak ele alınıyor", () => {
		expect(md(e("BODY", [e("DIV", [t("düz metin")])]))).toBe("düz metin");
	});
});

/**
 * Arayüz yapısal olduğu için dışarıdan **eksik** düğümler gelebilir:
 * `getAttribute` taşımayan, `textContent`'i null olan. Dönüştürücü
 * bunlarda patlamamalı — yapıştırma kaynağı güvenilir değil.
 */
describe("eksik düğümlere dayanıklılık", () => {
	/** `getAttribute` olmayan eleman — en yalın uyumlu düğüm. */
	const yalin = (tag: string, children: HtmlNode[] = []): HtmlNode => ({
		nodeType: 1,
		nodeName: tag,
		textContent: children.map((c) => c.textContent ?? "").join(""),
		childNodes: children,
	});

	it("öznitelik okuyamayan eleman patlatmıyor", () => {
		expect(md(yalin("BODY", [yalin("P", [t("a")])]))).toBe("a");
	});

	it("src'siz görsel düşüyor", () => {
		expect(md(e("BODY", [e("P", [t("a"), yalin("IMG")])]))).toBe("a");
	});

	it("href'siz bağlantı yalnızca metne iniyor", () => {
		expect(md(yalin("BODY", [yalin("P", [yalin("A", [t("m")])])]))).toBe("m");
	});

	it("stilsiz eleman biçim üretmiyor", () => {
		expect(md(yalin("BODY", [yalin("P", [yalin("SPAN", [t("a")])])]))).toBe("a");
	});

	it("textContent null olan düğüm patlatmıyor", () => {
		const bos: HtmlNode = { nodeType: 3, nodeName: "#text", textContent: null, childNodes: [] };
		expect(md(e("BODY", [e("P", [t("a"), bos])]))).toBe("a");
	});

	/** Boş kod span'i Markdown'da temsil edilemez; hiç yazılmaz. */
	it("textContent null olan kod düğümü hiç yazılmıyor", () => {
		const kod: HtmlNode = { nodeType: 1, nodeName: "CODE", textContent: null, childNodes: [] };
		expect(md(e("BODY", [e("P", [t("a"), kod])]))).toBe("a");
	});

	it("start özniteliği olmayan sıralı liste 1'den başlıyor", () => {
		expect(md(yalin("BODY", [yalin("OL", [yalin("LI", [t("a")])])]))).toBe("1. a");
	});

	it("onay kutusu olmayan madde görev değil", () => {
		expect(md(yalin("BODY", [yalin("UL", [yalin("LI", [t("a")])])]))).toBe("- a");
	});
});

/**
 * Word'ün sahte listeleri  (İş listesi: F3-07)
 *
 * Word `<ul>`/`<ol>` üretmiyor: her madde bir `<p>` ve madde imi
 * paragrafın içine gömülü bir `<span style='mso-list:Ignore'>`. İşlenmezse
 * yapıştırılan belgede liste kalmıyor, madde imi de kullanıcının metnine
 * karışıyor.
 */
describe("Word listeleri", () => {
	/** Bir Word madde paragrafı. */
	const wp = (im: string, metin: string, level = 1) =>
		e("p", [e("span", [t(im)], { style: "mso-list:Ignore" }), t(metin)], {
			class: "MsoListParagraphCxSpMiddle",
			style: `mso-list:l0 level${level} lfo1`,
		});

	it("ardışık maddeler tek listeye dönüşüyor", () => {
		const root = e("body", [wp("·", "bir"), wp("·", "iki"), wp("·", "üç")]);
		expect(md(root)).toBe("- bir\n- iki\n- üç");
	});

	/** Madde imi kullanıcının metni değil; çıktıya sızmamalı. */
	it("madde imi metne karışmıyor", () => {
		expect(md(e("body", [wp("·", "bir")]))).not.toContain("·");
	});

	it("sayı imi sıralı liste yapıyor", () => {
		const root = e("body", [wp("1.", "bir"), wp("2.", "iki")]);
		expect(md(root)).toBe("1. bir\n2. iki");
	});

	it("harf imi de sıralı sayılıyor", () => {
		expect(md(e("body", [wp("a)", "bir")]))).toBe("1. bir");
	});

	it("seviye numarası iç içe liste kuruyor", () => {
		const root = e("body", [wp("·", "bir"), wp("o", "ic", 2), wp("·", "iki")]);
		expect(md(root)).toBe("- bir\n  - ic\n- iki");
	});

	/** Liste bitince sıradan paragraf yeniden paragraf olmalı. */
	it("listeden sonra paragraf listeye girmiyor", () => {
		const root = e("body", [wp("·", "bir"), e("p", [t("sonra")])]);
		expect(md(root)).toBe("- bir\n\nsonra");
	});

	it("iki liste arasında paragraf varsa listeler ayrılıyor", () => {
		const root = e("body", [wp("·", "bir"), e("p", [t("ara")]), wp("·", "iki")]);
		expect(md(root)).toBe("- bir\n\nara\n\n- iki");
	});

	/** Word atlamalı seviye üretebiliyor; madde kaybolmamalı. */
	it("atlamalı seviye çökmüyor", () => {
		const root = e("body", [wp("·", "bir", 3)]);
		expect(md(root)).toContain("bir");
	});

	it("madde içindeki biçim korunuyor", () => {
		const root = e("body", [
			e("p", [e("span", [t("·")], { style: "mso-list:Ignore" }), e("b", [t("kalın")]), t(" düz")], {
				style: "mso-list:l0 level1 lfo1",
			}),
		]);
		expect(md(root)).toBe("- **kalın** düz");
	});
});

/**
 * Word aynı biçimi hem etiketle hem stille yazıyor: `<b><span
 * style="font-weight:bold">`. İkisi de `strong` üretiyor ve saf sarma
 * `__**metin**__` çıkarıyor.
 */
describe("çift işaretleme", () => {
	it("etiket ve stil aynı biçmi veriyorsa bir kez sarılıyor", () => {
		const root = e("body", [e("b", [e("span", [t("metin")], { style: "font-weight:bold" })])]);
		expect(md(root)).toBe("**metin**");
	});

	/** Yalnızca **aynı** biçim tekilleşiyor; farklı olanlar iç içe kalmalı. */
	it("farklı biçimler iç içe kalıyor", () => {
		const root = e("body", [e("b", [e("i", [t("metin")])])]);
		expect(md(root)).toBe("__*metin*__");
	});
});
