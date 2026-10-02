import { describe, expect, it } from "vitest";
import { buildHtmlDocument } from "./html-export.js";

const build = (markdown: string, title = "Rapor") =>
	buildHtmlDocument({ markdown, title, lang: "tr", css: ".kalem-doc { color: black; }" });

describe("buildHtmlDocument", () => {
	it("produces a self-contained document", () => {
		const html = build("# Başlık\n\nBir **kalın** kelime.\n");
		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain('<html lang="tr">');
		expect(html).toContain('<meta charset="utf-8">');
		expect(html).toContain("<title>Rapor</title>");
		expect(html).toContain(".kalem-doc { color: black; }");
		expect(html).toContain('<body class="kalem-doc kalem-theme">');
		expect(html).toContain("<h1>Başlık</h1>");
		expect(html).toContain("<strong>kalın</strong>");
	});

	it("escapes HTML in the title", () => {
		expect(build("x", "<script>alert(1)</script>")).toContain(
			"<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>",
		);
	});

	it("does not leave raw HTML or javascript: links executable", () => {
		const html = build("<script>alert(1)</script>\n\n[tıkla](javascript:alert(1))\n");
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).not.toContain("javascript:");
	});

	it("keeps relative image URLs relative", () => {
		expect(build("![şema](rapor.assets/sema.png)\n")).toContain('src="rapor.assets/sema.png"');
	});
});
