/**
 * DOM → satır içi AST testleri  (İş listesi: F2-05, F2-07)
 *
 * ## Neden sahte DOM
 *
 * `readInline` gerçek bir `Element`'in yalnızca dört alanına dokunuyor:
 * `nodeType`, `nodeName`, `childNodes`, `nodeValue`/`textContent` ve
 * `getAttribute`. Bu yüzden jsdom'a gerek yok — düz nesnelerle beslenebilir.
 * Aynı seçim `@kalem-editor/core/html`'de de yapılmıştı (F1-09) ve orada işe
 * yaramıştı: testler hızlı, bağımlılık sıfır.
 *
 * Asıl davranış (tarayıcının gerçekten ne ürettiği) `e2e/editor.spec.ts`'te
 * ölçülüyor; buradaki testler normalleştirme mantığını sabitliyor.
 */
import { describe, expect, it } from "vitest";
import { readCode, readInline } from "./read.js";

function metin(value: string): Node {
	return { nodeType: 3, nodeName: "#text", nodeValue: value, childNodes: [] } as unknown as Node;
}

function el(name: string, children: Node[] = [], attrs: Record<string, string> = {}): Element {
	const node = {
		nodeType: 1,
		nodeName: name,
		nodeValue: null,
		childNodes: children,
		textContent: children.map(duzMetin).join(""),
		getAttribute: (adi: string) => attrs[adi] ?? null,
	};
	return node as unknown as Element;
}

function duzMetin(node: Node): string {
	if (node.nodeType === 3) return node.nodeValue ?? "";
	return Array.from(node.childNodes).map(duzMetin).join("");
}

const NBSP = String.fromCharCode(0xa0);

describe("temel dönüşüm", () => {
	it("düz metin", () => {
		expect(readInline(el("P", [metin("merhaba")]))).toEqual([{ type: "text", value: "merhaba" }]);
	});

	it("boş eleman boş dizi", () => {
		expect(readInline(el("P", []))).toEqual([]);
	});

	it("biçim etiketleri", () => {
		const p = el("P", [
			el("STRONG", [metin("a")]),
			el("EM", [metin("b")]),
			el("DEL", [metin("c")]),
		]);
		expect(readInline(p)).toEqual([
			{ type: "strong", children: [{ type: "text", value: "a" }] },
			{ type: "emphasis", children: [{ type: "text", value: "b" }] },
			{ type: "delete", children: [{ type: "text", value: "c" }] },
		]);
	});

	it("tarayıcının eski etiketleri de tanınıyor", () => {
		// `document.execCommand` ve bazı yapıştırma kaynakları hâlâ bunları üretir.
		const p = el("P", [el("B", [metin("a")]), el("I", [metin("b")]), el("S", [metin("c")])]);
		expect(readInline(p).map((n) => n.type)).toEqual(["strong", "emphasis", "delete"]);
	});

	it("kod span metin olarak okunuyor", () => {
		const p = el("P", [el("CODE", [metin("x = 1")])]);
		expect(readInline(p)).toEqual([{ type: "inlineCode", value: "x = 1" }]);
	});

	it("bağlantı", () => {
		const p = el("P", [el("A", [metin("bağ")], { href: "/y", title: "b" })]);
		expect(readInline(p)).toEqual([
			{ type: "link", url: "/y", title: "b", children: [{ type: "text", value: "bağ" }] },
		]);
	});

	it("görsel", () => {
		const p = el("P", [el("IMG", [], { src: "/r.png", alt: "kedi" })]);
		expect(readInline(p)).toEqual([{ type: "image", url: "/r.png", alt: "kedi", title: null }]);
	});

	it("satır sonu", () => {
		const p = el("P", [metin("a"), el("BR"), metin("b")]);
		expect(readInline(p)).toEqual([
			{ type: "text", value: "a" },
			{ type: "break" },
			{ type: "text", value: "b" },
		]);
	});
});

describe("tarayıcı artıkları", () => {
	/** Boş satırın yüksekliğini korumak için tarayıcının koyduğu doldurucu. */
	it("sondaki `<br>` atılıyor", () => {
		expect(readInline(el("P", [metin("a"), el("BR")]))).toEqual([{ type: "text", value: "a" }]);
	});

	it("yalnızca `<br>` içeren blok boş sayılıyor", () => {
		expect(readInline(el("P", [el("BR")]))).toEqual([]);
	});

	it("bölünmüş metin düğümleri birleşiyor", () => {
		expect(readInline(el("P", [metin("Işı"), metin("ldı")]))).toEqual([
			{ type: "text", value: "Işıldı" },
		]);
	});

	/** Art arda boşluk yazınca tarayıcı ikincisini `&nbsp;` yapar. */
	it("bölünmez boşluk sıradan boşluğa dönüyor", () => {
		expect(readInline(el("P", [metin(`a${NBSP}b`)]))).toEqual([{ type: "text", value: "a b" }]);
	});

	/** Ctrl+B'yi zaten kalın bir metne uygulamanın doğal sonucu. */
	it("iç içe aynı biçim düzleşiyor", () => {
		const p = el("P", [el("B", [metin("a"), el("STRONG", [metin("b")])])]);
		expect(readInline(p)).toEqual([{ type: "strong", children: [{ type: "text", value: "ab" }] }]);
	});

	it("farklı biçimlerin iç içesi korunuyor", () => {
		const p = el("P", [el("STRONG", [el("EM", [metin("a")])])]);
		expect(readInline(p)).toEqual([
			{
				type: "strong",
				children: [{ type: "emphasis", children: [{ type: "text", value: "a" }] }],
			},
		]);
	});

	it("boş biçim etiketi atılıyor", () => {
		expect(readInline(el("P", [el("STRONG", []), metin("a")]))).toEqual([
			{ type: "text", value: "a" },
		]);
	});

	it("bilinmeyen etiket şeffaf: içeriği korunuyor", () => {
		const p = el("P", [el("SPAN", [metin("a")], { style: "color:red" })]);
		expect(readInline(p)).toEqual([{ type: "text", value: "a" }]);
	});

	it("`href`siz bağlantı metne düşüyor", () => {
		expect(readInline(el("P", [el("A", [metin("a")])]))).toEqual([{ type: "text", value: "a" }]);
	});

	it("`src`siz görsel atılıyor", () => {
		expect(readInline(el("P", [el("IMG"), metin("a")]))).toEqual([{ type: "text", value: "a" }]);
	});

	it("görev kutusu içeriğe karışmıyor", () => {
		const li = el("LI", [el("INPUT", [], { type: "checkbox" }), metin(" görev")]);
		expect(readInline(li)).toEqual([{ type: "text", value: " görev" }]);
	});
});

describe("kod okuma", () => {
	it("metni olduğu gibi veriyor", () => {
		expect(readCode(el("CODE", [metin("const a = 1;")]))).toBe("const a = 1;");
	});

	it("`<br>` satır sonuna çevriliyor", () => {
		// Tarayıcı `<pre>` içinde Enter'a basınca `<br>` üretebilir.
		expect(readCode(el("CODE", [metin("a"), el("BR"), metin("b")]))).toBe("a\nb");
	});

	it("sondaki tek satır sonu atılıyor", () => {
		expect(readCode(el("CODE", [metin("a\n")]))).toBe("a");
	});
});
