/**
 * Geçmiş yığını  (İş listesi: F2-09)
 *
 * Zaman bağımlı davranış (gruplama) test edilebilir olsun diye `push`
 * saati dışarıdan alıyor — `Date.now()`'a bağlı bir yığın ya kırılgan ya
 * da yavaş test üretirdi.
 */
import type { Root } from "@kalem-editor/core";
import { parse } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import type { Caret } from "./block-edit.js";
import { History } from "./history.js";

const belge = (metin: string): Root => parse(`${metin}\n`);
const imlec = (offset: number): Caret => ({ blockIndex: 0, path: [], offset });

/** Belgenin ilk paragrafının metni — iddiaları okunur kılıyor. */
function metin(doc: Root): string {
	const blok = doc.children[0] as { children?: { value?: string }[] } | undefined;
	return blok?.children?.[0]?.value ?? "";
}

describe("temel gezinme", () => {
	it("başlangıçta geri alınacak bir şey yok", () => {
		const g = new History({ doc: belge("a"), caret: null });
		expect(g.canUndo).toBe(false);
		expect(g.canRedo).toBe(false);
		expect(g.undo()).toBeNull();
	});

	it("kayıt sonrası geri alınabiliyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: imlec(1) }, null, null, 1000);
		expect(g.canUndo).toBe(true);
		expect(metin(g.undo()?.doc as Root)).toBe("a");
	});

	it("geri alınan yinelenebiliyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: imlec(1) }, null, null, 1000);
		g.undo();
		expect(metin(g.redo()?.doc as Root)).toBe("ab");
	});

	it("üst üste geri alma başlangıca kadar gidiyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: null }, null, null, 1000);
		g.push({ doc: belge("abc"), caret: null }, null, null, 5000);
		expect(metin(g.undo()?.doc as Root)).toBe("ab");
		expect(metin(g.undo()?.doc as Root)).toBe("a");
		expect(g.undo()).toBeNull();
	});

	/** Geri alıp sonra yazan kullanıcı yeni bir tarih yazmıştır. */
	it("geri alma sonrası yeni kayıt ileri dalı atıyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: null }, null, null, 1000);
		g.undo();
		g.push({ doc: belge("ax"), caret: null }, null, null, 5000);
		expect(g.canRedo).toBe(false);
		expect(metin(g.current.doc)).toBe("ax");
	});
});

describe("gruplama", () => {
	it("aynı blokta hızlı yazma tek kayda toplanıyor", () => {
		const g = new History({ doc: belge("a"), caret: imlec(1) });
		g.push({ doc: belge("ab"), caret: imlec(2) }, null, "type:k1", 1000);
		g.push({ doc: belge("abc"), caret: imlec(3) }, null, "type:k1", 1200);
		g.push({ doc: belge("abcd"), caret: imlec(4) }, null, "type:k1", 1400);
		expect(g.size).toBe(2);
		// Tek Ctrl+Z tüm yazılanı geri almalı.
		expect(metin(g.undo()?.doc as Root)).toBe("a");
	});

	it("ara uzayınca yeni kayıt açılıyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: null }, null, "type:k1", 1000);
		g.push({ doc: belge("abc"), caret: null }, null, "type:k1", 3000);
		expect(g.size).toBe(3);
	});

	it("blok değişince gruplama kırılıyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: null }, null, "type:k1", 1000);
		g.push({ doc: belge("abc"), caret: null }, null, "type:k2", 1100);
		expect(g.size).toBe(3);
	});

	it("yapısal değişiklik hiç gruplanmıyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: null }, null, null, 1000);
		g.push({ doc: belge("abc"), caret: null }, null, null, 1010);
		expect(g.size).toBe(3);
	});

	/** Geri alınan kaydın üstüne yazılırsa o adım geri alınamaz hâle gelir. */
	it("geri alma sonrası gruplama kırılıyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: null }, null, "type:k1", 1000);
		g.undo();
		g.push({ doc: belge("ax"), caret: null }, null, "type:k1", 1100);
		expect(g.size).toBe(2);
	});

	/**
	 * Grup içindeki ilk imleç korunuyor: geri alan kullanıcı yazmaya
	 * **başladığı** yere dönmeli, bıraktığı yere değil.
	 */
	it("gruplamada başlangıç imleci korunuyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: imlec(1) }, null, "type:k1", 1000);
		g.push({ doc: belge("abc"), caret: imlec(2) }, null, "type:k1", 1100);
		expect(g.current.caret).toEqual(imlec(1));
	});
});

describe("sıfırlama", () => {
	it("reset geçmişi tek duruma indiriyor", () => {
		const g = new History({ doc: belge("a"), caret: null });
		g.push({ doc: belge("ab"), caret: null }, null, null, 1000);
		g.reset({ doc: belge("yeni"), caret: null });
		expect(g.size).toBe(1);
		expect(g.canUndo).toBe(false);
		expect(metin(g.current.doc)).toBe("yeni");
	});
});

describe("üst sınır", () => {
	it("yığın sınırsız büyümüyor", () => {
		const g = new History({ doc: belge("0"), caret: null });
		for (let i = 1; i <= 250; i++) {
			g.push({ doc: belge(String(i)), caret: null }, null, null, i * 10_000);
		}
		expect(g.size).toBeLessThanOrEqual(200);
		expect(metin(g.current.doc)).toBe("250");
	});
});
