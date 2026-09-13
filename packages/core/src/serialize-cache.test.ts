/**
 * Blok başına serileştirme önbelleği  (İş listesi: F6-08)
 *
 * Önbellek bir hız kararı ama testlerin tamamı **doğruluk** testi: hızlı
 * ama bayat çıktı, yavaş doğru çıktıdan kötü. Önbellek açıkken üretilen
 * metin, kapalıyken üretilenle her durumda birebir aynı olmalı.
 */
import { describe, expect, it } from "vitest";
import { replaceAt } from "./edit.js";
import { parse } from "./parse.js";
import { createSerializeCache, serialize } from "./serialize.js";

const BELGE = `# Başlık

Bir paragraf, **kalın** ve *eğik* taşıyor.

* yıldız
* işareti

1) parantez ayracı

> Alıntı

\`\`\`ts
const x = 1;
\`\`\`

---

Son paragraf.
`;

describe("önbellekli serileştirme", () => {
	it("önbelleksizle aynı metni veriyor", () => {
		const doc = parse(BELGE);
		expect(serialize(doc, { cache: createSerializeCache() })).toBe(serialize(doc));
	});

	it("aynı önbellekle ikinci çağrı da aynı", () => {
		const doc = parse(BELGE);
		const cache = createSerializeCache();
		expect(serialize(doc, { cache })).toBe(BELGE);
		expect(serialize(doc, { cache })).toBe(BELGE);
	});

	it("değişen blok tazeleniyor, değişmeyenler korunuyor", () => {
		/*
		 * Önbelleğin asıl işi bu ve bayatlarsa ilk burada bayatlar:
		 * belgenin bir bloğu değişiyor, geri kalanı aynı nesne kalıyor.
		 */
		const doc = parse(BELGE);
		const cache = createSerializeCache();
		serialize(doc, { cache });

		const yeni = replaceAt(doc, [2], {
			type: "paragraph",
			children: [{ type: "text", value: "Değişti." }],
		} as never);

		expect(serialize(yeni, { cache })).toBe(serialize(yeni));
		expect(serialize(yeni, { cache })).toContain("Değişti.");
		expect(serialize(yeni, { cache })).toContain("# Başlık");
	});

	it("yazım tercihi değişince önbellek geçersizleşiyor", () => {
		/*
		 * Aynı düğüm farklı tercihlerle farklı Markdown veriyor; anahtar
		 * tek başına düğüm olsaydı ikinci çağrı ilkin çıktısını verirdi.
		 */
		const doc = parse("- madde\n");
		const cache = createSerializeCache();
		const varsayilan = serialize(doc, { cache });
		const yildizli = serialize(doc, { cache, bulletMarker: "*" });

		expect(serialize(doc, { cache })).toBe(varsayilan);
		expect(yildizli).toBe(serialize(doc, { bulletMarker: "*" }));
	});

	it("satır sonu tercihi de imzada", () => {
		const doc = parse("bir\n\niki\n");
		const cache = createSerializeCache();
		const lf = serialize(doc, { cache });
		const crlf = serialize(doc, { cache, lineEnding: "\r\n" });
		expect(crlf).toBe(serialize(doc, { lineEnding: "\r\n" }));
		expect(serialize(doc, { cache })).toBe(lf);
	});

	it("aynı önbellek iki belgede karışmıyor", () => {
		const cache = createSerializeCache();
		const a = parse("# A\n");
		const b = parse("# B\n");
		expect(serialize(a, { cache })).toBe("# A\n");
		expect(serialize(b, { cache })).toBe("# B\n");
		expect(serialize(a, { cache })).toBe("# A\n");
	});

	it("ön madde blokları da doğru çıkıyor", () => {
		// YAML/TOML önbelleğe girmiyor (ayrı dalda üretiliyorlar); çıktının
		// yine de doğru olduğu sabitleniyor.
		const metin = "---\nbaslik: Deneme\n---\n\nGövde.\n";
		const doc = parse(metin);
		const cache = createSerializeCache();
		expect(serialize(doc, { cache })).toBe(serialize(doc));
		expect(serialize(doc, { cache })).toBe(metin);
	});

	it("blokların arasındaki boş satırlar korunuyor", () => {
		// Aralar önbellekten değil komşuların konumundan hesaplanıyor;
		// önbellek bunu bozmamalı.
		const metin = "bir\n\n\n\niki\n";
		const doc = parse(metin);
		const cache = createSerializeCache();
		expect(serialize(doc, { cache })).toBe(metin);
	});
});
