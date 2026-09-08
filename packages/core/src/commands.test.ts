import { describe, expect, it } from "vitest";
import type { Inline, Root } from "./ast.js";
import {
	emptyDocument,
	emptyList,
	emptyParagraph,
	hasMark,
	insertNode,
	joinBlocks,
	lift,
	setBlockType,
	splitBlock,
	toggleMark,
	wrapIn,
} from "./commands.js";
import { nodeAtPath } from "./path.js";
import { serialize } from "./serialize.js";

const metin = (value: string): Inline => ({ type: "text", value });

/** Komut sonucunu Markdown olarak okumak, ağaç karşılaştırmaktan okunurdur. */
const md = (tree: Root) => serialize(tree).replace(/\n$/, "");

const belge = (): Root => ({
	type: "root",
	children: [
		{ type: "paragraph", children: [metin("bir")] },
		{ type: "paragraph", children: [metin("iki")] },
		{ type: "heading", depth: 2, children: [metin("başlık")] },
	],
});

// ---------------------------------------------------------------------------

describe("toggleMark", () => {
	it("biçim uyguluyor", () => {
		expect(toggleMark([metin("a")], "strong")).toEqual([
			{ type: "strong", children: [{ type: "text", value: "a" }] },
		]);
	});

	/** Word'ün kalın düğmesi gibi: tamamı kalınsa tıklamak kaldırır. */
	it("tamamı işaretliyse kaldırıyor", () => {
		const kalin: Inline[] = [{ type: "strong", children: [metin("a")] }];
		expect(toggleMark(kalin, "strong")).toEqual([{ type: "text", value: "a" }]);
	});

	it("kısmen işaretliyse tamamına uyguluyor", () => {
		const karisik: Inline[] = [{ type: "strong", children: [metin("a")] }, metin("b")];
		const sonuc = toggleMark(karisik, "strong");
		expect(sonuc).toHaveLength(1);
		expect(sonuc[0]?.type).toBe("strong");
	});

	it("boş listede boş dönüyor", () => {
		expect(toggleMark([], "emphasis")).toEqual([]);
	});

	/** `inlineCode` çocuk taşımaz; içerik düz metne iner. */
	it("kod biçimi içeriği düzleştiriyor", () => {
		const zengin: Inline[] = [{ type: "strong", children: [metin("a")] }, metin("b")];
		expect(toggleMark(zengin, "inlineCode")).toEqual([{ type: "inlineCode", value: "ab" }]);
	});

	it("üstü çizili ve italik", () => {
		expect(toggleMark([metin("a")], "delete")[0]?.type).toBe("delete");
		expect(toggleMark([metin("a")], "emphasis")[0]?.type).toBe("emphasis");
	});

	it("hasMark durumu doğru okuyor", () => {
		expect(hasMark([{ type: "strong", children: [metin("a")] }], "strong")).toBe(true);
		expect(hasMark([metin("a")], "strong")).toBe(false);
		expect(hasMark([], "strong")).toBe(false);
	});
});

// ---------------------------------------------------------------------------

describe("setBlockType", () => {
	it("paragrafı başlığa çeviriyor, metni koruyor", () => {
		expect(md(setBlockType(belge(), [0], { type: "heading", depth: 3 }))).toContain("### bir");
	});

	it("başlığı paragrafa çeviriyor", () => {
		const sonuc = setBlockType(belge(), [2], { type: "paragraph" });
		expect(nodeAtPath(sonuc, [2])?.type).toBe("paragraph");
		expect(md(sonuc)).toContain("başlık");
	});

	it("paragrafı kod bloğuna çeviriyor", () => {
		const sonuc = setBlockType(belge(), [0], { type: "code", lang: "ts" });
		expect(md(sonuc)).toContain("```ts\nbir\n```");
	});

	/** Kod biçim taşıyamaz: satır içi biçimler düz metne iner. */
	it("kod bloğuna çevirirken biçimler düzleşiyor", () => {
		const kok: Root = {
			type: "root",
			children: [{ type: "paragraph", children: [{ type: "strong", children: [metin("a")] }] }],
		};
		expect(md(setBlockType(kok, [0], { type: "code" }))).toBe("```\na\n```");
	});

	it("kod bloğunu paragrafa çevirirken metni koruyor", () => {
		const kok: Root = {
			type: "root",
			children: [{ type: "code", lang: null, meta: null, value: "kod\n" }],
		};
		expect(md(setBlockType(kok, [0], { type: "paragraph" }))).toBe("kod");
	});

	/** Alıntı bir kapsayıcı: içerik düzleştirilmez, sarılır. */
	it("alıntıya çevirmek sarmalıyor", () => {
		expect(md(setBlockType(belge(), [0], { type: "blockquote" }))).toContain("> bir");
	});

	it("olmayan yolda anlaşılır hata", () => {
		expect(() => setBlockType(belge(), [9], { type: "paragraph" })).toThrow(/yolunda düğüm yok/);
	});
});

// ---------------------------------------------------------------------------

describe("wrapIn ve lift", () => {
	it("alıntıya sarıyor", () => {
		expect(md(wrapIn(belge(), [0], "blockquote"))).toContain("> bir");
	});

	it("listeye sarıyor", () => {
		expect(md(wrapIn(belge(), [0], "list"))).toContain("- bir");
	});

	it("tek çocuklu kapsayıcıyı kaldırıyor", () => {
		const sarili = wrapIn(belge(), [0], "blockquote");
		expect(md(lift(sarili, [0, 0]))).toBe(md(belge()));
	});

	it("iki çocuklu kapsayıcının ilk çocuğunu dışarı alıyor", () => {
		const kok: Root = {
			type: "root",
			children: [
				{
					type: "blockquote",
					children: [
						{ type: "paragraph", children: [metin("a")] },
						{ type: "paragraph", children: [metin("b")] },
					],
				},
			],
		};
		expect(md(lift(kok, [0, 0]))).toBe("a\n\n> b");
	});

	it("son çocuğu dışarı alıyor", () => {
		const kok: Root = {
			type: "root",
			children: [
				{
					type: "blockquote",
					children: [
						{ type: "paragraph", children: [metin("a")] },
						{ type: "paragraph", children: [metin("b")] },
					],
				},
			],
		};
		expect(md(lift(kok, [0, 1]))).toBe("> a\n\nb");
	});

	it("kök düzeyindeki düğümde hata veriyor", () => {
		expect(() => lift(belge(), [0])).toThrow(/kök düzeyindeki/);
	});

	/** Ortadaki çocuğu çıkarmak kapsayıcıyı bölmeyi gerektirir — v1 dışı. */
	it("ortadaki çocukta anlaşılır sınır bildiriyor", () => {
		const kok: Root = {
			type: "root",
			children: [
				{
					type: "blockquote",
					children: [
						{ type: "paragraph", children: [metin("a")] },
						{ type: "paragraph", children: [metin("b")] },
						{ type: "paragraph", children: [metin("c")] },
					],
				},
			],
		};
		expect(() => lift(kok, [0, 1])).toThrow(/ilk ya da son/);
	});
});

// ---------------------------------------------------------------------------

describe("splitBlock", () => {
	const kok = (): Root => ({
		type: "root",
		children: [{ type: "paragraph", children: [metin("bir"), metin("iki")] }],
	});

	it("çocuk dizisinde bölüyor", () => {
		expect(md(splitBlock(kok(), [0], 1))).toBe("bir\n\niki");
	});

	it("başta bölmek boş blok üretiyor", () => {
		const sonuc = splitBlock(kok(), [0], 0);
		expect((nodeAtPath(sonuc, [0]) as { children: unknown[] }).children).toHaveLength(0);
	});

	it("sonda bölmek boş blok üretiyor", () => {
		const sonuc = splitBlock(kok(), [0], 2);
		expect((nodeAtPath(sonuc, [1]) as { children: unknown[] }).children).toHaveLength(0);
	});

	it("aralık dışı ofset sınıra çekiliyor", () => {
		expect(() => splitBlock(kok(), [0], 99)).not.toThrow();
	});

	it("blok türünü koruyor", () => {
		const h: Root = {
			type: "root",
			children: [{ type: "heading", depth: 2, children: [metin("a"), metin("b")] }],
		};
		const sonuc = splitBlock(h, [0], 1);
		expect(nodeAtPath(sonuc, [0])?.type).toBe("heading");
		expect(nodeAtPath(sonuc, [1])?.type).toBe("heading");
	});

	/** Bölünmüş düğümlerin konumu bayat; taşınmamalı. */
	it("bayat konum bilgisini atıyor", () => {
		const h: Root = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [metin("a"), metin("b")],
					position: {
						start: { line: 1, column: 1, offset: 0 },
						end: { line: 1, column: 3, offset: 2 },
					},
				},
			],
		};
		const sonuc = splitBlock(h, [0], 1);
		expect(nodeAtPath(sonuc, [0])?.position).toBeUndefined();
		expect(nodeAtPath(sonuc, [1])?.position).toBeUndefined();
	});

	it("yaprak düğümde anlaşılır hata", () => {
		const c: Root = {
			type: "root",
			children: [{ type: "code", lang: null, meta: null, value: "x\n" }],
		};
		expect(() => splitBlock(c, [0], 0)).toThrow(/bölünemez/);
	});
});

// ---------------------------------------------------------------------------

describe("joinBlocks", () => {
	it("iki paragrafı birleştiriyor", () => {
		expect(md(joinBlocks(belge(), [1]))).toBe("biriki\n\n## başlık");
	});

	it("birleşme sonucu önceki bloğun türünü alıyor", () => {
		const sonuc = joinBlocks(belge(), [2]);
		expect(nodeAtPath(sonuc, [1])?.type).toBe("paragraph");
		expect(md(sonuc)).toContain("ikibaşlık");
	});

	it("ilk blokta anlaşılır hata", () => {
		expect(() => joinBlocks(belge(), [0])).toThrow(/ilk bloğun/);
	});

	it("yaprak blokta anlaşılır hata", () => {
		const kok: Root = {
			type: "root",
			children: [
				{ type: "paragraph", children: [metin("a")] },
				{ type: "code", lang: null, meta: null, value: "x\n" },
			],
		};
		expect(() => joinBlocks(kok, [1])).toThrow(/çocuklu bloklar/);
	});
});

// ---------------------------------------------------------------------------

describe("ekleme ve kurucular", () => {
	it("insertNode araya ekliyor", () => {
		const sonuc = insertNode(belge(), [1], { type: "thematicBreak" });
		expect(nodeAtPath(sonuc, [1])?.type).toBe("thematicBreak");
		expect(sonuc.children).toHaveLength(4);
	});

	it("boş paragraf", () => {
		expect(emptyParagraph()).toEqual({ type: "paragraph", children: [] });
	});

	it("boş liste", () => {
		expect(md({ type: "root", children: [emptyList()] })).toBe("-");
		expect(emptyList(true).ordered).toBe(true);
		expect(emptyList(true).start).toBe(1);
	});

	it("boş belge", () => {
		expect(emptyDocument().children).toHaveLength(1);
		expect(md(emptyDocument())).toBe("");
	});
});

/** Komutlar `edit.ts` gibi değişmez olmalı — geri al yığını buna dayanacak. */
describe("değişmezlik", () => {
	it("girdi ağacı değişmiyor", () => {
		const kok = belge();
		const oncesi: Root = JSON.parse(JSON.stringify(kok));

		setBlockType(kok, [0], { type: "heading", depth: 1 });
		wrapIn(kok, [1], "blockquote");
		splitBlock(kok, [0], 0);
		joinBlocks(kok, [1]);
		insertNode(kok, [0], { type: "thematicBreak" });

		expect(kok).toEqual(oncesi);
	});
});

/** Kapsam raporunun gösterdiği, testsiz kalmış yollar. */
describe("daha az yürünen yollar", () => {
	it("görselin alt metni düz metne katılıyor", () => {
		const icerik: Inline[] = [
			{ type: "image", url: "/r.png", alt: "kedi", title: null },
			metin(" resmi"),
		];
		expect(toggleMark(icerik, "inlineCode")).toEqual([{ type: "inlineCode", value: "kedi resmi" }]);
	});

	it("ham HTML bloğu paragrafa çevrilirken metne iniyor", () => {
		const kok: Root = { type: "root", children: [{ type: "html", value: "<br>" }] };
		expect(md(setBlockType(kok, [0], { type: "paragraph" }))).toBe("<br>");
	});

	it("içeriksiz blok paragrafa çevrilince boşalıyor", () => {
		const kok: Root = { type: "root", children: [{ type: "thematicBreak" }] };
		const sonuc = setBlockType(kok, [0], { type: "paragraph" });
		expect((nodeAtPath(sonuc, [0]) as { children: unknown[] }).children).toHaveLength(0);
	});

	it("boş kod bloğu paragrafa çevrilince boşalıyor", () => {
		const kok: Root = {
			type: "root",
			children: [{ type: "code", lang: null, meta: null, value: "" }],
		};
		expect(
			(nodeAtPath(setBlockType(kok, [0], { type: "paragraph" }), [0]) as { children: unknown[] })
				.children,
		).toHaveLength(0);
	});

	it("olmayan yolda birleştirme anlaşılır hata veriyor", () => {
		expect(() => joinBlocks(belge(), [9])).toThrow(/bulunamadı/);
	});

	it("wrapIn olmayan yolda anlaşılır hata veriyor", () => {
		expect(() => wrapIn(belge(), [9], "blockquote")).toThrow(/yolunda düğüm yok/);
	});

	it("lift olmayan yolda anlaşılır hata veriyor", () => {
		const sarili = wrapIn(belge(), [0], "blockquote");
		expect(() => lift(sarili, [0, 9])).toThrow(/yolunda düğüm yok/);
	});

	it("splitBlock olmayan yolda anlaşılır hata veriyor", () => {
		expect(() => splitBlock(belge(), [9], 0)).toThrow(/yolunda düğüm yok/);
	});
});
