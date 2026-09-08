import { describe, expect, it } from "vitest";
import type { NodeType } from "./ast.js";
import { isParentContent, NODE_TYPES, SPECS, specOf } from "./spec.js";

/**
 * Künye kaydı bütün ağaç işlemlerinin tek doğruluk kaynağı. Burada bozulan
 * bir şey gezinme (F1-02), render (F2) ve serileştirmeyi (F1-07) birden
 * bozar; bu yüzden testler kaydın **tam** ve **tutarlı** olduğuna bakar.
 */
describe("künye kaydı", () => {
	it("her künyenin anahtarı ile `type` alanı aynı", () => {
		for (const [anahtar, spec] of Object.entries(SPECS)) {
			expect(spec.type).toBe(anahtar);
		}
	});

	it("her düğüm en az bir gruba ait", () => {
		for (const spec of Object.values(SPECS)) {
			expect(spec.groups.length).toBeGreaterThan(0);
		}
	});

	it("NODE_TYPES kaydın anahtarlarıyla birebir", () => {
		expect([...NODE_TYPES].sort()).toEqual(Object.keys(SPECS).sort());
	});

	it("mdast'ın çekirdek düğümlerinin hepsi kayıtlı", () => {
		// Bu liste mdast şemasından geliyor. Eksik bir tip, o Markdown yapısını
		// hiç temsil edemiyoruz demektir.
		const beklenen: NodeType[] = [
			"root",
			"paragraph",
			"heading",
			"blockquote",
			"list",
			"listItem",
			"code",
			"thematicBreak",
			"html",
			"definition",
			"table",
			"tableRow",
			"tableCell",
			"text",
			"emphasis",
			"strong",
			"delete",
			"inlineCode",
			"link",
			"image",
			"linkReference",
			"imageReference",
			"break",
			"yaml",
			"toml",
		];
		for (const tip of beklenen) {
			expect(SPECS[tip], `künyesi eksik: ${tip}`).toBeDefined();
		}
	});

	it("yalnızca `html` birden fazla gruba ait", () => {
		const cokGruplu = Object.values(SPECS)
			.filter((s) => s.groups.length > 1)
			.map((s) => s.type);
		expect(cokGruplu).toEqual(["html"]);
	});

	it("`hasSyntax` yalnızca yazım tercihi olan tiplerde açık", () => {
		// Yazılışı tek biçimli olan düğümlerin yazım tercihi olamaz.
		expect(SPECS.paragraph.hasSyntax).toBe(false);
		expect(SPECS.delete.hasSyntax).toBe(false); // GFM'de yalnızca ~~
		expect(SPECS.text.hasSyntax).toBe(false);

		// Birden fazla geçerli yazılışı olanlarda açık.
		expect(SPECS.heading.hasSyntax).toBe(true); // atx / setext
		expect(SPECS.list.hasSyntax).toBe(true); // - / * / +
		expect(SPECS.code.hasSyntax).toBe(true); // ``` / ~~~ / girintili
		expect(SPECS.emphasis.hasSyntax).toBe(true); // * / _
	});
});

describe("specOf", () => {
	it("bilinen tipin künyesini veriyor", () => {
		expect(specOf("heading")?.groups).toEqual(["block"]);
	});

	it("bilinmeyen tipte undefined döndürüyor", () => {
		expect(specOf("bilinmeyen")).toBeUndefined();
	});

	it("prototip zinciri üzerinden künye uydurmuyor", () => {
		// Object.hasOwn kullanılmasaydı bunlar "künye" gibi görünürdü.
		expect(specOf("toString")).toBeUndefined();
		expect(specOf("constructor")).toBeUndefined();
		expect(specOf("__proto__")).toBeUndefined();
	});
});

describe("isParentContent", () => {
	it("çocuk taşıyan modeller için true", () => {
		expect(isParentContent("blocks")).toBe(true);
		expect(isParentContent("inlines")).toBe(true);
		expect(isParentContent("listItems")).toBe(true);
		expect(isParentContent("tableRows")).toBe(true);
		expect(isParentContent("tableCells")).toBe(true);
	});

	it("yaprak modeller için false", () => {
		expect(isParentContent("value")).toBe(false);
		expect(isParentContent("void")).toBe(false);
	});
});
