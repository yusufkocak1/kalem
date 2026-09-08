import { describe, expect, it } from "vitest";
import type { Node, Root } from "./ast.js";
import { clone, insertAt, remove, removeAt, replace, replaceAt } from "./edit.js";
import { baslik, ornekBelge, paragraf } from "./fixtures.test-helper.js";
import { nodeAtPath } from "./path.js";

describe("clone", () => {
	it("derin kopya üretiyor", () => {
		const belge = ornekBelge();
		const kopya = clone(belge);

		expect(kopya).toEqual(belge);
		expect(kopya).not.toBe(belge);
		expect(kopya.children[0]).not.toBe(belge.children[0]);
		expect(nodeAtPath(kopya, [0, 0])).not.toBe(nodeAtPath(belge, [0, 0]));
	});

	it("kopyayı değiştirmek aslını etkilemiyor", () => {
		const belge = ornekBelge();
		const kopya = clone(belge);
		const metin = nodeAtPath(kopya, [0, 0]) as { value: string };
		metin.value = "değişti";
		expect((nodeAtPath(belge, [0, 0]) as { value: string }).value).toBe("Işıklı Başlık");
	});

	it("iç içe nesneleri (syntax) da kopyalıyor", () => {
		const belge = ornekBelge();
		const kopya = clone(belge);
		const asilBaslik = belge.children[0] as { syntax?: object };
		const kopyaBaslik = kopya.children[0] as { syntax?: object };
		expect(kopyaBaslik.syntax).toEqual(asilBaslik.syntax);
		expect(kopyaBaslik.syntax).not.toBe(asilBaslik.syntax);
	});

	it("dizileri kopyalıyor", () => {
		const tablo: Node = { type: "table", align: ["left", null, "center"], children: [] };
		const kopya = clone(tablo);
		expect(kopya).toEqual(tablo);
		expect((kopya as { align: unknown[] }).align).not.toBe((tablo as { align: unknown[] }).align);
	});

	it("varsayılan olarak position ve id'yi koruyor", () => {
		const dugum: Node = {
			type: "text",
			value: "a",
			id: "abc",
			position: {
				start: { line: 1, column: 1, offset: 0 },
				end: { line: 1, column: 2, offset: 1 },
			},
		};
		const kopya = clone(dugum);
		expect(kopya.id).toBe("abc");
		expect(kopya.position).toEqual(dugum.position);
		expect(kopya.position).not.toBe(dugum.position);
	});

	/**
	 * Alt ağacı başka bir yere takarken konum bayat, kimlik ise çakışır.
	 * İkisini de bırakabilmek bu yüzden seçenek.
	 */
	it("position ve id bırakılabiliyor", () => {
		const belge: Root = {
			type: "root",
			id: "kok",
			position: {
				start: { line: 1, column: 1, offset: 0 },
				end: { line: 2, column: 1, offset: 5 },
			},
			children: [
				{
					type: "paragraph",
					id: "p-1",
					children: [{ type: "text", value: "a", id: "metin-1" }],
				},
			],
		};
		const kopya = clone(belge, { position: false, id: false });

		expect(kopya.id).toBeUndefined();
		expect(kopya.position).toBeUndefined();
		// Derinlemesine bırakılmalı — yalnızca kökte değil.
		expect(kopya.children[0]?.id).toBeUndefined();
		expect(kopya).toEqual({
			type: "root",
			children: [{ type: "paragraph", children: [{ type: "text", value: "a" }] }],
		});
	});

	it("data alanını derin kopyalıyor", () => {
		const dugum: Node = { type: "text", value: "a", data: { ic: { derin: [1, 2] } } };
		const kopya = clone(dugum);
		expect(kopya.data).toEqual(dugum.data);
		expect(kopya.data?.ic).not.toBe(dugum.data?.ic);
	});
});

describe("insertAt", () => {
	it("araya ekliyor, sonrakiler sağa kayıyor", () => {
		const belge = ornekBelge();
		const yeni = insertAt(belge, [1], baslik(2, "Araya girdi"));

		expect(yeni.children.map((c) => c.type)).toEqual(["heading", "heading", "paragraph", "list"]);
		expect(nodeAtPath(yeni, [1, 0])).toEqual({ type: "text", value: "Araya girdi" });
	});

	it("başa ekliyor", () => {
		const yeni = insertAt(ornekBelge(), [0], paragraf("ilk"));
		expect(yeni.children[0]?.type).toBe("paragraph");
		expect(yeni.children).toHaveLength(4);
	});

	it("dizinin sonuna ekliyor", () => {
		const belge = ornekBelge();
		const yeni = insertAt(belge, [belge.children.length], paragraf("son"));
		expect(yeni.children).toHaveLength(4);
		expect(nodeAtPath(yeni, [3, 0])).toEqual({ type: "text", value: "son" });
	});

	it("derine ekliyor", () => {
		const yeni = insertAt(ornekBelge(), [2, 1], {
			type: "listItem",
			checked: null,
			spread: false,
			children: [paragraf("araya madde")],
		});
		expect(nodeAtPath(yeni, [2])).toMatchObject({ type: "list" });
		expect((nodeAtPath(yeni, [2]) as { children: unknown[] }).children).toHaveLength(3);
		expect(nodeAtPath(yeni, [2, 1, 0, 0])).toEqual({ type: "text", value: "araya madde" });
	});

	it("aralık dışı konumda anlaşılır hata veriyor", () => {
		expect(() => insertAt(ornekBelge(), [99], paragraf("x"))).toThrow(/aralık dışı/);
		expect(() => insertAt(ornekBelge(), [-1], paragraf("x"))).toThrow(/aralık dışı/);
	});

	it("boş yolda hata veriyor", () => {
		expect(() => insertAt(ornekBelge(), [], paragraf("x"))).toThrow(/kökün ebeveyni yoktur/);
	});
});

describe("replaceAt", () => {
	it("düğümü değiştiriyor", () => {
		const yeni = replaceAt(ornekBelge(), [1], baslik(3, "Yerine geçti"));
		expect(yeni.children[1]?.type).toBe("heading");
		expect(yeni.children).toHaveLength(3);
	});

	it("derindeki düğümü değiştiriyor", () => {
		const yeni = replaceAt(ornekBelge(), [2, 0, 0, 0], { type: "text", value: "yeni metin" });
		expect(nodeAtPath(yeni, [2, 0, 0, 0])).toEqual({ type: "text", value: "yeni metin" });
		// Kardeş madde etkilenmedi.
		expect(nodeAtPath(yeni, [2, 1, 0, 0])).toEqual({ type: "text", value: "ikinci madde" });
	});

	it("olmayan çocukta anlaşılır hata veriyor", () => {
		expect(() => replaceAt(ornekBelge(), [99], paragraf("x"))).toThrow(/çocuk yok/);
	});

	it("yaprak düğümün içine inmeye çalışınca anlaşılır hata veriyor", () => {
		expect(() => replaceAt(ornekBelge(), [0, 0, 0], paragraf("x"))).toThrow(/çocuğu yok/);
	});

	it("ara seviyede olmayan çocuğu anlaşılır bildiriyor", () => {
		// [99, 0]: kökte 99. çocuk yok — hata hedefe inmeden, ara seviyede çıkmalı.
		expect(() => replaceAt(ornekBelge(), [99, 0], paragraf("x"))).toThrow(
			/0\. seviyede 99\. çocuk yok/,
		);
	});

	/**
	 * Yol dizisinde delik olması bir programlama hatasıdır; sessizce yanlış
	 * yere yazmaktansa anlaşılır bir istisna daha iyidir.
	 */
	it("delikli yolda anlaşılır hata veriyor", () => {
		const delikli = [0, undefined, 0] as unknown as number[];
		expect(() => replaceAt(ornekBelge(), delikli, paragraf("x"))).toThrow(/indis yok/);
	});
});

describe("removeAt", () => {
	it("düğümü siliyor, sonrakiler sola kayıyor", () => {
		const yeni = removeAt(ornekBelge(), [1]);
		expect(yeni.children.map((c) => c.type)).toEqual(["heading", "list"]);
	});

	it("derindeki düğümü siliyor", () => {
		const yeni = removeAt(ornekBelge(), [2, 0]);
		expect((nodeAtPath(yeni, [2]) as { children: unknown[] }).children).toHaveLength(1);
		expect(nodeAtPath(yeni, [2, 0, 0, 0])).toEqual({ type: "text", value: "ikinci madde" });
	});

	it("olmayan çocukta anlaşılır hata veriyor", () => {
		expect(() => removeAt(ornekBelge(), [7])).toThrow(/çocuk yok/);
	});

	it("boş yolda hata veriyor", () => {
		expect(() => removeAt(ornekBelge(), [])).toThrow(/kökün ebeveyni yoktur/);
	});
});

/**
 * Değişmezlik ve yapısal paylaşım — F2-09'daki geri al/ileri al ve F2'deki
 * render karşılaştırması bu iki garantiye dayanacak.
 */
describe("değişmezlik ve yapısal paylaşım", () => {
	it("girdi ağacı değişmiyor", () => {
		const belge = ornekBelge();
		// Bağımsız anlık görüntü: `clone` ile alsaydık test kendi test ettiği
		// koda dayanırdı. (`structuredClone` yok — core'un lib'inde DOM/Node
		// globalleri bilinçli olarak kapalı.)
		const oncesi: Root = JSON.parse(JSON.stringify(belge));

		insertAt(belge, [0], paragraf("a"));
		replaceAt(belge, [1], paragraf("b"));
		removeAt(belge, [2]);

		expect(belge).toEqual(oncesi);
	});

	it("yalnızca yol üzerindeki atalar kopyalanıyor", () => {
		const belge = ornekBelge();
		const yeni = replaceAt(belge, [2, 0, 0, 0], { type: "text", value: "değişti" });

		// Kök ve yol üzerindeki atalar yeni nesne.
		expect(yeni).not.toBe(belge);
		expect(nodeAtPath(yeni, [2])).not.toBe(nodeAtPath(belge, [2]));
		expect(nodeAtPath(yeni, [2, 0])).not.toBe(nodeAtPath(belge, [2, 0]));

		// Yol dışındaki kardeşler PAYLAŞILIYOR — referans aynı.
		expect(yeni.children[0]).toBe(belge.children[0]);
		expect(yeni.children[1]).toBe(belge.children[1]);
		expect(nodeAtPath(yeni, [2, 1])).toBe(nodeAtPath(belge, [2, 1]));
	});

	it("değişmemiş alt ağaç tek karşılaştırmayla anlaşılıyor", () => {
		const belge = ornekBelge();
		const yeni = removeAt(belge, [0]);
		// Editör "liste değişmedi" sonucunu derin gezinmeden çıkarabilmeli.
		expect(yeni.children[1]).toBe(belge.children[2]);
	});
});

describe("replace / remove (referansla)", () => {
	it("replace düğümü bulup değiştiriyor", () => {
		const belge = ornekBelge();
		const hedef = nodeAtPath(belge, [1]) as Node;
		const yeni = replace(belge, hedef, baslik(4, "yerine"));
		expect(yeni.children[1]).toEqual(baslik(4, "yerine"));
	});

	it("remove düğümü bulup siliyor", () => {
		const belge = ornekBelge();
		const hedef = nodeAtPath(belge, [2, 1]) as Node;
		const yeni = remove(belge, hedef);
		expect((nodeAtPath(yeni, [2]) as { children: unknown[] }).children).toHaveLength(1);
	});

	it("ağaçta olmayan düğümde anlaşılır hata veriyor", () => {
		expect(() => replace(ornekBelge(), paragraf("yok"), paragraf("x"))).toThrow(/bulunamadı/);
		expect(() => remove(ornekBelge(), paragraf("yok"))).toThrow(/bulunamadı/);
	});

	it("kökün kendisini silmeye çalışınca hata veriyor", () => {
		const belge = ornekBelge();
		expect(() => remove(belge, belge)).toThrow(/kökün ebeveyni yoktur/);
	});
});
