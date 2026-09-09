/**
 * Seçim modelinin saf kısımları  (İş listesi: F2-06)
 *
 * DOM'a dokunan kısım (`readSelection`, `placeCaret`, sürükleyerek blok
 * seçimi) gerçek tarayıcıda ölçülüyor — `e2e/editor.spec.ts`. Burada
 * yalnızca yön normalleştirmesi ve karşılaştırma var; ikisi de saf, ikisi
 * de yanlış olduğunda sessizce yanlış olur.
 */
import { describe, expect, it } from "vitest";
import type { BlockSelection, EditorSelection } from "./selection.js";
import { sameSelection, selectedRange } from "./selection.js";

const SIRA = ["a", "b", "c", "d"];
const blok = (anchor: string, focus: string): BlockSelection => ({
	kind: "block",
	anchor,
	focus,
});

describe("selectedRange", () => {
	it("aşağı doğru seçim", () => {
		expect(selectedRange(blok("a", "c"), SIRA)).toEqual(["a", "b", "c"]);
	});

	/** Yukarı doğru sürüklemek de aynı aralığı vermeli. */
	it("yukarı doğru seçim aynı aralığı veriyor", () => {
		expect(selectedRange(blok("c", "a"), SIRA)).toEqual(["a", "b", "c"]);
	});

	it("tek blok", () => {
		expect(selectedRange(blok("b", "b"), SIRA)).toEqual(["b"]);
	});

	it("tüm belge", () => {
		expect(selectedRange(blok("a", "d"), SIRA)).toEqual(SIRA);
	});

	/**
	 * Silme sırasında seçili bloklar modelden çıkar ama seçim nesnesi bir
	 * an için elde kalabilir; boş aralık dönmek çökmekten iyi.
	 */
	it("artık var olmayan blok boş aralık veriyor", () => {
		expect(selectedRange(blok("a", "yok"), SIRA)).toEqual([]);
		expect(selectedRange(blok("yok", "a"), SIRA)).toEqual([]);
	});

	it("boş sırada boş aralık", () => {
		expect(selectedRange(blok("a", "b"), [])).toEqual([]);
	});
});

describe("sameSelection", () => {
	const metin = (blockId: string, collapsed: boolean): EditorSelection => ({
		kind: "text",
		blockId,
		collapsed,
	});

	it("iki null aynı", () => {
		expect(sameSelection(null, null)).toBe(true);
	});

	it("null ile seçim farklı", () => {
		expect(sameSelection(null, metin("a", true))).toBe(false);
		expect(sameSelection(metin("a", true), null)).toBe(false);
	});

	it("farklı tür farklı", () => {
		expect(sameSelection(metin("a", false), blok("a", "b"))).toBe(false);
	});

	it("aynı metin seçimi aynı", () => {
		expect(sameSelection(metin("a", true), metin("a", true))).toBe(true);
	});

	/** İmleç ile seçili metin ayrı durumlar: araç çubuğu buna bakacak (F3-01). */
	it("daralmışlık farkı fark sayılıyor", () => {
		expect(sameSelection(metin("a", true), metin("a", false))).toBe(false);
	});

	it("aynı blok seçimi aynı", () => {
		expect(sameSelection(blok("a", "c"), blok("a", "c"))).toBe(true);
	});

	/** Yön korunuyor: Shift+Ok ile genişletme hangi uçtan büyüyeceğini bilmeli. */
	it("ters yön farklı sayılıyor", () => {
		expect(sameSelection(blok("a", "c"), blok("c", "a"))).toBe(false);
	});
});
