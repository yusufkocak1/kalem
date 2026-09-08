import { describe, expect, it } from "vitest";
import type { Heading, Node, Paragraph, Root, Text } from "./ast.js";
import {
	isBlock,
	isFrontmatter,
	isInline,
	isLiteral,
	isNode,
	isNodeOf,
	isParent,
	isRoot,
	isStructural,
} from "./guards.js";

const paragraf: Paragraph = { type: "paragraph", children: [] };
const baslik: Heading = { type: "heading", depth: 1, children: [] };
const metin: Text = { type: "text", value: "ışık" };
const kok: Root = { type: "root", children: [] };

describe("isNode", () => {
	it("bilinen düğümler için true", () => {
		expect(isNode(paragraf)).toBe(true);
		expect(isNode(metin)).toBe(true);
	});

	it("bilinmeyen `type` için false", () => {
		expect(isNode({ type: "uydurma" })).toBe(false);
	});

	/**
	 * Koruyucular güvenilmeyen veriye karşı da kullanılır — JSON'dan gelen bir
	 * ağaç, eski bir sürümün çıktısı, eklenti dönüşü. Hiçbirinde patlamamalı.
	 */
	it("düğüm olmayan hiçbir şeyde patlamıyor", () => {
		const cop: unknown[] = [
			null,
			undefined,
			0,
			1,
			"",
			"paragraph",
			true,
			[],
			{},
			{ type: 1 },
			{ type: null },
			Object.create(null),
			new Date(),
			() => paragraf,
			Number.NaN,
		];
		// Etiket güvenli üretilmeli: Object.create(null) üzerinde String() patlar.
		const etiket = (v: unknown): string => {
			try {
				return JSON.stringify(v) ?? Object.prototype.toString.call(v);
			} catch {
				return Object.prototype.toString.call(v);
			}
		};
		for (const deger of cop) {
			expect(isNode(deger), `düğüm sayıldı: ${etiket(deger)}`).toBe(false);
		}
	});
});

describe("isNodeOf", () => {
	it("tipi eşleşen düğümü daraltıyor", () => {
		const dugum: Node = baslik;
		if (isNodeOf(dugum, "heading")) {
			// Daraltma çalışmasaydı `depth` derleme hatası verirdi.
			expect(dugum.depth).toBe(1);
		} else {
			expect.unreachable("heading olarak daraltılmalıydı");
		}
	});

	it("tipi eşleşmeyende false", () => {
		expect(isNodeOf(paragraf, "heading")).toBe(false);
	});
});

describe("katman koruyucuları", () => {
	it("isRoot yalnızca kök için", () => {
		expect(isRoot(kok)).toBe(true);
		expect(isRoot(paragraf)).toBe(false);
	});

	it("isBlock blok düzeyi içerik için", () => {
		expect(isBlock(paragraf)).toBe(true);
		expect(isBlock(baslik)).toBe(true);
		expect(isBlock({ type: "thematicBreak" })).toBe(true);
		expect(isBlock(metin)).toBe(false);
		expect(isBlock(kok)).toBe(false);
	});

	it("isInline satır içi içerik için", () => {
		expect(isInline(metin)).toBe(true);
		expect(isInline({ type: "break" })).toBe(true);
		expect(isInline(paragraf)).toBe(false);
	});

	/**
	 * mdast ham HTML için blok/satır içi ayrımı yapmaz — `<br>` bir cümlenin
	 * ortasında da, tek başına da yazılabilir. Bu yüzden `html` iki koruyucuda
	 * birden true döner. Tutarsızlık değil, bilinçli.
	 */
	it("html hem blok hem satır içi sayılıyor", () => {
		const ham = { type: "html", value: "<br>" };
		expect(isBlock(ham)).toBe(true);
		expect(isInline(ham)).toBe(true);
	});

	it("isStructural yalnızca ebeveynine bağlı düğümler için", () => {
		expect(isStructural({ type: "listItem", checked: null, spread: false, children: [] })).toBe(
			true,
		);
		expect(isStructural({ type: "tableRow", children: [] })).toBe(true);
		expect(isStructural({ type: "tableCell", children: [] })).toBe(true);

		// Yapısal düğümler blok DEĞİL — blockquote bir tableRow kabul etmemeli.
		expect(isBlock({ type: "listItem", checked: null, spread: false, children: [] })).toBe(false);
		expect(isBlock({ type: "tableRow", children: [] })).toBe(false);
	});

	it("isFrontmatter yalnızca yaml/toml için", () => {
		expect(isFrontmatter({ type: "yaml", value: "a: 1" })).toBe(true);
		expect(isFrontmatter({ type: "toml", value: "a = 1" })).toBe(true);
		expect(isFrontmatter(paragraf)).toBe(false);
	});
});

describe("isParent", () => {
	it("çocuklu düğümler için true", () => {
		expect(isParent(paragraf)).toBe(true);
		expect(isParent(kok)).toBe(true);
		expect(
			isParent({ type: "list", ordered: false, start: null, spread: false, children: [] }),
		).toBe(true);
	});

	it("yaprak düğümler için false", () => {
		expect(isParent(metin)).toBe(false);
		expect(isParent({ type: "thematicBreak" })).toBe(false);
		expect(isParent({ type: "code", lang: null, meta: null, value: "" })).toBe(false);
	});

	/**
	 * Künyede çocuklu görünen ama `children` alanı eksik/bozuk gelen bir düğüm
	 * gezinme sırasında patlamamalı — F1-02'nin `walk`'u bu koruyucuya güvenecek.
	 */
	it("children alanı bozuk olan düğümü ebeveyn saymıyor", () => {
		expect(isParent({ type: "paragraph" })).toBe(false);
		expect(isParent({ type: "paragraph", children: null })).toBe(false);
		expect(isParent({ type: "paragraph", children: "metin" })).toBe(false);
	});
});

describe("isLiteral", () => {
	it("metin değeri taşıyan düğümler için true", () => {
		expect(isLiteral(metin)).toBe(true);
		expect(isLiteral({ type: "code", lang: null, meta: null, value: "x" })).toBe(true);
		expect(isLiteral({ type: "html", value: "<br>" })).toBe(true);
		expect(isLiteral({ type: "yaml", value: "a: 1" })).toBe(true);
	});

	it("değer alanı eksik ya da yanlış tipte olanda false", () => {
		expect(isLiteral({ type: "text" })).toBe(false);
		expect(isLiteral({ type: "text", value: 42 })).toBe(false);
	});

	it("ebeveyn düğümlerde false", () => {
		expect(isLiteral(paragraf)).toBe(false);
	});
});

/**
 * Türkçe metin koruyuculardan sorunsuz geçmeli. Koruyucular `type` alanını
 * karşılaştırırken locale'e duyarlı bir işlem yapmıyor — yapsaydı `İ`/`ı`
 * yüzünden sessizce yanlış çalışırdı (bkz. CONTRIBUTING.md §4).
 */
describe("locale dayanıklılığı", () => {
	it("Türkçe içerik koruyucuları etkilemiyor", () => {
		const dugumler = [
			{ type: "text", value: "ışık İyi ĞÜŞÇÖ" },
			{ type: "inlineCode", value: "IŞIK" },
			{ type: "heading", depth: 2 as const, children: [{ type: "text", value: "İstatistik" }] },
		];
		expect(dugumler.every((d) => isNode(d))).toBe(true);
		expect(isLiteral(dugumler[0])).toBe(true);
		expect(isInline(dugumler[1])).toBe(true);
		expect(isBlock(dugumler[2])).toBe(true);
	});

	it("büyük harfli tip adı düğüm sayılmıyor", () => {
		// "HEADING".toLowerCase() gibi bir normalleştirme yapılsaydı bu geçerdi.
		expect(isNode({ type: "HEADING" })).toBe(false);
		expect(isNode({ type: "Heading" })).toBe(false);
	});
});
