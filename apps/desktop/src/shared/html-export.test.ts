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

describe("buildHtmlDocument with table styles", () => {
	it("turns table comments into inline styles", () => {
		const html = build("<!-- kalem:table color=teal -->\n\n| a |\n| --- |\n| 1 |\n");
		expect(html).toContain('<th style="background:#0f7f78;color:#fff;border-color:#0f7f78">a</th>');
		expect(html).not.toContain("kalem:table");
	});
});

describe("buildHtmlDocument with previews", () => {
	it("puts rendered markup in place of the matching code blocks only", () => {
		const html = buildHtmlDocument({
			markdown:
				"```mermaid\ngraph LR\n```\n\n- liste\n\n  ```math\nx^2\n  ```\n\n```js\nlet a;\n```\n\n<b>ham</b>\n",
			title: "t",
			lang: "tr",
			css: "",
			preview: (code) =>
				code.lang === "mermaid"
					? "<svg>diyagram</svg>"
					: code.lang === "math"
						? "<math>x</math>"
						: null,
		});
		expect(html).toContain('<figure class="kalem-preview"><svg>diyagram</svg></figure>');
		expect(html).toContain('<figure class="kalem-preview"><math>x</math></figure>');
		expect(html).toContain('class="language-js"');
		expect(html).not.toContain("language-mermaid");
		// The document's own raw HTML is still escaped.
		expect(html).toContain("&lt;b&gt;ham&lt;/b&gt;");
	});
});

describe("buildHtmlDocument with footnotes", () => {
	it("links references to a numbered list of notes after the body", () => {
		const html = build("Bir[^n] cümle.\n\n[^n]: Açıklama **kalın**.\n");
		expect(html).toContain('Bir<sup id="kalem-fnref-1"><a href="#kalem-fn-1">1</a></sup> cümle.');
		expect(html).toContain(
			'<section class="kalem-footnotes"><hr><ol><li id="kalem-fn-1">Açıklama <strong>kalın</strong>. <a href="#kalem-fnref-1" aria-label="↩">↩</a></li></ol></section>',
		);
		expect(html).not.toContain("[^n]");
	});
});
