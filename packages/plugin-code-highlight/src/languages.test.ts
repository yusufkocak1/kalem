/**
 * Dil kayıt defteri — testler  (İş listesi: F4-02)
 *
 * Buradaki asıl iddia kabul kriterinin ikinci yarısı: gramerler **ayrı
 * parçalar** hâlinde ve yalnızca gerekince yükleniyor. Boyut tarafını
 * `size-limit` ölçüyor (`.size-limit.json`); burada yükleyicilerin
 * gerçekten çalıştığı ve takma adların aynı gramere düştüğü sabitleniyor.
 */
import { describe, expect, it } from "vitest";
import { builtinLanguages, langOf, normalizeLang } from "./languages.js";

/** DOM olmadan `className` okuyan bir eleman taklidi. */
function elemanGibi(className: string): Element {
	return { className } as Element;
}

describe("normalizeLang", () => {
	it("boşluğu atıyor ve küçük harfe çeviriyor", () => {
		expect(normalizeLang("  JSON ")).toBe("json");
	});

	it("Türkçe locale'de de ASCII sonuç veriyor", () => {
		// Çit bilgisi ASCII: `TITLE` Türkçe kurallarla "tıtle" olurdu ve
		// hiçbir dil anahtarına denk düşmezdi.
		expect(normalizeLang("TITLE")).toBe("title");
		expect(normalizeLang("SQL")).toBe("sql");
	});
});

describe("langOf", () => {
	it("`language-` sınıfındaki adı okuyor", () => {
		expect(langOf(elemanGibi("language-js"))).toBe("js");
	});

	it("başka sınıfların arasından buluyor", () => {
		expect(langOf(elemanGibi("kalem-code language-python x"))).toBe("python");
	});

	it("büyük harfli adı normalleştiriyor", () => {
		expect(langOf(elemanGibi("language-SQL"))).toBe("sql");
	});

	it("nokta ve artı içeren adları kabul ediyor", () => {
		expect(langOf(elemanGibi("language-c++"))).toBe("c++");
		expect(langOf(elemanGibi("language-asp.net"))).toBe("asp.net");
	});

	it("sınıf yoksa null", () => {
		expect(langOf(elemanGibi("kalem-code"))).toBeNull();
	});

	it("`my-language-x` gibi bir sınıfı yanlışlıkla yakalamıyor", () => {
		expect(langOf(elemanGibi("my-language-x"))).toBeNull();
	});
});

describe("builtinLanguages", () => {
	it("takma adlar aynı yükleyiciyi paylaşıyor", () => {
		// Aynı fonksiyon nesnesi olmak zorunda: `import()` bir kez çalışsın.
		expect(builtinLanguages.ts).toBe(builtinLanguages.javascript);
		expect(builtinLanguages.md).toBe(builtinLanguages.markdown);
		expect(builtinLanguages.bash).toBe(builtinLanguages.shell);
	});

	it("her yükleyici adı kendinde olan bir gramer getiriyor", async () => {
		const beklenen: Readonly<Record<string, string>> = {
			javascript: "javascript",
			json: "json",
			css: "css",
			html: "html",
			python: "python",
			shell: "shell",
			sql: "sql",
			markdown: "markdown",
		};
		for (const [ad, gramerAdi] of Object.entries(beklenen)) {
			const yukleyici = builtinLanguages[ad];
			expect(yukleyici, ad).toBeDefined();
			const gramer = await (yukleyici as () => Promise<{ name: string }>)();
			expect(gramer.name).toBe(gramerAdi);
		}
	});

	it("kayıtlı olmayan dil `undefined`", () => {
		expect(builtinLanguages.klingon).toBeUndefined();
	});

	it("kullanıcı kendi dilini ekleyebiliyor", async () => {
		const kendi = { ...builtinLanguages, rust: async () => ({ name: "rust", rules: [] }) };
		expect(await (kendi.rust as () => Promise<{ name: string }>)()).toEqual({
			name: "rust",
			rules: [],
		});
		// Ekleme, kutudan çıkan haritayı bozmuyor.
		expect(builtinLanguages.rust).toBeUndefined();
	});
});
