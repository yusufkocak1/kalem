import { describe, expect, it } from "vitest";
import type { Node } from "./ast.js";
import { ornekBelge, paragraf } from "./fixtures.test-helper.js";
import { nodeAtPath, parentAtPath, parentPath, pathEquals, pathToNode } from "./path.js";

describe("nodeAtPath", () => {
	const belge = ornekBelge();

	it("boş yol kökü veriyor", () => {
		expect(nodeAtPath(belge, [])).toBe(belge);
	});

	it("tek seviyeli yolu çözüyor", () => {
		expect(nodeAtPath(belge, [0])?.type).toBe("heading");
		expect(nodeAtPath(belge, [1])?.type).toBe("paragraph");
		expect(nodeAtPath(belge, [2])?.type).toBe("list");
	});

	it("derin yolu çözüyor", () => {
		const dugum = nodeAtPath(belge, [2, 0, 0, 0]);
		expect(dugum).toEqual({ type: "text", value: "ilk madde" });
	});

	it("aralık dışı indiste undefined", () => {
		expect(nodeAtPath(belge, [99])).toBeUndefined();
		expect(nodeAtPath(belge, [2, 5])).toBeUndefined();
		expect(nodeAtPath(belge, [-1])).toBeUndefined();
	});

	it("yaprak düğümün içine inmeye çalışınca undefined", () => {
		// [0, 0] metin düğümü; onun çocuğu yok.
		expect(nodeAtPath(belge, [0, 0, 0])).toBeUndefined();
	});
});

describe("pathToNode", () => {
	const belge = ornekBelge();

	it("kökün yolu boş dizi", () => {
		expect(pathToNode(belge, belge)).toEqual([]);
	});

	it("düğümün yolunu buluyor", () => {
		const liste = nodeAtPath(belge, [2]) as Node;
		expect(pathToNode(belge, liste)).toEqual([2]);
	});

	it("derindeki düğümün yolunu buluyor", () => {
		const hedef = nodeAtPath(belge, [2, 1, 0, 0]) as Node;
		expect(pathToNode(belge, hedef)).toEqual([2, 1, 0, 0]);
	});

	it("ağaçta olmayan düğüm için undefined", () => {
		expect(pathToNode(belge, paragraf("yabancı"))).toBeUndefined();
	});

	/**
	 * Karşılaştırma referans kimliğiyle yapılır. Aynı içerikli iki paragraf
	 * farklı düğümlerdir — editörde ayrı ayrı yaşarlar, biri silinince
	 * diğeri kalmalıdır.
	 */
	it("derin eşitlikle değil, referansla arıyor", () => {
		const ikiz = { type: "text" as const, value: "ilk madde" };
		expect(pathToNode(belge, ikiz)).toBeUndefined();
	});

	it("belge sırasındaki ilk eşleşmeyi veriyor", () => {
		const ortak = paragraf("aynı düğüm");
		const agac: Node = {
			type: "root",
			children: [
				{ type: "blockquote", children: [ortak] },
				{ type: "blockquote", children: [ortak] },
			],
		};
		expect(pathToNode(agac, ortak)).toEqual([0, 0]);
	});
});

describe("parentPath", () => {
	it("son indisi atıyor", () => {
		expect(parentPath([2, 1, 0])).toEqual([2, 1]);
		expect(parentPath([0])).toEqual([]);
	});

	it("kök için undefined", () => {
		expect(parentPath([])).toBeUndefined();
	});
});

describe("parentAtPath", () => {
	const belge = ornekBelge();

	it("ebeveyn düğümü veriyor", () => {
		expect(parentAtPath(belge, [2, 0])?.type).toBe("list");
		expect(parentAtPath(belge, [0])).toBe(belge);
	});

	it("kök için undefined", () => {
		expect(parentAtPath(belge, [])).toBeUndefined();
	});

	it("geçersiz yol için undefined", () => {
		expect(parentAtPath(belge, [99, 0])).toBeUndefined();
	});
});

describe("pathEquals", () => {
	it("aynı yollar için true", () => {
		expect(pathEquals([1, 2, 3], [1, 2, 3])).toBe(true);
		expect(pathEquals([], [])).toBe(true);
	});

	it("farklı yollar için false", () => {
		expect(pathEquals([1, 2], [1, 2, 3])).toBe(false);
		expect(pathEquals([1, 2, 3], [1, 2, 4])).toBe(false);
		expect(pathEquals([], [0])).toBe(false);
	});
});
