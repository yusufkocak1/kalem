/**
 * Giriş kuralları  (İş listesi: F2-10)
 *
 * Kuralların tamamı saf: girdi belge + imleç, çıktı yeni belge + imleç.
 * Tarayıcı tarafı yalnızca "hangi tuştan sonra çalıştırılır" sorusunu
 * cevaplıyor ve orası `e2e/editor.spec.ts`'te.
 */
import { parse, serialize } from "@kalem/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Caret, EditResult } from "./block-edit.js";
import { assignIds, resetIds } from "./ids.js";
import { applyBlockRule, applyInlineRule, plainInline } from "./input-rules.js";

beforeEach(() => {
	resetIds();
});

const belge = (markdown: string) => assignIds(parse(markdown));
const imlec = (offset: number, path: number[] = []): Caret => ({ blockIndex: 0, path, offset });
const md = (sonuc: EditResult | null) => (sonuc === null ? "<null>" : serialize(sonuc.doc));

describe("blok kuralları", () => {
	/**
	 * Kural yalnızca **paragrafta** çalışıyor. Zaten başlık olan bir blokta
	 * `# ` yazmak ikinci bir dönüşüm tetiklememeli.
	 */
	it("zaten başlık olan blokta çalışmıyor", () => {
		expect(applyBlockRule(belge("# metin\n"), imlec(2))).toBeNull();
	});

	it("paragrafın başındaki `## ` ikinci seviye başlık yapıyor", () => {
		const doc = belge("x\n");
		const yazilan = {
			...doc,
			children: [{ ...doc.children[0], children: [{ type: "text", value: "## Başlık" }] }],
		};
		expect(md(applyBlockRule(yazilan as never, imlec(3)))).toBe("## Başlık\n");
	});

	it("`- ` madde imli liste yapıyor", () => {
		const doc = metinBelgesi("- madde");
		expect(md(applyBlockRule(doc, imlec(2)))).toBe("- madde\n");
	});

	/** Kullanıcının yazdığı işaret korunuyor — projenin temel kuralı. */
	it("`* ` yıldız işaretini koruyor", () => {
		expect(md(applyBlockRule(metinBelgesi("* madde"), imlec(2)))).toBe("* madde\n");
	});

	it("`1. ` numaralı liste yapıyor", () => {
		expect(md(applyBlockRule(metinBelgesi("1. madde"), imlec(3)))).toBe("1. madde\n");
	});

	it("`3) ` başlangıç numarasını ve ayracı koruyor", () => {
		expect(md(applyBlockRule(metinBelgesi("3) madde"), imlec(3)))).toBe("3) madde\n");
	});

	it("`> ` alıntı yapıyor", () => {
		expect(md(applyBlockRule(metinBelgesi("> söz"), imlec(2)))).toBe("> söz\n");
	});

	it("``` kod bloğu yapıyor", () => {
		expect(md(applyBlockRule(metinBelgesi("```"), imlec(3)))).toBe("```\n\n```\n");
	});

	it("`---` yatay çizgi yapıp altına paragraf açıyor", () => {
		const sonuc = applyBlockRule(metinBelgesi("---"), imlec(3));
		// Sondaki boş paragraf modelde gerçekten var: kullanıcı çizginin
		// altına yazmaya devam edebilmeli.
		expect(md(sonuc)).toBe("---\n\n\n");
		expect(sonuc?.caret?.blockIndex).toBe(1);
	});

	it("işaretten sonraki metin korunuyor", () => {
		const sonuc = applyBlockRule(metinBelgesi("# Işık"), imlec(2));
		expect(md(sonuc)).toBe("# Işık\n");
		expect(sonuc?.caret?.offset).toBe(0);
	});

	/** İmleç işaretin hemen sonunda değilse sürpriz dönüşüm olmamalı. */
	it("imleç başka yerdeyse kural çalışmıyor", () => {
		expect(applyBlockRule(metinBelgesi("- madde"), imlec(5))).toBeNull();
	});

	it("başlıkta liste kuralı çalışmıyor", () => {
		const doc = belge("# baslik\n");
		expect(applyBlockRule(doc, imlec(2))).toBeNull();
	});

	it("yedi diyez başlık değil", () => {
		expect(applyBlockRule(metinBelgesi("####### x"), imlec(8))).toBeNull();
	});
});

describe("satır içi kuralları", () => {
	it("`**a**` kalın yapıyor", () => {
		expect(md(applyInlineRule(metinBelgesi("**abc**"), imlec(7)))).toBe("**abc**\n");
	});

	it("`*a*` italik yapıyor", () => {
		expect(md(applyInlineRule(metinBelgesi("*abc*"), imlec(5)))).toBe("*abc*\n");
	});

	it("`~~a~~` üstü çizili yapıyor", () => {
		expect(md(applyInlineRule(metinBelgesi("~~abc~~"), imlec(7)))).toBe("~~abc~~\n");
	});

	it("`` `a` `` kod yapıyor", () => {
		expect(md(applyInlineRule(metinBelgesi("`abc`"), imlec(5)))).toBe("`abc`\n");
	});

	it("metnin ortasında da çalışıyor", () => {
		expect(md(applyInlineRule(metinBelgesi("bir **iki**"), imlec(11)))).toBe("bir **iki**\n");
	});

	it("işaretler metinden siliniyor", () => {
		const sonuc = applyInlineRule(metinBelgesi("**abc**"), imlec(7));
		const blok = sonuc?.doc.children[0] as { children: { type: string }[] };
		expect(blok.children[0]?.type).toBe("strong");
		expect(plainInline(blok.children as never)).toBe("abc");
	});

	it("imleç işaretin sonuna geliyor", () => {
		expect(applyInlineRule(metinBelgesi("**abc**"), imlec(7))?.caret?.offset).toBe(3);
	});

	it("boş gövde dönüştürülmüyor", () => {
		expect(applyInlineRule(metinBelgesi("****"), imlec(4))).toBeNull();
	});

	it("açılıştan sonra boşluk varsa çalışmıyor", () => {
		expect(applyInlineRule(metinBelgesi("** abc**"), imlec(8))).toBeNull();
	});

	it("kapanış yazılmadan çalışmıyor", () => {
		expect(applyInlineRule(metinBelgesi("**abc"), imlec(5))).toBeNull();
	});

	it("Türkçe karakterlerde ofset kaymıyor", () => {
		expect(md(applyInlineRule(metinBelgesi("**ışık**"), imlec(8)))).toBe("**ışık**\n");
	});
});

/**
 * Kullanıcının **henüz ayrıştırılmamış** metnini taşıyan bir paragraf.
 *
 * Doğrudan `parse("- madde")` kullanılamaz: ayrıştırıcı onu zaten listeye
 * çevirir, oysa kuralın sınadığı durum tam olarak "kullanıcı `- ` yazdı,
 * blok hâlâ paragraf".
 */
function metinBelgesi(metin: string) {
	return {
		type: "root" as const,
		children: [
			{ type: "paragraph" as const, id: "k1", children: [{ type: "text" as const, value: metin }] },
		],
	};
}
