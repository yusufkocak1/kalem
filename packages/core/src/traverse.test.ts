import { describe, expect, it } from "vitest";
import type { Heading, Node, Root } from "./ast.js";
import { ornekBelge } from "./fixtures.test-helper.js";
import { EXIT, find, SKIP, visit, walk } from "./traverse.js";

/** Ziyaret sırasını okunur bir listeye çevirir. */
function siraylaTipler(tree: Node): string[] {
	const out: string[] = [];
	walk(tree, (node) => {
		out.push(node.type);
		return undefined;
	});
	return out;
}

describe("walk", () => {
	const belge = ornekBelge();

	it("her düğümü belge sırasıyla ziyaret ediyor", () => {
		expect(siraylaTipler(belge)).toEqual([
			"root",
			"heading",
			"text",
			"paragraph",
			"text",
			"list",
			"listItem",
			"paragraph",
			"text",
			"listItem",
			"paragraph",
			"text",
		]);
	});

	it("her düğümün yolunu doğru veriyor", () => {
		const yollar: number[][] = [];
		walk(belge, (_node, ctx) => {
			yollar.push([...ctx.path]);
			return undefined;
		});
		expect(yollar.slice(0, 6)).toEqual([[], [0], [0, 0], [1], [1, 0], [2]]);
	});

	it("ebeveyn ve indis bağlamını veriyor", () => {
		walk(belge, (node, ctx) => {
			if (node.type === "list") {
				expect(ctx.parent).toBe(belge);
				expect(ctx.index).toBe(2);
				return EXIT;
			}
			return undefined;
		});
	});

	it("kökün ebeveyni ve indisi undefined", () => {
		walk(belge, (_node, ctx) => {
			expect(ctx.parent).toBeUndefined();
			expect(ctx.index).toBeUndefined();
			expect(ctx.path).toEqual([]);
			return EXIT;
		});
	});

	it("SKIP çocuklara inmiyor ama kardeşlerden devam ediyor", () => {
		const tipler: string[] = [];
		walk(belge, (node) => {
			tipler.push(node.type);
			return node.type === "list" ? SKIP : undefined;
		});
		// Listenin içi atlandı, ama liste ve öncesi ziyaret edildi.
		expect(tipler).toEqual(["root", "heading", "text", "paragraph", "text", "list"]);
	});

	it("EXIT gezinmeyi tamamen bitiriyor", () => {
		const tipler: string[] = [];
		walk(belge, (node) => {
			tipler.push(node.type);
			return node.type === "paragraph" ? EXIT : undefined;
		});
		expect(tipler).toEqual(["root", "heading", "text", "paragraph"]);
	});

	it("yaprak düğümde de çalışıyor", () => {
		expect(siraylaTipler({ type: "text", value: "a" })).toEqual(["text"]);
	});

	/**
	 * Ziyaretçi `path`'i saklayabilmeli — her düğüm için yeni dizi üretiliyor.
	 * Paylaşılan bir dizi kullanılsaydı bütün kayıtlar aynı son yolu gösterirdi.
	 */
	it("saklanan yollar sonradan bozulmuyor", () => {
		const saklanan: (readonly number[])[] = [];
		walk(belge, (_node, ctx) => {
			saklanan.push(ctx.path);
			return undefined;
		});
		expect(saklanan[1]).toEqual([0]);
		expect(saklanan[2]).toEqual([0, 0]);
		expect(saklanan[5]).toEqual([2]);
	});

	/**
	 * Künyeye göre çocuklu görünen ama `children` alanı bozuk gelen düğüm
	 * gezinmeyi patlatmamalı — `isParent` bunu kesiyor.
	 */
	it("bozuk children alanında patlamıyor", () => {
		const bozuk = { type: "root", children: null } as unknown as Root;
		expect(() => siraylaTipler(bozuk)).not.toThrow();
		expect(siraylaTipler(bozuk)).toEqual(["root"]);
	});
});

describe("visit", () => {
	const belge = ornekBelge();

	it("tek tipi süzüyor", () => {
		const bulunan: string[] = [];
		visit(belge, "text", (node) => {
			bulunan.push(node.value);
			return undefined;
		});
		expect(bulunan).toEqual(["Işıklı Başlık", "Bir paragraf.", "ilk madde", "ikinci madde"]);
	});

	it("birden çok tipi süzüyor", () => {
		const tipler: string[] = [];
		visit(belge, ["heading", "list"], (node) => {
			tipler.push(node.type);
			return undefined;
		});
		expect(tipler).toEqual(["heading", "list"]);
	});

	it("süzülen tipi daraltıyor", () => {
		visit(belge, "heading", (node) => {
			// Daraltma çalışmasaydı `depth` derleme hatası verirdi.
			const h: Heading = node;
			expect(h.depth).toBe(1);
			return undefined;
		});
	});

	it("eşleşmeyen düğümlerin çocuklarına inmeye devam ediyor", () => {
		// Metinler listenin ve maddenin içinde; süzgeç onları atlamamalı.
		let sayi = 0;
		visit(belge, "text", () => {
			sayi++;
			return undefined;
		});
		expect(sayi).toBe(4);
	});

	it("eşleşme yoksa hiç çağrılmıyor", () => {
		let sayi = 0;
		visit(belge, "table", () => {
			sayi++;
			return undefined;
		});
		expect(sayi).toBe(0);
	});

	it("EXIT süzülmüş gezinmeyi de bitiriyor", () => {
		const bulunan: string[] = [];
		visit(belge, "text", (node) => {
			bulunan.push(node.value);
			return EXIT;
		});
		expect(bulunan).toEqual(["Işıklı Başlık"]);
	});
});

describe("find", () => {
	const belge = ornekBelge();

	it("koşulu sağlayan ilk düğümü veriyor", () => {
		const bulunan = find(belge, (node) => node.type === "text");
		expect(bulunan).toEqual({ type: "text", value: "Işıklı Başlık" });
	});

	it("bağlamı da koşula veriyor", () => {
		const bulunan = find(belge, (_node, ctx) => ctx.path.length === 4);
		expect(bulunan).toEqual({ type: "text", value: "ilk madde" });
	});

	it("eşleşme yoksa undefined", () => {
		expect(find(belge, (node) => node.type === "table")).toBeUndefined();
	});

	it("ilk eşleşmede duruyor", () => {
		let ziyaret = 0;
		find(belge, (node) => {
			ziyaret++;
			return node.type === "heading";
		});
		expect(ziyaret).toBe(2); // root, heading
	});
});
