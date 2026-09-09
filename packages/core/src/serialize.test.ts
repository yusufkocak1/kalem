import { describe, expect, it } from "vitest";
import type { Block, Inline, Root } from "./ast.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

/**
 * Gidiş-dönüş testleri (`roundtrip.test.ts`) yalnızca **ayrıştırılmış**
 * düğümleri kapsar — onlarda `syntax` doludur. Bu dosya diğer yolu sınar:
 * editörün sıfırdan ürettiği, yazım tercihi taşımayan düğümler. `serialize`
 * o durumda yapılandırılmış varsayılanlara düşmeli.
 */

/** Kök sarmalayıcı olmadan tek blok serileştirir. */
const blok = (node: Block, options = {}) => serialize(node, options);
const satirIci = (node: Inline, options = {}) => serialize(node, options);
const metin = (value: string): Inline => ({ type: "text", value });

describe("yazım tercihi olmayan düğümler — varsayılanlar", () => {
	it("başlık ATX üretiyor", () => {
		expect(blok({ type: "heading", depth: 2, children: [metin("Başlık")] })).toBe("## Başlık");
	});

	it("içeriksiz başlık", () => {
		expect(blok({ type: "heading", depth: 3, children: [] })).toBe("###");
	});

	it("yatay çizgi varsayılanı", () => {
		expect(blok({ type: "thematicBreak" })).toBe("---");
		expect(blok({ type: "thematicBreak" }, { thematicBreak: "***" })).toBe("***");
	});

	it("liste işareti varsayılanı ve seçeneği", () => {
		const liste: Block = {
			type: "list",
			ordered: false,
			start: null,
			spread: false,
			children: [
				{
					type: "listItem",
					checked: null,
					spread: false,
					children: [{ type: "paragraph", children: [metin("a")] }],
				},
				{
					type: "listItem",
					checked: null,
					spread: false,
					children: [{ type: "paragraph", children: [metin("b")] }],
				},
			],
		};
		expect(blok(liste)).toBe("- a\n- b");
		expect(blok(liste, { bulletMarker: "*" })).toBe("* a\n* b");
	});

	it("sıralı liste numaralandırıyor", () => {
		const liste: Block = {
			type: "list",
			ordered: true,
			start: 3,
			spread: false,
			children: [
				{
					type: "listItem",
					checked: null,
					spread: false,
					children: [{ type: "paragraph", children: [metin("a")] }],
				},
				{
					type: "listItem",
					checked: null,
					spread: false,
					children: [{ type: "paragraph", children: [metin("b")] }],
				},
			],
		};
		expect(blok(liste)).toBe("3. a\n4. b");
		expect(blok(liste, { orderedDelimiter: ")" })).toBe("3) a\n4) b");
	});

	it("görev listesi işareti yazıyor", () => {
		const liste: Block = {
			type: "list",
			ordered: false,
			start: null,
			spread: false,
			children: [
				{
					type: "listItem",
					checked: false,
					spread: false,
					children: [{ type: "paragraph", children: [metin("a")] }],
				},
				{
					type: "listItem",
					checked: true,
					spread: false,
					children: [{ type: "paragraph", children: [metin("b")] }],
				},
			],
		};
		expect(blok(liste)).toBe("- [ ] a\n- [x] b");
	});

	it("kod çiti varsayılanı ve seçeneği", () => {
		const kod: Block = { type: "code", lang: "ts", meta: null, value: "a\n" };
		expect(blok(kod)).toBe("```ts\na\n```");
		expect(blok(kod, { codeFence: "~" })).toBe("~~~ts\na\n~~~");
	});

	it("kod bilgisi dil ve meta birleşiyor", () => {
		expect(blok({ type: "code", lang: "ts", meta: "twoslash", value: "a\n" })).toBe(
			"```ts twoslash\na\n```",
		);
	});

	/** Çit, içerikteki en uzun diziden uzun olmalı — yoksa erken kapanır. */
	it("içerikte çit varsa uzatıyor", () => {
		expect(blok({ type: "code", lang: null, meta: null, value: "```\nx\n```\n" })).toBe(
			"````\n```\nx\n```\n````",
		);
	});

	it("vurgu işareti varsayılanı ve seçeneği", () => {
		const em: Inline = { type: "emphasis", children: [metin("a")] };
		expect(satirIci(em)).toBe("*a*");
		expect(satirIci(em, { emphasisMarker: "_" })).toBe("_a_");
		const st: Inline = { type: "strong", children: [metin("a")] };
		expect(satirIci(st)).toBe("**a**");
		expect(satirIci(st, { emphasisMarker: "_" })).toBe("__a__");
	});

	it("üstü çizili varsayılanı iki tilde", () => {
		expect(satirIci({ type: "delete", children: [metin("a")] })).toBe("~~a~~");
	});

	it("bağlantı ve görsel", () => {
		expect(satirIci({ type: "link", url: "/u", title: null, children: [metin("a")] })).toBe(
			"[a](/u)",
		);
		expect(satirIci({ type: "link", url: "/u", title: "T", children: [metin("a")] })).toBe(
			'[a](/u "T")',
		);
		expect(satirIci({ type: "image", url: "/r.png", alt: "a", title: null })).toBe("![a](/r.png)");
	});

	it("boşluklu hedef açılı ayraca alınıyor", () => {
		expect(satirIci({ type: "link", url: "a b", title: null, children: [metin("x")] })).toBe(
			"[x](<a b>)",
		);
	});

	/**
	 * Sert satır sonu **iki yanında da içerik** ister. Tek başına duran bir
	 * `break` yazılırsa satır sonunda görünmez boşluk bırakır ve yeniden
	 * ayrıştırılınca kaybolur — özellik testi bunu yakaladı.
	 */
	it("tek başına duran sert satır sonu yazılmıyor", () => {
		expect(satirIci({ type: "break" })).toBe("");
	});

	/**
	 * Varsayılan ters bölü: iki boşluk görünmez ve satır sonu boşluğunu
	 * kırpan her araç onu sessizce yok eder. Kaynakta iki boşlukla yazılmış
	 * satır sonları `syntax.marker` sayesinde korunuyor (aşağıdaki test).
	 */
	it("iki metin arasındaki sert satır sonu ters bölüyle yazılıyor", () => {
		expect(blok({ type: "paragraph", children: [metin("a"), { type: "break" }, metin("b")] })).toBe(
			"a\\\nb",
		);
	});

	it("başvuru varsayılanı tam biçim", () => {
		expect(
			satirIci({ type: "linkReference", identifier: "e", label: "e", children: [metin("a")] }),
		).toBe("[a][e]");
	});
});

describe("tablo — ham metin yoksa üretiliyor", () => {
	it("hizalamalarla birlikte", () => {
		const t: Block = {
			type: "table",
			align: ["left", "right", "center", null],
			children: [
				{
					type: "tableRow",
					children: [
						{ type: "tableCell", children: [metin("a")] },
						{ type: "tableCell", children: [metin("b")] },
						{ type: "tableCell", children: [metin("c")] },
						{ type: "tableCell", children: [metin("d")] },
					],
				},
			],
		};
		expect(blok(t)).toBe("| a | b | c | d |\n| :--- | ---: | :---: | --- |");
	});
});

describe("girintili kod", () => {
	it("dört boşlukla yazıyor", () => {
		expect(
			blok({
				type: "code",
				lang: null,
				meta: null,
				value: "a\nb\n",
				syntax: { style: "indented" },
			}),
		).toBe("    a\n    b");
	});

	it("boş satırı girintilemiyor", () => {
		expect(
			blok({
				type: "code",
				lang: null,
				meta: null,
				value: "a\n\nb\n",
				syntax: { style: "indented" },
			}),
		).toBe("    a\n\n    b");
	});
});

describe("alıntı", () => {
	it("her satıra önek koyuyor", () => {
		expect(
			blok({
				type: "blockquote",
				children: [
					{ type: "paragraph", children: [metin("a")] },
					{ type: "paragraph", children: [metin("b")] },
				],
			}),
		).toBe("> a\n>\n> b");
	});

	/** Boş satır kısa öneki alır: sonda gereksiz boşluk kalmasın. */
	it("boş satırda sondaki boşluk yok", () => {
		const out = blok({
			type: "blockquote",
			children: [
				{ type: "paragraph", children: [metin("a")] },
				{ type: "paragraph", children: [metin("b")] },
			],
		});
		expect(out.split("\n")[1]).toBe(">");
	});
});

/**
 * Kaçışlama bağlama duyarlı olmak zorunda: gereğinden fazlası çıktıyı
 * okunmaz yapar, azı ise metni bozar. Bu testler dengeyi sabitliyor.
 */
describe("kaçışlama", () => {
	const p = (value: string) => blok({ type: "paragraph", children: [metin(value)] });

	it("yanları boşluklu işaretler kaçırılmıyor", () => {
		expect(p("5 * 3 * 2")).toBe("5 * 3 * 2");
		expect(p("a ~ b")).toBe("a ~ b");
		expect(p("a _ b")).toBe("a _ b");
	});

	it("kelime içi alt çizgi kaçırılmıyor", () => {
		expect(p("dosya_adi_uzun")).toBe("dosya_adi_uzun");
	});

	it("eşi olmayan tilde kaçırılmıyor", () => {
		expect(p("~1 hafta sürer")).toBe("~1 hafta sürer");
	});

	it("eşi olan tilde kaçırılıyor", () => {
		expect(p("~a~ metni")).toBe("\\~a\\~ metni");
	});

	it("vurgu açabilecek yıldız kaçırılıyor", () => {
		expect(p("*vurgu*")).toBe("\\*vurgu\\*");
	});

	it("köşeli ayraç ve ters tırnak her yerde kaçırılıyor", () => {
		expect(p("[a] ve `b`")).toBe("\\[a\\] ve \\`b\\`");
	});

	it("satır başındaki blok işaretleri kaçırılıyor", () => {
		expect(p("# başlık değil")).toBe("\\# başlık değil");
		expect(p("> alıntı değil")).toBe("\\> alıntı değil");
		// Kaçırılan ayraç, rakam değil: `\1` diye bir kaçış yok.
		expect(p("1. liste değil")).toBe("1\\. liste değil");
	});

	/** Başlık içindeki `1.` liste açamaz — satır zaten `##` ile başlamıştır. */
	it("başlık içinde blok işaretleri kaçırılmıyor", () => {
		expect(blok({ type: "heading", depth: 2, children: [metin("1. Bölüm")] })).toBe("## 1. Bölüm");
	});

	it("kaçırılan metin yeniden ayrıştırılınca aynı kalıyor", () => {
		for (const ornek of ["*vurgu*", "[a]", "# başlık", "1. liste", "a`b`c", "~a~"]) {
			const md = p(ornek);
			const geri = parse(md).children[0] as { children: { value?: string }[] };
			expect(geri.children.map((c) => c.value ?? "").join("")).toBe(ornek);
		}
	});
});

describe("kök düzeyi", () => {
	it("boş belge boş metin", () => {
		expect(serialize({ type: "root", children: [] })).toBe("");
	});

	it("son satır sonu varsayılan olarak ekleniyor", () => {
		expect(
			serialize({ type: "root", children: [{ type: "paragraph", children: [metin("a")] }] }),
		).toBe("a\n");
	});

	it("frontmatter geri yazılıyor", () => {
		const kok: Root = {
			type: "root",
			children: [
				{ type: "yaml", value: "a: 1" },
				{ type: "paragraph", children: [metin("m")] },
			],
		};
		expect(serialize(kok)).toBe("---\na: 1\n---\n\nm\n");
	});

	it("TOML frontmatter", () => {
		expect(serialize({ type: "root", children: [{ type: "toml", value: "a = 1" }] })).toBe(
			"+++\na = 1\n+++\n",
		);
	});

	it("BOM geri konuyor", () => {
		const kok: Root = {
			type: "root",
			syntax: { lineEnding: "\n", finalNewline: true, bom: true },
			children: [{ type: "paragraph", children: [metin("a")] }],
		};
		expect(serialize(kok)).toBe("﻿a\n");
	});

	it("CRLF satır sonu uygulanıyor", () => {
		const kok: Root = {
			type: "root",
			syntax: { lineEnding: "\r\n", finalNewline: true, bom: false },
			children: [
				{ type: "paragraph", children: [metin("a")] },
				{ type: "paragraph", children: [metin("b")] },
			],
		};
		expect(serialize(kok)).toBe("a\r\n\r\nb\r\n");
	});
});

/** Kapsam raporunun gösterdiği, testsiz kalmış yollar. */
describe("daha az yürünen yollar", () => {
	it("blok düzeyi ham HTML olduğu gibi yazılıyor", () => {
		expect(blok({ type: "html", value: "<div>\nx\n</div>" })).toBe("<div>\nx\n</div>");
	});

	it("satır içi ham HTML olduğu gibi yazılıyor", () => {
		expect(satirIci({ type: "html", value: "<br>" })).toBe("<br>");
	});

	it("başvurulu görsel", () => {
		expect(satirIci({ type: "imageReference", identifier: "e", label: "e", alt: "a" })).toBe(
			"![a][e]",
		);
	});

	it("alt metni olmayan başvurulu görsel", () => {
		expect(satirIci({ type: "imageReference", identifier: "e", label: "e", alt: null })).toBe(
			"![][e]",
		);
	});

	it("ters bölülü sert satır sonu", () => {
		expect(
			blok({
				type: "paragraph",
				children: [metin("a"), { type: "break", syntax: { marker: "backslash" } }, metin("b")],
			}),
		).toBe("a\\\nb");
	});

	/** Autolink metni iç düğümlerden toplanır — kod ve HTML dahil. */
	it("autolink metni iç düğümlerden toplanıyor", () => {
		expect(
			satirIci({
				type: "link",
				url: "https://a.b",
				title: null,
				children: [{ type: "inlineCode", value: "https://a.b" }],
				syntax: { style: "autolink" },
			}),
		).toBe("<https://a.b>");
	});

	it("iç içe vurgu içeren literal bağlantı düz metne iniyor", () => {
		expect(
			satirIci({
				type: "link",
				url: "https://a.b",
				title: null,
				children: [{ type: "emphasis", children: [metin("https://a.b")] }],
				syntax: { style: "literal" },
			}),
		).toBe("https://a.b");
	});

	it("bağlantı tanımı boşluklu hedefi sarıyor", () => {
		expect(blok({ type: "definition", identifier: "e", label: "e", url: "a b", title: null })).toBe(
			"[e]: <a b>",
		);
	});

	it("bağlantı tanımı başlığı yazıyor", () => {
		expect(blok({ type: "definition", identifier: "e", label: "E", url: "/u", title: "T" })).toBe(
			'[E]: /u "T"',
		);
	});

	/**
	 * Vurgu bir **eş** gerektirir. Eşi olmayan tek işaret düz metindir ve
	 * kaçırılmaz — aksi hâlde `_baslangic` gibi sıradan metinler ters bölüyle
	 * dolardı.
	 */
	it("eşi olmayan alt çizgi kaçırılmıyor", () => {
		const p = (v: string) => blok({ type: "paragraph", children: [metin(v)] });
		expect(p("_baslangic")).toBe("_baslangic");
		expect(p("bitis_")).toBe("bitis_");
	});

	it("eşi olan alt çizgi kaçırılıyor", () => {
		const p = (v: string) => blok({ type: "paragraph", children: [metin(v)] });
		expect(p("_vurgu_")).toBe("\\_vurgu\\_");
	});
});
