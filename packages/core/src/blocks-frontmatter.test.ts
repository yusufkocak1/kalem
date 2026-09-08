import { describe, expect, it } from "vitest";
import type { Toml, Yaml } from "./ast.js";
import { parseBlocks } from "./blocks.js";

const bloklar = (md: string) => parseBlocks(md).children;
const tipler = (md: string) => bloklar(md).map((b) => b.type);

/**
 * Frontmatter **ayrıştırılmaz, olduğu gibi korunur** (F1-06).
 *
 * YAML ayrıştırıcısı eklemek çekirdeğe 3rd-party bağımlılık sokardı ve
 * projenin temel vaadini bozardı. Kullanıcının frontmatter'ına ihtiyacı olan
 * kendi ayrıştırıcısını `value` üzerinde çalıştırır.
 */
describe("YAML frontmatter", () => {
	it("dosya başındaki --- bloğunu tanıyor", () => {
		const y = bloklar("---\nbaslik: Deneme\n---\n\nmetin")[0] as Yaml;
		expect(y.type).toBe("yaml");
		expect(y.value).toBe("baslik: Deneme");
	});

	it("içeriği ayrıştırmadan olduğu gibi taşıyor", () => {
		const y = bloklar("---\na: 1\nb:\n  - x\n  - y\n---").at(0) as Yaml;
		expect(y.value).toBe("a: 1\nb:\n  - x\n  - y");
	});

	it("frontmatter'dan sonraki içerik normal ayrıştırılıyor", () => {
		expect(tipler("---\na: 1\n---\n\n# Başlık\n\nmetin")).toEqual(["yaml", "heading", "paragraph"]);
	});

	it("boş frontmatter", () => {
		expect((bloklar("---\n---")[0] as Yaml).value).toBe("");
	});

	it("Türkçe içeriği bozmuyor", () => {
		const y = bloklar("---\nbaslik: Işık ve Gölge\netiket: İstatistik\n---")[0] as Yaml;
		expect(y.value).toBe("baslik: Işık ve Gölge\netiket: İstatistik");
	});
});

describe("TOML frontmatter", () => {
	it("+++ bloğunu tanıyor", () => {
		const t = bloklar('+++\nbaslik = "Deneme"\n+++')[0] as Toml;
		expect(t.type).toBe("toml");
		expect(t.value).toBe('baslik = "Deneme"');
	});
});

/**
 * Frontmatter yalnızca **dosyanın en başında** geçerlidir. Bu kural olmasa
 * belgenin ortasındaki her yatay çizgi çifti frontmatter'a dönerdi.
 */
describe("frontmatter sınırları", () => {
	/**
	 * Ortadaki `---` yatay çizgidir. Devamındaki `a: 1\n---` ise setext
	 * başlığa dönüşür — `---` bir paragrafın hemen altındayken alt çizgidir.
	 * Yani frontmatter dışında bu dizilim tamamen farklı çözülür; kuralın
	 * "yalnızca ilk satır" olmasının sebebi tam olarak bu.
	 */
	it("ilk satırda değilse frontmatter değil", () => {
		expect(tipler("metin\n\n---\na: 1\n---")).toEqual(["paragraph", "thematicBreak", "heading"]);
	});

	it("kapanmamış --- yatay çizgiye düşüyor", () => {
		expect(tipler("---\na: 1")).toEqual(["thematicBreak", "paragraph"]);
	});

	it("kapanmamış +++ paragrafa düşüyor", () => {
		expect(tipler("+++\na = 1")).toEqual(["paragraph"]);
	});

	it("sınırlayıcıda fazladan karakter varsa frontmatter değil", () => {
		// `--- ` (sondaki boşluk) sınırlayıcı sayılmaz: yatay çizgi olur,
		// kalan `a: 1\n---` ise setext başlığa döner.
		expect(tipler("--- \na: 1\n---")).toEqual(["thematicBreak", "heading"]);
	});

	it("frontmatter olmayan belgede kök çocukları değişmiyor", () => {
		expect(tipler("# Başlık")).toEqual(["heading"]);
	});
});

describe("frontmatter position", () => {
	it("ofsetleri kaynağı kesiyor", () => {
		const md = "---\na: 1\n---\n\nmetin";
		const y = parseBlocks(md).children[0];
		expect(md.slice(y?.position?.start.offset, y?.position?.end.offset)).toBe("---\na: 1\n---");
	});

	it("sonraki bloğun satır numarası doğru", () => {
		const md = "---\na: 1\n---\n\n# Başlık";
		expect(parseBlocks(md).children[1]?.position?.start.line).toBe(5);
	});
});
