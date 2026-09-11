/**
 * Belirteçleyici testleri  (İş listesi: F4-02)
 *
 * Testlerin çoğu **kayıpsızlık** üzerine: belirteçlerin metinleri
 * birleştirildiğinde kaynağın aynısını vermeli. Bu, vurgulamanın tek
 * gerçek doğruluk koşulu — renk yanlış olursa kod çirkin görünür, metin
 * kaybolursa kullanıcının yazdığı şey silinir.
 */
import { describe, expect, it } from "vitest";
import { grammar as css } from "./langs/css.js";
import { grammar as html } from "./langs/html.js";
import { grammar as javascript } from "./langs/javascript.js";
import { grammar as json } from "./langs/json.js";
import { grammar as markdown } from "./langs/markdown.js";
import { grammar as python } from "./langs/python.js";
import { grammar as shell } from "./langs/shell.js";
import { grammar as sql } from "./langs/sql.js";
import type { Grammar, TokenType } from "./token.js";
import { tokenize } from "./token.js";

const tumGramerler: readonly Grammar[] = [
	javascript,
	json,
	css,
	html,
	python,
	shell,
	sql,
	markdown,
];

/** Belirteç metinlerini birleştirir. */
function birlestir(code: string, grammar: Grammar): string {
	return tokenize(code, grammar)
		.map((t) => t.text)
		.join("");
}

/** Belirli bir metnin hangi türle boyandığı. */
function turu(code: string, grammar: Grammar, metin: string): TokenType | undefined {
	return tokenize(code, grammar).find((t) => t.text === metin)?.type;
}

describe("tokenize", () => {
	it("boş kaynak için belirteç üretmiyor", () => {
		expect(tokenize("", javascript)).toEqual([]);
	});

	it("hiçbir kural eşleşmezse her şey düz metin", () => {
		const bos: Grammar = { name: "bos", rules: [] };
		expect(tokenize("merhaba dünya", bos)).toEqual([{ type: "text", text: "merhaba dünya" }]);
	});

	it("eşit konumda gramerde önce yazılan kural kazanıyor", () => {
		const g: Grammar = {
			name: "sira",
			rules: [
				{ type: "keyword", pattern: /abc/ },
				{ type: "string", pattern: /abc/ },
			],
		};
		expect(tokenize("abc", g)).toEqual([{ type: "keyword", text: "abc" }]);
	});

	it("en erken eşleşme kazanıyor, sıradan bağımsız", () => {
		const g: Grammar = {
			name: "erken",
			rules: [
				{ type: "keyword", pattern: /b/ },
				{ type: "string", pattern: /a/ },
			],
		};
		expect(tokenize("ab", g)).toEqual([
			{ type: "string", text: "a" },
			{ type: "keyword", text: "b" },
		]);
	});

	it("sıfır uzunluklu desen sonsuz döngüye girmiyor", () => {
		// Gramer yazarının hatası sayfayı kilitlememeli.
		const g: Grammar = { name: "bos-desen", rules: [{ type: "keyword", pattern: /x*/ }] };
		expect(birlestir("aaa", g)).toBe("aaa");
	});

	it("gramerin `g` bayrağı olmadan da çalışıyor", () => {
		const g: Grammar = { name: "bayraksiz", rules: [{ type: "number", pattern: /\d+/ }] };
		expect(tokenize("a12b", g)).toEqual([
			{ type: "text", text: "a" },
			{ type: "number", text: "12" },
			{ type: "text", text: "b" },
		]);
	});

	it("aynı gramer iki kez kullanılınca aynı sonucu veriyor", () => {
		// Derlenmiş desenler önbellekte ve `lastIndex` taşıyor; sızarsa
		// ikinci çağrı kaynağın başını atlardı.
		const kod = "const a = 1;";
		expect(tokenize(kod, javascript)).toEqual(tokenize(kod, javascript));
	});
});

describe("kayıpsızlık", () => {
	/** Şablon dizesi işareti; kaynağa düz yazılsa linter uyarısı veriyor. */
	const DOLAR = String.fromCharCode(36);

	const ornekler: Readonly<Record<string, string>> = {
		javascript: `const f = (x) => \`${DOLAR}{x}\` // not\nclass A extends B {}`,
		json: '{"a": [1, 2.5, true, null], "b": {"c": "d"}}',
		css: ":root { --x: 4px; }\na:hover { color: #fff; margin: -1.5rem }",
		html: "<!-- x --><a href=\"#\" data-y='z'>&amp;</a>",
		python: 'def f(x):\n    """doc"""\n    return True # not',
		shell: '#!/bin/sh\nfor f in *.md; do echo "$f" --flag; done',
		sql: "SELECT count(*) FROM t WHERE a = 'it''s' -- not",
		markdown: "# Başlık\n\n**kalın** ve `kod`\n\n- madde\n",
	};

	for (const gramer of tumGramerler) {
		it(`${gramer.name}: belirteçler kaynağı eksiksiz kapsıyor`, () => {
			const kod = ornekler[gramer.name] as string;
			expect(birlestir(kod, gramer)).toBe(kod);
		});

		it(`${gramer.name}: rastgele metinde de kayıp yok`, () => {
			// Kod bloğuna her şey yazılabiliyor; gramerin "geçerli" kaynak
			// beklemesi yok.
			const cop = "\\\"'`{[(<>*&^%$#@!~ \t\n /*/ -- '' \"\" ``` \n\n";
			expect(birlestir(cop, gramer)).toBe(cop);
		});
	}
});

describe("gramerler", () => {
	it("javascript: anahtar sözcük, dize ve yorum ayırt ediliyor", () => {
		const kod = 'const s = "x"; // not';
		expect(turu(kod, javascript, "const")).toBe("keyword");
		expect(turu(kod, javascript, '"x"')).toBe("string");
		expect(turu(kod, javascript, "// not")).toBe("comment");
	});

	it("javascript: dizenin içindeki anahtar sözcük boyanmıyor", () => {
		const tokens = tokenize('"const"', javascript);
		expect(tokens).toEqual([{ type: "string", text: '"const"' }]);
	});

	it("javascript: çağrılan ad fonksiyon, büyük harfli ad tür", () => {
		expect(turu("new Map(); topla(1)", javascript, "topla")).toBe("function");
		expect(turu("let x: Sayac", javascript, "Sayac")).toBe("type");
	});

	it("json: anahtar dizeden ayrı boyanıyor", () => {
		const kod = '{"ad": "değer"}';
		expect(turu(kod, json, '"ad"')).toBe("property");
		expect(turu(kod, json, '"değer"')).toBe("string");
	});

	it("css: özellik adı ve özel değişken", () => {
		expect(turu("a { color: red }", css, "color")).toBe("property");
		expect(turu(":root { --marka: red }", css, "--marka")).toBe("variable");
	});

	it("css: eksi işaretli ölçü tek parça", () => {
		expect(turu("a { margin: -1.5rem }", css, "-1.5rem")).toBe("number");
	});

	it("html: etiket, öznitelik ve değeri", () => {
		const kod = '<a href="#">x</a>';
		expect(turu(kod, html, "<a")).toBe("tag");
		expect(turu(kod, html, "href")).toBe("attr");
		expect(turu(kod, html, '"#"')).toBe("string");
	});

	it("python: üç tırnaklı dize tek belirteç", () => {
		expect(turu('x = """a\nb"""', python, '"""a\nb"""')).toBe("string");
	});

	it("python: True tür değil, mantıksal değer", () => {
		expect(turu("x = True", python, "True")).toBe("boolean");
	});

	it("shell: değişken ve seçenek", () => {
		expect(turu("echo $HOME --hepsi", shell, "$HOME")).toBe("variable");
		expect(turu("ls --hepsi", shell, " --hepsi")).toBe("attr");
	});

	it("sql: anahtar sözcükler büyük/küçük harften bağımsız", () => {
		expect(turu("select 1", sql, "select")).toBe("keyword");
		expect(turu("SELECT 1", sql, "SELECT")).toBe("keyword");
	});

	it("sql: iki tırnakla kaçırılan dize tek parça", () => {
		expect(turu("a = 'it''s'", sql, "'it''s'")).toBe("string");
	});

	it("markdown: çitin içindeki yıldızlar kalın sayılmıyor", () => {
		const kod = "```\n**x**\n```";
		expect(tokenize(kod, markdown)).toEqual([{ type: "string", text: kod }]);
	});

	it("markdown: başlık ve kalın metin", () => {
		expect(turu("# Başlık", markdown, "# Başlık")).toBe("keyword");
		expect(turu("bu **kalın**", markdown, "**kalın**")).toBe("type");
	});
});

describe("gramer sağlığı", () => {
	for (const gramer of tumGramerler) {
		it(`${gramer.name}: geri bakış kullanmıyor`, () => {
			// Eski Safari `(?<=)` içeren bir düzenli ifadeyi ayrıştıramıyor
			// ve hata modülün tamamını yükletmiyor — vurgulama o tarayıcıda
			// sessizce kapanırdı.
			for (const kural of gramer.rules) {
				expect(kural.pattern.source).not.toContain("(?<");
			}
		});

		it(`${gramer.name}: desenler çok satırlı kaynakta takılmıyor`, () => {
			const uzun = `${"a\n".repeat(500)}x`;
			expect(birlestir(uzun, gramer)).toBe(uzun);
		});
	}
});
