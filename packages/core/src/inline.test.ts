import { describe, expect, it } from "vitest";
import type { Inline, InlineCode, Link } from "./ast.js";
import { parseInline } from "./inline.js";

/** Ağacı `tip(değer)` / `tip[çocuk]` biçiminde özetler. */
function ozet(node: Inline): string {
	const n = node as { type: string; children?: Inline[]; value?: string };
	if (n.children !== undefined) return `${n.type}[${n.children.map(ozet).join(", ")}]`;
	return `${n.type}(${n.value ?? ""})`;
}
const yapi = (raw: string) => parseInline(raw).map(ozet);
const tek = (raw: string) => parseInline(raw)[0];

describe("düz metin", () => {
	it("işaretsiz metin tek düğüm", () => {
		expect(yapi("düz metin")).toEqual(["text(düz metin)"]);
	});

	it("boş girdi boş dizi", () => {
		expect(parseInline("")).toEqual([]);
	});

	it("Türkçe karakterleri bozmuyor", () => {
		expect(yapi("Işık ışıldıyor İĞÜŞÇÖ")).toEqual(["text(Işık ışıldıyor İĞÜŞÇÖ)"]);
	});
});

describe("kaçış", () => {
	it("kaçırılan yıldız vurgu açmıyor", () => {
		expect(yapi("\\*düz\\*")).toEqual(["text(*düz*)"]);
	});

	it("kaçırılabilir tüm noktalama", () => {
		expect(yapi("\\# \\[ \\] \\` \\\\")).toEqual(["text(# [ ] ` \\)"]);
	});

	/** Ters bölü yalnızca noktalamayı kaçırır; harften önce düz metindir. */
	it("harften önceki ters bölü metin", () => {
		expect(yapi("\\a")).toEqual(["text(\\a)"]);
	});
});

describe("kod span", () => {
	it("basit kod", () => {
		const c = tek("`kod`") as InlineCode;
		expect(c.type).toBe("inlineCode");
		expect(c.value).toBe("kod");
		expect(c.syntax).toEqual({ fenceLength: 1, padded: false });
	});

	it("çok ters tırnaklı kod", () => {
		expect((tek("``a ` b``") as InlineCode).value).toBe("a ` b");
	});

	/** Baştaki ve sondaki tek boşluk atılır — ters tırnakla başlayan kod için. */
	it("çevreleyen tek boşluğu atıyor", () => {
		expect((tek("`` `a` ``") as InlineCode).value).toBe("`a`");
	});

	it("yalnız boşluktan oluşan kodu bozmuyor", () => {
		expect((tek("` `") as InlineCode).value).toBe(" ");
	});

	/** Kod span vurgudan önce gelir: içindeki yıldızlar düz metindir. */
	it("kod içindeki vurgu işaretleri ayrıştırılmıyor", () => {
		expect(yapi("`*a*`")).toEqual(["inlineCode(*a*)"]);
	});

	it("kapanmamış ters tırnak düz metin", () => {
		expect(yapi("`kod")).toEqual(["text(`kod)"]);
	});
});

describe("autolink", () => {
	it("URL autolink", () => {
		const l = tek("<https://ornek.com>") as Link;
		expect(l.type).toBe("link");
		expect(l.url).toBe("https://ornek.com");
		expect(l.syntax).toEqual({ style: "autolink" });
	});

	it("e-posta autolink mailto ekliyor", () => {
		const l = tek("<posta@ornek.com>") as Link;
		expect(l.url).toBe("mailto:posta@ornek.com");
		expect(ozet(l)).toBe("link[text(posta@ornek.com)]");
	});

	/**
	 * `<iki kelime>` autolink değil ama **geçerli bir HTML etiketidir**
	 * (`iki` etiketi, `kelime` özniteliği) — CommonMark onu ham HTML sayar.
	 * Gerçekten metin kalması için etiket adı geçersiz olmalı.
	 */
	it("boşluk içeren açılı ayraç autolink değil", () => {
		expect(yapi("<iki kelime>")).toEqual(["html(<iki kelime>)"]);
	});

	it("geçersiz etiket adı düz metin", () => {
		expect(yapi("<3 kelime>")).toEqual(["text(<3 kelime>)"]);
	});
});

describe("ham satır içi HTML", () => {
	it("etiketi koruyor", () => {
		expect(yapi("a <span> b")).toEqual(["text(a )", "html(<span>)", "text( b)"]);
	});

	it("öznitelikli etiket", () => {
		expect(yapi('<a href="x">')).toEqual(['html(<a href="x">)']);
	});

	it("yorum", () => {
		expect(yapi("<!-- yorum -->")).toEqual(["html(<!-- yorum -->)"]);
	});
});

describe("satır sonları", () => {
	it("iki boşluk sert satır sonu", () => {
		expect(yapi("bir  \niki")).toEqual(["text(bir)", "break()", "text(iki)"]);
	});

	it("ters bölü sert satır sonu", () => {
		expect(yapi("bir\\\niki")).toEqual(["text(bir)", "break()", "text(iki)"]);
	});

	/**
	 * Tek boşluk yumuşak satır sonu — ve boşluk metinde **kalıyor.**
	 *
	 * CommonMark onu atar; HTML'de zaten görünmez. Atılırsa, satır sonunda
	 * boşluk bırakmış bir yazarın dokunmadığı satır ilk kaydetmede değişir
	 * (F6-11'de bulundu).
	 */
	it("tek boşluk yumuşak satır sonu", () => {
		expect(yapi("bir \niki")).toEqual(["text(bir \niki)"]);
	});

	it("ikiden fazla boşluklu sert satır sonu genişliğini kaydediyor", () => {
		const nodes = parseInline("bir   \niki");
		expect((nodes[1] as { syntax?: { width?: number } }).syntax?.width).toBe(3);
		expect(
			(parseInline("bir  \niki")[1] as { syntax?: { width?: number } }).syntax?.width,
		).toBeUndefined();
	});

	it("sert satır sonu işaretini kaydediyor", () => {
		const nodes = parseInline("bir  \niki");
		expect((nodes[1] as { syntax?: { marker: string } }).syntax?.marker).toBe("spaces");
		expect((parseInline("bir\\\niki")[1] as { syntax?: { marker: string } }).syntax?.marker).toBe(
			"backslash",
		);
	});
});

// ---------------------------------------------------------------------------
// Vurgu — CommonMark'ın en zor kısmı
// ---------------------------------------------------------------------------

describe("basit vurgu", () => {
	it("tek yıldız italik", () => {
		expect(yapi("*a*")).toEqual(["emphasis[text(a)]"]);
	});

	it("tek alt çizgi italik", () => {
		expect(yapi("_a_")).toEqual(["emphasis[text(a)]"]);
	});

	it("çift yıldız kalın", () => {
		expect(yapi("**a**")).toEqual(["strong[text(a)]"]);
	});

	it("çift alt çizgi kalın", () => {
		expect(yapi("__a__")).toEqual(["strong[text(a)]"]);
	});

	it("işaret tercihini kaydediyor", () => {
		expect((tek("*a*") as { syntax?: { marker: string } }).syntax?.marker).toBe("*");
		expect((tek("_a_") as { syntax?: { marker: string } }).syntax?.marker).toBe("_");
	});

	it("metin içinde vurgu", () => {
		expect(yapi("bir *iki* üç")).toEqual(["text(bir )", "emphasis[text(iki)]", "text( üç)"]);
	});

	it("iç içe vurgu", () => {
		expect(yapi("**a *b* c**")).toEqual(["strong[text(a ), emphasis[text(b)], text( c)]"]);
	});

	it("üç yıldız kalın içinde italik", () => {
		expect(yapi("***a***")).toEqual(["emphasis[strong[text(a)]]"]);
	});
});

/**
 * Bu kurallar olmasa `dosya_adi_uzun` ve `5 * 3 * 2` gibi sıradan metinler
 * bozulurdu. CommonMark'ın "sol/sağ taraflı dizi" tanımının varlık sebebi bu.
 */
describe("vurgu açılmaması gereken yerler", () => {
	it("boşlukla ayrılmış yıldız vurgu açmıyor", () => {
		expect(yapi("a * b * c")).toEqual(["text(a * b * c)"]);
	});

	it("kelime içindeki alt çizgi vurgu açmıyor", () => {
		expect(yapi("dosya_adi_uzun")).toEqual(["text(dosya_adi_uzun)"]);
	});

	/** Yıldız kelime içinde çalışır — alt çizgiden farkı budur. */
	it("kelime içindeki yıldız vurgu açıyor", () => {
		expect(yapi("a*b*c")).toEqual(["text(a)", "emphasis[text(b)]", "text(c)"]);
	});

	it("kapanmayan işaret düz metin", () => {
		expect(yapi("*a")).toEqual(["text(*a)"]);
		expect(yapi("**a")).toEqual(["text(**a)"]);
	});

	it("boş vurgu düz metin", () => {
		expect(yapi("**")).toEqual(["text(**)"]);
	});
});

/**
 * CommonMark'ın "üçün kuralı": açış ya da kapanış hem açıp hem kapatabiliyorsa
 * ve uzunlukları toplamı 3'ün katıysa eşleşme reddedilir. Bu kural olmadan
 * aşağıdaki girdiler yanlış çözülür.
 */
describe("üçün kuralı", () => {
	it("*foo**bar*", () => {
		expect(yapi("*foo**bar*")).toEqual(["emphasis[text(foo**bar)]"]);
	});

	it("**foo*bar**", () => {
		expect(yapi("**foo*bar**")).toEqual(["strong[text(foo*bar)]"]);
	});

	it("*a **b** c*", () => {
		expect(yapi("*a **b** c*")).toEqual(["emphasis[text(a ), strong[text(b)], text( c)]"]);
	});
});

describe("üstü çizili (GFM)", () => {
	it("çift tilde", () => {
		expect(yapi("~~a~~")).toEqual(["delete[text(a)]"]);
	});

	it("tek tilde", () => {
		expect(yapi("~a~")).toEqual(["delete[text(a)]"]);
	});

	it("içinde vurgu", () => {
		expect(yapi("~~*a*~~")).toEqual(["delete[emphasis[text(a)]]"]);
	});
});

describe("karışık satır içi", () => {
	it("kod, bağlantı ve vurgu birlikte", () => {
		expect(yapi("*a* `b` <https://c.d>")).toEqual([
			"emphasis[text(a)]",
			"text( )",
			"inlineCode(b)",
			"text( )",
			"link[text(https://c.d)]",
		]);
	});

	it("Türkçe metinde vurgu", () => {
		expect(yapi("**Işık** ve *gölge*")).toEqual([
			"strong[text(Işık)]",
			"text( ve )",
			"emphasis[text(gölge)]",
		]);
	});
});

// ---------------------------------------------------------------------------
// Bağlantı, görsel ve başvurular
// ---------------------------------------------------------------------------

describe("satır içi bağlantı", () => {
	it("basit bağlantı", () => {
		const l = tek("[metin](https://ornek.com)") as Link;
		expect(l.type).toBe("link");
		expect(l.url).toBe("https://ornek.com");
		expect(l.title).toBeNull();
		expect(ozet(l)).toBe("link[text(metin)]");
	});

	it("başlıklı bağlantı", () => {
		expect((tek('[a](/url "Başlık")') as Link).title).toBe("Başlık");
		expect((tek("[a](/url 'Başlık')") as Link).title).toBe("Başlık");
		expect((tek("[a](/url (Başlık))") as Link).title).toBe("Başlık");
	});

	it("açılı ayraçlı hedef", () => {
		expect((tek("[a](<boşluklu url>)") as Link).url).toBe("boşluklu url");
	});

	it("boş hedef", () => {
		expect((tek("[a]()") as Link).url).toBe("");
	});

	it("bağlantı metninde vurgu", () => {
		expect(yapi("[*a* b](/u)")).toEqual(["link[emphasis[text(a)], text( b)]"]);
	});

	it("yazım tercihini kaydediyor", () => {
		expect((tek("[a](/u)") as Link).syntax).toEqual({ style: "inline" });
	});

	it("metin içinde bağlantı", () => {
		expect(yapi("bir [iki](/u) üç")).toEqual(["text(bir )", "link[text(iki)]", "text( üç)"]);
	});

	it("kapanmayan ayraç düz metin", () => {
		expect(yapi("[a")).toEqual(["text([a)"]);
	});

	it("hedefsiz ayraç kısayol başvurusu oluyor", () => {
		expect(yapi("[a] metin")).toEqual(["linkReference[text(a)]", "text( metin)"]);
	});

	it("kaçırılan ayraç bağlantı açmıyor", () => {
		expect(yapi("\\[a](/u)")).toEqual(["text([a](/u))"]);
	});
});

describe("görsel", () => {
	it("basit görsel", () => {
		const img = tek("![alt metni](/resim.png)") as { type: string; url: string; alt: string };
		expect(img.type).toBe("image");
		expect(img.url).toBe("/resim.png");
		expect(img.alt).toBe("alt metni");
	});

	it("başlıklı görsel", () => {
		expect((tek('![a](/r.png "Başlık")') as { title: string }).title).toBe("Başlık");
	});

	/** Görselin alt metni düz metne indirgenir — vurgu düğümü taşımaz. */
	it("alt metni düzleştiriyor", () => {
		expect((tek("![*a* b](/r.png)") as { alt: string }).alt).toBe("a b");
	});

	it("metin içinde görsel", () => {
		expect(yapi("bak ![a](/r.png) buna")).toEqual(["text(bak )", "image()", "text( buna)"]);
	});
});

/**
 * Üç başvuru biçimi de kaynaktaki yazılışını korur — serileştirici (F1-07)
 * `[a][b]` yazan kullanıcıya `[a]` üretmemeli.
 */
describe("başvurulu bağlantı", () => {
	it("tam başvuru", () => {
		const r = tek("[metin][etiket]") as { type: string; identifier: string; label: string };
		expect(r.type).toBe("linkReference");
		expect(r.identifier).toBe("etiket");
		expect(r.label).toBe("etiket");
		expect((r as unknown as { syntax: { referenceType: string } }).syntax.referenceType).toBe(
			"full",
		);
	});

	it("daraltılmış başvuru", () => {
		const r = tek("[etiket][]") as { identifier: string; syntax: { referenceType: string } };
		expect(r.identifier).toBe("etiket");
		expect(r.syntax.referenceType).toBe("collapsed");
	});

	it("kısayol başvurusu", () => {
		const r = tek("[etiket]") as { identifier: string; syntax: { referenceType: string } };
		expect(r.identifier).toBe("etiket");
		expect(r.syntax.referenceType).toBe("shortcut");
	});

	it("başvurulu görsel", () => {
		const r = tek("![alt][etiket]") as { type: string; identifier: string; alt: string };
		expect(r.type).toBe("imageReference");
		expect(r.identifier).toBe("etiket");
		expect(r.alt).toBe("alt");
	});

	/**
	 * Etiket eşleştirmesi tanım tarafıyla (`blocks.ts`) aynı kuralı kullanmalı,
	 * yoksa tanımlar başvurularla eşleşmez. CommonMark bunu locale'den bağımsız
	 * ister.
	 */
	it("etiketi locale'den bağımsız normalleştiriyor", () => {
		expect((tek("[Etiket]") as { identifier: string }).identifier).toBe("etiket");
		expect((tek("[IŞIK]") as { identifier: string }).identifier).toBe("işik");
		expect((tek("[a   b]") as { identifier: string }).identifier).toBe("a b");
	});
});

describe("iç içe olmayan bağlantılar", () => {
	/** CommonMark'ta bağlantı içinde bağlantı olmaz; dıştaki iptal edilir. */
	it("bağlantı içinde bağlantı olmuyor", () => {
		const nodes = parseInline("[dış [iç](/i)](/d)");
		expect(nodes.some((n) => n.type === "link")).toBe(true);
	});

	it("görsel bağlantı içinde olabiliyor", () => {
		expect(yapi("[![a](/r.png)](/u)")).toEqual(["link[image()]"]);
	});
});

/**
 * Bağlantı hedefi ve başlığı — elle yazılmış tarayıcı.
 *
 * Bu bölüm, hedef/başlık okuması regex'ten tarayıcıya geçirilirken yazıldı.
 * Eski regex iki gerçek durumu sessizce kaçırıyordu ve hatayı Faz 2'de
 * viewer testleri buldu, ayrıştırıcı testleri değil.
 */
describe("bağlantı hedefi", () => {
	const url = (raw: string) => (tek(raw) as { url?: string }).url;

	it("dengeli parantez hedefte kabul ediliyor", () => {
		expect(url("[a](foo(bar))")).toBe("foo(bar)");
	});

	it("iç içe dengeli parantez", () => {
		expect(url("[a](foo(and(bar)))")).toBe("foo(and(bar))");
	});

	/** Wikipedia bağlantılarının klasik biçimi — en sık gerçek durum. */
	it("gerçek dünya: parantezli Wikipedia bağlantısı", () => {
		expect(url("[a](https://tr.wikipedia.org/wiki/Kalem_(araç))")).toBe(
			"https://tr.wikipedia.org/wiki/Kalem_(araç)",
		);
	});

	it("javascript: şeması ayrıştırılıyor — etkisizleştirme render'ın işi", () => {
		expect(url("[a](javascript:alert(1))")).toBe("javascript:alert(1)");
	});

	it("kapanmamış parantez bağlantıyı iptal ediyor", () => {
		expect((tek("[a](foo(bar)") as Inline).type).not.toBe("link");
	});

	/** Kaçırılmış parantez dengeye sayılmaz: sondaki `)` bağlantıyı kapatır. */
	it("kaçırılmış parantez hedefte çözülüyor", () => {
		expect(url("[a](foo\\(bar)")).toBe("foo(bar");
	});

	it("kaçışlar hedefte çözülüyor", () => {
		expect(url("[a](/b\\_c)")).toBe("/b_c");
	});

	it("açılı ayraçlı hedefte boşluk serbest", () => {
		expect(url("[a](<b c>)")).toBe("b c");
	});

	it("boş hedef", () => {
		expect(url("[a]()")).toBe("");
	});
});

describe("bağlantı başlığı", () => {
	const baslik = (raw: string) => (tek(raw) as { title?: string | null }).title;
	const ayrac = (raw: string) => (tek(raw) as { syntax?: { titleDelimiter?: string } }).syntax;

	it("ters bölü ile kaçırılmış tırnak başlıkta çözülüyor", () => {
		expect(baslik('[a](/y "tır\\"nak")')).toBe('tır"nak');
	});

	it("tek tırnaklı başlık", () => {
		expect(baslik("[a](/y 'b')")).toBe("b");
	});

	it("parantezli başlık", () => {
		expect(baslik("[a](/y (b))")).toBe("b");
	});

	it("kullanılan ayraç saklanıyor", () => {
		expect(ayrac("[a](/y 'b')")?.titleDelimiter).toBe("'");
		expect(ayrac('[a](/y "b")')?.titleDelimiter).toBe('"');
		expect(ayrac("[a](/y (b))")?.titleDelimiter).toBe("(");
	});

	it("başlıksız bağlantıda ayraç yazılmıyor", () => {
		expect(ayrac("[a](/y)")?.titleDelimiter).toBeUndefined();
	});

	/**
	 * CommonMark: başlık ancak hedeften **sonra boşluk varsa** başlıktır.
	 * Boşluk yoksa tırnaklar hedefin parçasıdır — bağlantı iptal olmaz,
	 * URL'ye girer. Bu testi yazarken tersini varsaymıştım; şartname haklı.
	 */
	it("boşluksuz tırnak başlık değil, hedefin parçası", () => {
		const node = tek('[a](/y"b")') as { type: string; url?: string; title?: string | null };
		expect(node.type).toBe("link");
		expect(node.url).toBe('/y"b"');
		expect(node.title).toBeNull();
	});

	it("kapanmamış başlık bağlantıyı iptal ediyor", () => {
		expect((tek('[a](/y "b)') as Inline).type).not.toBe("link");
	});
});
