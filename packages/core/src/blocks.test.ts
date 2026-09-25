import { describe, expect, it } from "vitest";
import type { Code, Heading, Paragraph, ThematicBreak } from "./ast.js";
import { must, parseBlocks } from "./blocks.js";

/** Kısayol: kökün çocukları. */
const bloklar = (md: string) => parseBlocks(md).children;
/** Kısayol: blok tipleri. */
const tipler = (md: string) => bloklar(md).map((b) => b.type);
/** Kısayol: tek bloklu kaynakta o blok. */
const tek = (md: string) => bloklar(md)[0];
/** Kısayol: bir bloğun düz metni (satır içi ayrıştırıcı henüz yok). */
const metin = (blok: unknown): string => {
	const cocuklar = (blok as { children?: { value?: string }[] }).children ?? [];
	return cocuklar.map((c) => c.value ?? "").join("");
};

describe("boş girdi", () => {
	it("boş kaynak boş belge veriyor", () => {
		expect(bloklar("")).toEqual([]);
	});

	it("yalnızca boş satırlar blok üretmiyor", () => {
		expect(bloklar("\n\n\n")).toEqual([]);
		expect(bloklar("   \n\t\n")).toEqual([]);
	});
});

describe("paragraf", () => {
	it("tek satırlık paragraf", () => {
		expect(tipler("Merhaba dünya")).toEqual(["paragraph"]);
		expect(metin(tek("Merhaba dünya"))).toBe("Merhaba dünya");
	});

	it("ardışık satırlar tek paragrafta birleşiyor", () => {
		expect(metin(tek("bir\niki\nüç"))).toBe("bir\niki\nüç");
	});

	it("boş satır paragrafları ayırıyor", () => {
		expect(tipler("bir\n\niki")).toEqual(["paragraph", "paragraph"]);
	});

	it("satır başlarındaki boşluk atılıyor", () => {
		expect(metin(tek("bir\n   iki"))).toBe("bir\niki");
	});

	it("Türkçe metni bozmuyor", () => {
		expect(metin(tek("Işık ışıldıyor, İstanbul'da ĞÜŞÇÖ"))).toBe(
			"Işık ışıldıyor, İstanbul'da ĞÜŞÇÖ",
		);
	});
});

describe("ATX başlık", () => {
	it("altı seviyeyi de tanıyor", () => {
		for (let d = 1; d <= 6; d++) {
			const h = tek(`${"#".repeat(d)} Başlık`) as Heading;
			expect(h.type).toBe("heading");
			expect(h.depth).toBe(d);
		}
	});

	it("yedi diyez başlık değil", () => {
		expect(tipler("####### Başlık")).toEqual(["paragraph"]);
	});

	/** `#etiket` başlık değildir — diyezden sonra boşluk şart. */
	it("boşluksuz diyez başlık değil", () => {
		expect(tipler("#etiket")).toEqual(["paragraph"]);
		expect(metin(tek("#etiket"))).toBe("#etiket");
	});

	it("içeriksiz başlık geçerli", () => {
		const h = tek("#") as Heading;
		expect(h.type).toBe("heading");
		expect(h.depth).toBe(1);
		expect(h.children).toEqual([]);
	});

	it("üç boşluğa kadar girinti kabul ediyor", () => {
		expect(tipler("   # Başlık")).toEqual(["heading"]);
	});

	it("dört boşluk girinti kod bloğu yapıyor", () => {
		expect(tipler("    # Başlık")).toEqual(["code"]);
	});

	it("kapanış diyezlerini içerikten atıyor", () => {
		const h = tek("## Başlık ##") as Heading;
		expect(metin(h)).toBe("Başlık");
		expect(h.syntax).toEqual({ style: "atx", closed: true });
	});

	/** Kapanış dizisi boşlukla önlenmeli: `## Başlık#` içeriği `Başlık#`. */
	it("boşluksuz sondaki diyez içeriğin parçası", () => {
		const h = tek("## Başlık#") as Heading;
		expect(metin(h)).toBe("Başlık#");
		expect(h.syntax?.closed).toBe(false);
	});

	it("yazım tercihini kaydediyor", () => {
		expect((tek("# Başlık") as Heading).syntax).toEqual({ style: "atx", closed: false });
	});
});

describe("setext başlık", () => {
	it("= alt çizgisi seviye 1 veriyor", () => {
		const h = tek("Başlık\n======") as Heading;
		expect(h.type).toBe("heading");
		expect(h.depth).toBe(1);
		expect(metin(h)).toBe("Başlık");
	});

	it("- alt çizgisi seviye 2 veriyor", () => {
		const h = tek("Başlık\n------") as Heading;
		expect(h.depth).toBe(2);
	});

	it("tek karakterlik alt çizgi yeterli", () => {
		expect(tipler("Başlık\n=")).toEqual(["heading"]);
	});

	it("çok satırlı paragrafı başlığa çeviriyor", () => {
		const h = tek("bir\niki\n===") as Heading;
		expect(metin(h)).toBe("bir\niki");
	});

	it("yazım tercihini kaydediyor", () => {
		expect((tek("Başlık\n------") as Heading).syntax).toEqual({
			style: "setext",
			underline: "-",
		});
	});

	/**
	 * Metinden farklı uzunluktaki çizgi yazarın tercihi (F6-11'de bulundu:
	 * `Başlık\n---` metin boyuna uzatılıyordu). Metin kadar olan çizgi
	 * kaydedilmiyor — metin değişince çizgi de onunla uzamalı.
	 */
	it("metinden farklı çizgi uzunluğunu kaydediyor", () => {
		expect((tek("Başlık\n---") as Heading).syntax?.underlineLength).toBe(3);
		expect((tek("Başlık\n==========") as Heading).syntax?.underlineLength).toBe(10);
		expect((tek("Başlık\n======") as Heading).syntax?.underlineLength).toBeUndefined();
	});

	/**
	 * `---` hem yatay çizgi hem setext alt çizgisi. Öncesinde paragraf varsa
	 * setext kazanır; yoksa yatay çizgidir. CommonMark'ın klasik tuzağı.
	 */
	it("paragraf olmadan --- yatay çizgi", () => {
		expect(tipler("---")).toEqual(["thematicBreak"]);
	});

	it("paragraftan sonra --- setext başlık", () => {
		expect(tipler("Başlık\n---")).toEqual(["heading"]);
	});

	it("boş satırla ayrılınca --- yine yatay çizgi", () => {
		expect(tipler("Paragraf\n\n---")).toEqual(["paragraph", "thematicBreak"]);
	});
});

describe("yatay çizgi", () => {
	it("üç işaretin üç türünü de tanıyor", () => {
		expect(tipler("***")).toEqual(["thematicBreak"]);
		expect(tipler("___")).toEqual(["thematicBreak"]);
		expect(tipler("* * *")).toEqual(["thematicBreak"]);
	});

	it("üçten az işaret çizgi değil", () => {
		expect(tipler("**")).toEqual(["paragraph"]);
	});

	it("karışık işaret çizgi değil", () => {
		expect(tipler("*-*")).toEqual(["paragraph"]);
	});

	/** Ham yazılış saklanıyor — `* * *` ile `***` aynı anlamda, farklı yazılışta. */
	it("ham yazılışı koruyor", () => {
		expect((tek("* * *") as ThematicBreak).syntax).toEqual({ raw: "* * *" });
		expect((tek("-----") as ThematicBreak).syntax).toEqual({ raw: "-----" });
	});
});

describe("çitli kod", () => {
	it("ters tırnak çitini ayrıştırıyor", () => {
		const c = tek("```\nkod\n```") as Code;
		expect(c.type).toBe("code");
		expect(c.value).toBe("kod\n");
		expect(c.lang).toBeNull();
	});

	it("tilde çitini ayrıştırıyor", () => {
		const c = tek("~~~\nkod\n~~~") as Code;
		expect(c.value).toBe("kod\n");
		expect(c.syntax).toEqual({ style: "fenced", fence: "~", fenceLength: 3 });
	});

	it("dil bilgisini alıyor", () => {
		expect((tek("```ts\nkod\n```") as Code).lang).toBe("ts");
	});

	it("dil ve kalan bilgiyi ayırıyor", () => {
		const c = tek("```ts twoslash başka\nkod\n```") as Code;
		expect(c.lang).toBe("ts");
		expect(c.meta).toBe("twoslash başka");
	});

	it("çit uzunluğunu koruyor", () => {
		expect((tek("````\nkod\n````") as Code).syntax?.fenceLength).toBe(4);
	});

	/** Kapanış çiti açılıştan kısa olamaz — kısa olan içerik sayılır. */
	it("kısa kapanış çitini içerik sayıyor", () => {
		expect((tek("````\nkod\n```\n````") as Code).value).toBe("kod\n```\n");
	});

	it("uzun kapanış çitini kabul ediyor", () => {
		expect((tek("```\nkod\n`````") as Code).value).toBe("kod\n");
	});

	it("kapanmamış çit dosya sonuna kadar sürüyor", () => {
		const c = tek("```\nkod\nsatır") as Code;
		expect(c.value).toBe("kod\nsatır\n");
	});

	it("boş kod bloğu", () => {
		expect((tek("```\n```") as Code).value).toBe("");
	});

	it("açılış girintisi kadarını içerikten soyuyor", () => {
		const c = tek("  ```\n  kod\n    girintili\n  ```") as Code;
		expect(c.value).toBe("kod\n  girintili\n");
	});

	it("kod içindeki Markdown ayrıştırılmıyor", () => {
		expect((tek("```\n# başlık değil\n```") as Code).value).toBe("# başlık değil\n");
	});

	/** Ters tırnak çitinin bilgi dizisi ters tırnak içeremez. */
	it("bilgi dizisinde ters tırnak varsa çit açmıyor", () => {
		expect(tipler("```a`b")).toEqual(["paragraph"]);
	});

	it("tilde çitinin bilgisinde ters tırnak olabilir", () => {
		expect(tipler("~~~a`b\nkod\n~~~")).toEqual(["code"]);
	});
});

describe("girintili kod", () => {
	it("dört boşlukla başlıyor", () => {
		const c = tek("    kod") as Code;
		expect(c.type).toBe("code");
		expect(c.value).toBe("kod\n");
		expect(c.syntax).toEqual({ style: "indented" });
		expect(c.lang).toBeNull();
	});

	it("sekme de dört sütun sayılıyor", () => {
		expect((tek("\tkod") as Code).value).toBe("kod\n");
	});

	it("fazladan girintiyi içerikte bırakıyor", () => {
		expect((tek("      kod") as Code).value).toBe("  kod\n");
	});

	it("çok satırlı", () => {
		expect((tek("    bir\n    iki") as Code).value).toBe("bir\niki\n");
	});

	it("araya giren boş satırı koruyor", () => {
		expect((tek("    bir\n\n    iki") as Code).value).toBe("bir\n\niki\n");
	});

	/** Sondaki boş satırlar kod bloğuna dahil değildir. */
	it("sondaki boş satırları atıyor", () => {
		const c = bloklar("    kod\n\n\nparagraf");
		expect((c[0] as Code).value).toBe("kod\n");
		expect(c[1]?.type).toBe("paragraph");
	});

	it("girinti bitince kod bitiyor", () => {
		expect(tipler("    kod\nparagraf")).toEqual(["code", "paragraph"]);
	});

	/** Paragrafın girintili devamı kod bloğu DEĞİLDİR. */
	it("paragraf devamı girintili olsa da kod olmuyor", () => {
		expect(tipler("paragraf\n    devam")).toEqual(["paragraph"]);
		expect(metin(tek("paragraf\n    devam"))).toBe("paragraf\ndevam");
	});
});

/**
 * CommonMark'ta paragraf boş satır olmadan da kesilebilir. Hangi blokların
 * kestiği, hangilerinin kesmediği ayrı ayrı belirlenmiştir — ve bu ayrım
 * gerçek belgelerde sürekli devreye girer.
 */
describe("paragrafı kesen bloklar", () => {
	it("ATX başlık boş satır olmadan kesiyor", () => {
		expect(tipler("paragraf\n# Başlık")).toEqual(["paragraph", "heading"]);
		expect(metin(tek("paragraf\n# Başlık"))).toBe("paragraf");
	});

	it("yatay çizgi boş satır olmadan kesiyor", () => {
		expect(tipler("paragraf\n***")).toEqual(["paragraph", "thematicBreak"]);
	});

	it("çitli kod boş satır olmadan kesiyor", () => {
		expect(tipler("paragraf\n```\nkod\n```")).toEqual(["paragraph", "code"]);
	});

	it("tilde çiti de kesiyor", () => {
		expect(tipler("paragraf\n~~~\nkod\n~~~")).toEqual(["paragraph", "code"]);
	});

	/** Girintili kod paragrafı KESMEZ — girintili satır paragrafın devamıdır. */
	it("girintili kod paragrafı kesmiyor", () => {
		expect(tipler("paragraf\n    girintili")).toEqual(["paragraph"]);
	});

	/** Ters tırnaklı bilgi dizisi geçerli çit değil, kesmemeli. */
	it("geçersiz çit paragrafı kesmiyor", () => {
		expect(tipler("paragraf\n```a`b")).toEqual(["paragraph"]);
		expect(metin(tek("paragraf\n```a`b"))).toBe("paragraf\n```a`b");
	});
});

describe("belge düzeyi yazım bilgisi", () => {
	it("satır sonunu, son satır sonunu ve BOM'u kökte tutuyor", () => {
		expect(parseBlocks("a\r\nb\r\n").syntax).toEqual({
			lineEnding: "\r\n",
			finalNewline: true,
			bom: false,
		});
		expect(parseBlocks("a").syntax).toEqual({
			lineEnding: "\n",
			finalNewline: false,
			bom: false,
		});
		expect(parseBlocks("﻿a").syntax?.bom).toBe(true);
	});
});

/**
 * `position` gidiş-dönüş sadakatinin ve editörün kaynak eşlemesinin temeli.
 * Yanlış ofset sessizce yanlış davranış demek.
 */
describe("position", () => {
	it("başlığın ofsetleri kaynağı birebir kesiyor", () => {
		const md = "# Başlık\n\nParagraf";
		const h = parseBlocks(md).children[0];
		expect(md.slice(h?.position?.start.offset, h?.position?.end.offset)).toBe("# Başlık");
	});

	it("paragrafın ofsetleri kaynağı birebir kesiyor", () => {
		const md = "# Başlık\n\nİki satırlık\nparagraf";
		const p = parseBlocks(md).children[1] as Paragraph;
		expect(md.slice(p.position?.start.offset, p.position?.end.offset)).toBe(
			"İki satırlık\nparagraf",
		);
	});

	it("çitli kodun ofsetleri kapanış çitini de kapsıyor", () => {
		const md = "```ts\nkod\n```";
		const c = parseBlocks(md).children[0];
		expect(md.slice(c?.position?.start.offset, c?.position?.end.offset)).toBe(md);
	});

	it("satır numaraları 1 tabanlı", () => {
		const blocks = parseBlocks("# Bir\n\n## İki").children;
		expect(blocks[0]?.position?.start.line).toBe(1);
		expect(blocks[1]?.position?.start.line).toBe(3);
	});

	it("CRLF'te ofsetler kaymıyor", () => {
		const md = "# Başlık\r\n\r\nParagraf";
		const p = parseBlocks(md).children[1];
		expect(md.slice(p?.position?.start.offset, p?.position?.end.offset)).toBe("Paragraf");
	});
});

describe("satır içi ayrıştırıcı takılabiliyor", () => {
	it("varsayılan olarak ham metin tek text düğümü", () => {
		expect((tek("**kalın**") as Paragraph).children).toEqual([
			{ type: "text", value: "**kalın**" },
		]);
	});

	/** F1-04 buraya bağlanacak. */
	it("seçenekle değiştirilebiliyor", () => {
		const belge = parseBlocks("metin", {
			parseInline: (raw) => [{ type: "emphasis", children: [{ type: "text", value: raw }] }],
		});
		expect((belge.children[0] as Paragraph).children[0]?.type).toBe("emphasis");
	});
});

describe("karışık belge", () => {
	it("gerçekçi bir belgeyi doğru bölüyor", () => {
		const md = [
			"# Başlık",
			"",
			"Giriş paragrafı.",
			"",
			"## Alt başlık",
			"",
			"```ts",
			"const a = 1;",
			"```",
			"",
			"---",
			"",
			"Son paragraf",
			"ikinci satır",
			"",
			"    girintili kod",
		].join("\n");

		expect(tipler(md)).toEqual([
			"heading",
			"paragraph",
			"heading",
			"code",
			"thematicBreak",
			"paragraph",
			"code",
		]);
	});
});

/**
 * `must` ayrıştırıcının iç tutarlılık kontrolü. Genel API'nin parçası değil,
 * ama tek kontrol noktası olduğu için doğrudan test ediliyor: buradaki bir
 * hata onlarca yerde sessiz yanlış davranışa dönüşür.
 */
describe("must", () => {
	it("tanımlı değeri olduğu gibi veriyor", () => {
		expect(must(0, "sıfır")).toBe(0);
		expect(must("", "boş metin")).toBe("");
		expect(must(false, "yanlış")).toBe(false);
		expect(must(null, "null")).toBeNull();
	});

	it("undefined gelirse ne aradığını söyleyerek patlıyor", () => {
		expect(() => must(undefined, "çit girintisi")).toThrow(/çit girintisi/);
	});
});
