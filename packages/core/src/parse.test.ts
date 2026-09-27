import { describe, expect, it } from "vitest";
import type { Heading, List, ListItem, Paragraph, Root } from "./ast.js";
import { parse } from "./parse.js";

/** Ağacı okunur bir özete indirger. */
function ozet(node: unknown): string {
	const n = node as { type: string; children?: unknown[]; value?: string };
	if (n.children !== undefined) return `${n.type}[${n.children.map(ozet).join(", ")}]`;
	return n.value === undefined ? n.type : `${n.type}(${n.value})`;
}

describe("parse — blok ve satır içi birlikte", () => {
	it("başlıktaki vurguyu ayrıştırıyor", () => {
		expect(ozet(parse("# **Kalın** başlık").children[0])).toBe(
			"heading[strong[text(Kalın)], text( başlık)]",
		);
	});

	it("paragraftaki bağlantıyı ayrıştırıyor", () => {
		expect(ozet(parse("Şuraya bak: [site](https://ornek.com)").children[0])).toBe(
			"paragraph[text(Şuraya bak: ), link[text(site)]]",
		);
	});

	it("liste maddesindeki kodu ayrıştırıyor", () => {
		const liste = parse("- `kod` ve *vurgu*").children[0] as List;
		expect(ozet((liste.children[0] as ListItem).children[0])).toBe(
			"paragraph[inlineCode(kod), text( ve ), emphasis[text(vurgu)]]",
		);
	});

	it("kod bloğunun içi satır içi ayrıştırmaya girmiyor", () => {
		expect(ozet(parse("```\n*yıldız*\n```").children[0])).toBe("code(*yıldız*\n)");
	});

	it("frontmatter içeriği ayrıştırılmıyor", () => {
		expect(ozet(parse("---\nbaslik: *yıldız*\n---").children[0])).toBe("yaml(baslik: *yıldız*)");
	});

	it("alıntı içindeki vurgu", () => {
		expect(ozet(parse("> *a*").children[0])).toBe("blockquote[paragraph[emphasis[text(a)]]]");
	});

	it("gerçekçi belge", () => {
		const md = [
			"# Kalem",
			"",
			"**Word kadar kolay**, [Markdown](https://commonmark.org) kadar taşınabilir.",
			"",
			"- `@kalem-editor/core` — ayrıştırıcı",
			"- `@kalem-editor/editor` — motor",
		].join("\n");
		const kok: Root = parse(md);
		expect(kok.children.map((c) => c.type)).toEqual(["heading", "paragraph", "list"]);

		const p = kok.children[1] as Paragraph;
		expect(p.children.map((c) => c.type)).toEqual(["strong", "text", "link", "text"]);

		const h = kok.children[0] as Heading;
		expect(ozet(h)).toBe("heading[text(Kalem)]");
	});

	it("Türkçe belgeyi bozmuyor", () => {
		const kok = parse("# Işık\n\n*Işıldıyor* ve **gölge** düşüyor.");
		expect(ozet(kok.children[1])).toBe(
			"paragraph[emphasis[text(Işıldıyor)], text( ve ), strong[text(gölge)], text( düşüyor.)]",
		);
	});
});
