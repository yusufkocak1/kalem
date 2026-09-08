/**
 * Bağlantı hedefi ve başlığının geri yazımı  (İş listesi: F1-07)
 *
 * Ayrı dosya, çünkü buradaki testlerin ortak sorusu tek: **AST çözülmüş
 * değer taşıyor, serileştirici kaçışı geri koyabiliyor mu.** Ayrıştırıcı
 * tarafındaki eşi `inline.test.ts` içinde.
 */
import { describe, expect, it } from "vitest";
import type { Inline } from "./ast.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

/** Markdown → AST → Markdown; sondaki satır sonu atılır. */
const tur = (markdown: string) => serialize(parse(markdown)).replace(/\n$/, "");

/** Elde kurulmuş bir bağlantı düğümünü yazar (ayrıştırıcıdan geçmeden). */
function baglanti(url: string, title: string | null = null): string {
	const node: Inline = {
		type: "link",
		url,
		title,
		children: [{ type: "text", value: "a" }],
	};
	return serialize(node);
}

describe("hedef yazımı", () => {
	it("dengeli parantez olduğu gibi kalıyor — gidiş-dönüş byte-birebir", () => {
		expect(tur("[a](foo(bar))")).toBe("[a](foo(bar))");
	});

	it("iç içe dengeli parantez", () => {
		expect(tur("[a](foo(and(bar)))")).toBe("[a](foo(and(bar)))");
	});

	it("gerçek dünya: parantezli Wikipedia bağlantısı", () => {
		const markdown = "[a](https://tr.wikipedia.org/wiki/Kalem_(araç))";
		expect(tur(markdown)).toBe(markdown);
	});

	/**
	 * Elde kurulmuş düğümde parantez dengesiz olabilir. Kaçışlanmazsa
	 * bağlantı erken kapanır ve çıktı bambaşka bir şeye ayrıştırılır.
	 */
	it("dengesiz parantez kaçışlanıyor", () => {
		expect(baglanti("foo)bar")).toBe("[a](foo\\)bar)");
		expect(baglanti("foo(bar")).toBe("[a](foo\\(bar)");
	});

	it("dengesiz parantezli hedef geri okunduğunda aynı değeri veriyor", () => {
		const yazilan = baglanti("foo)bar");
		const geri = parse(yazilan).children[0] as { children: { url?: string }[] };
		expect(geri.children[0]?.url).toBe("foo)bar");
	});

	it("boşluklu hedef açılı ayraca alınıyor", () => {
		expect(baglanti("bir iki")).toBe("[a](<bir iki>)");
	});

	it("boş hedef açılı ayraca alınıyor", () => {
		expect(baglanti("")).toBe("[a](<>)");
	});

	it("ters bölü kaçışlanıyor", () => {
		expect(baglanti("/b\\c")).toBe("[a](/b\\\\c)");
	});

	it("açılı ayraç içeren hedefte ayraçlar kaçışlanıyor", () => {
		expect(baglanti("a<b>c")).toBe("[a](<a\\<b\\>c>)");
	});
});

describe("başlık yazımı", () => {
	it("kaynaktaki ayraç korunuyor", () => {
		expect(tur("[a](/y 'b')")).toBe("[a](/y 'b')");
		expect(tur('[a](/y "b")')).toBe('[a](/y "b")');
		expect(tur("[a](/y (b))")).toBe("[a](/y (b))");
	});

	it("başlıktaki tırnak kaçışlanıyor", () => {
		expect(baglanti("/y", 'tır"nak')).toBe('[a](/y "tır\\"nak")');
	});

	it("kaçışlanmış başlık geri okunduğunda aynı değeri veriyor", () => {
		expect(tur('[a](/y "tır\\"nak")')).toBe('[a](/y "tır\\"nak")');
	});

	it("parantezli başlıkta iki parantez de kaçışlanıyor", () => {
		const node: Inline = {
			type: "link",
			url: "/y",
			title: "a(b)c",
			children: [{ type: "text", value: "a" }],
			syntax: { style: "inline", titleDelimiter: "(" },
		};
		expect(serialize(node)).toBe("[a](/y (a\\(b\\)c))");
	});
});

describe("tanım (definition) yazımı", () => {
	it("aynı kaçışlama kuralları tanımda da geçerli", () => {
		expect(tur("[k]: foo(bar)")).toBe("[k]: foo(bar)");
	});

	it("başlıklı tanım", () => {
		expect(tur('[k]: /y "b"')).toBe('[k]: /y "b"');
	});
});
