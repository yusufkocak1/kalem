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
		expect(c.syntax).toEqual({ fenceLength: 1 });
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

	it("tek boşluk yumuşak satır sonu", () => {
		expect(yapi("bir \niki")).toEqual(["text(bir\niki)"]);
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
