import { describe, expect, it } from "vitest";
import {
	confluenceToMarkdown,
	detectConfluenceFormat,
	markdownToStorage,
	markdownToWiki,
} from "./confluence.js";
import { escapeWiki } from "./confluence-wiki.js";

describe("detectConfluenceFormat", () => {
	it("tells storage format from wiki markup", () => {
		expect(detectConfluenceFormat("<p>Hi</p>")).toBe("storage");
		expect(detectConfluenceFormat("\uFEFF  <h1>x</h1>")).toBe("storage");
		expect(detectConfluenceFormat("h1. Title")).toBe("wiki");
	});
});

describe("storage format import", () => {
	it("converts headings, marks, links and lists", () => {
		const md = confluenceToMarkdown(
			'<h1>Başlık</h1><p>Bir <strong>kalın</strong>, <em>eğik</em> ve <span style="text-decoration: line-through;">çizik</span> &amp; <code>kod</code>.</p><p><a href="https://example.com">bağlantı</a></p><ul><li>bir<ul><li>iki</li></ul></li></ul><ol><li>üç</li></ol>',
		);
		expect(md).toContain("# Başlık");
		expect(md).toContain("**kalın**");
		expect(md).toContain("*eğik*");
		expect(md).toContain("~~çizik~~");
		expect(md).toContain("& `kod`");
		expect(md).toContain("[bağlantı](https://example.com)");
		expect(md).toMatch(/- bir\n\s+- iki/);
		expect(md).toContain("1. üç");
	});

	it("turns the code macro into a fenced block with its language", () => {
		const md = confluenceToMarkdown(
			'<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[if (a < b) {\n  run();\n}]]></ac:plain-text-body></ac:structured-macro>',
		);
		expect(md).toContain("```javascript\nif (a < b) {\n  run();\n}\n```");
	});

	it("turns panels into quotes that start with their icon", () => {
		const md = confluenceToMarkdown(
			'<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Dikkat edin.</p></ac:rich-text-body></ac:structured-macro><ac:structured-macro ac:name="warning"><ac:parameter ac:name="title">Uyarı</ac:parameter><ac:rich-text-body><p>Metin</p></ac:rich-text-body></ac:structured-macro>',
		);
		expect(md).toContain("> ℹ️ Dikkat edin.");
		expect(md).toContain("> **⚠️ Uyarı**");
	});

	it("converts task lists, images, links to pages and emoticons", () => {
		const md = confluenceToMarkdown(
			'<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>bitti</ac:task-body></ac:task><ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>kaldı</ac:task-body></ac:task></ac:task-list><p><ac:image ac:alt="Şema"><ri:attachment ri:filename="sema 1.png" /></ac:image></p><p><ac:link><ri:page ri:content-title="Diğer Sayfa" /></ac:link> <ac:emoticon ac:name="tick" /></p>',
		);
		expect(md).toContain("- [x] bitti");
		expect(md).toContain("- [ ] kaldı");
		expect(md).toContain("![Şema](sema%201.png)");
		expect(md).toContain("Diğer Sayfa ✅");
		expect(md).not.toContain("<ac:");
	});

	it("keeps tables rectangular and cells on one line", () => {
		const md = confluenceToMarkdown(
			'<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td colspan="2"><p>bir</p><p>iki</p></td></tr></tbody></table>',
		);
		expect(md).toMatch(/\| A +\| B +\|/);
		expect(md).toMatch(/\| bir iki +\| +\|/);
	});

	it("tolerates HTML entities and unclosed tags", () => {
		const md = confluenceToMarkdown("<p>a&nbsp;b &mdash; c<br>d</p>");
		expect(md).toBe("a b — c\\\nd\n");
	});

	it("reads the body of an exported HTML page", () => {
		const md = confluenceToMarkdown(
			"<!DOCTYPE html><html><head><title>T</title><style>p{}</style></head><body><h2>Bölüm</h2></body></html>",
		);
		expect(md.trim()).toBe("## Bölüm");
	});
});

describe("storage format export", () => {
	it("writes XHTML with Confluence macros", () => {
		const xml = markdownToStorage(
			[
				"# Başlık",
				"",
				"Bir **kalın** ~~çizik~~ `a<b` [web](https://example.com)  ",
				"satır",
				"",
				"```ts",
				"const x = 1; // ]]>",
				"```",
				"",
				"- [x] bitti",
				"- [ ] kaldı",
				"",
				"3. üç",
				"",
				"| A | B |",
				"| :-: | - |",
				"| 1 | 2 |",
				"",
				"![logo](images/logo.png)",
				"",
				"---",
			].join("\n"),
		);
		expect(xml).toContain("<h1>Başlık</h1>");
		expect(xml).toContain("<strong>kalın</strong>");
		expect(xml).toContain('<span style="text-decoration: line-through;">çizik</span>');
		expect(xml).toContain("<code>a&lt;b</code>");
		expect(xml).toContain('<a href="https://example.com">web</a><br />');
		expect(xml).toContain(
			'<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">typescript</ac:parameter><ac:plain-text-body><![CDATA[const x = 1; // ]]]]><![CDATA[>]]></ac:plain-text-body></ac:structured-macro>',
		);
		expect(xml).toContain("<ac:task-status>complete</ac:task-status><ac:task-body>bitti");
		expect(xml).toContain('<ol start="3"><li>üç</li></ol>');
		expect(xml).toContain('<th style="text-align: center;">A</th><th>B</th>');
		expect(xml).toContain(
			'<ac:image ac:alt="logo"><ri:attachment ri:filename="logo.png" /></ac:image>',
		);
		expect(xml).toContain("<hr />");
	});

	it("writes icon quotes back as panels", () => {
		const xml = markdownToStorage("> **⚠️ Uyarı**\n>\n> Metin\n\n> 💡 İpucu\n");
		expect(xml).toContain(
			'<ac:structured-macro ac:name="warning"><ac:parameter ac:name="title">Uyarı</ac:parameter><ac:rich-text-body><p>Metin</p></ac:rich-text-body></ac:structured-macro>',
		);
		expect(xml).toContain(
			'<ac:structured-macro ac:name="tip"><ac:rich-text-body><p>İpucu</p></ac:rich-text-body></ac:structured-macro>',
		);
	});

	it("drops Kalem's table style comments and frontmatter", () => {
		const xml = markdownToStorage(
			"---\ntitle: x\n---\n\n<!-- kalem-table color=blue -->\n| a |\n| - |\n| b |\n",
		);
		expect(xml).not.toContain("title: x");
		expect(xml).not.toContain("kalem");
	});

	it("round-trips through import", () => {
		const markdown = [
			"## Plan",
			"",
			"Bir **kalın** ve *eğik* metin.",
			"",
			"- bir",
			"- iki",
			"",
			"```python",
			"print(1)",
			"```",
			"",
			"> ℹ️ Not",
			"",
		].join("\n");
		expect(confluenceToMarkdown(markdownToStorage(markdown))).toBe(markdown);
	});
});

describe("wiki markup import", () => {
	it("converts headings, marks, links and images", () => {
		const md = confluenceToMarkdown(
			[
				"h1. Başlık",
				"",
				"Bir *kalın*, _eğik_, -çizik-, +altı çizili+ ve {{kod}} metin.",
				'[Örnek|https://example.com] ve [https://kalem.dev] ile !resim.png|alt="Şema"!',
				"{color:red}kırmızı{color} \\*yıldız\\* e-posta",
			].join("\n"),
		);
		expect(md).toContain("# Başlık");
		expect(md).toContain("**kalın**");
		expect(md).toContain("*eğik*");
		expect(md).toContain("~~çizik~~");
		expect(md).toContain("altı çizili ve `kod` metin.");
		expect(md).toContain("[Örnek](https://example.com)");
		expect(md).toContain("https://kalem.dev");
		expect(md).toContain("![Şema](resim.png)");
		expect(md).toContain('<span style="color:red">kırmızı</span>');
		expect(md).toContain("\\*yıldız\\* e-posta");
	});

	it("converts nested and mixed lists, and task markers", () => {
		const md = confluenceToMarkdown(
			["* bir", "** iki", "*# üç", "* (/) bitti", "* ( ) kaldı", "", "# sıra", "# sıra"].join("\n"),
		);
		expect(md).toMatch(/- bir\n {2}- iki\n {2}1\. üç/);
		expect(md).toContain("- [x] bitti");
		expect(md).toContain("- [ ] kaldı");
		expect(md).toMatch(/1\. sıra\n2\. sıra/);
	});

	it("converts code, noformat, quote and panel macros", () => {
		const md = confluenceToMarkdown(
			[
				"{code:language=py|title=Örnek}",
				"print('*not bold*')",
				"{code}",
				"{noformat}düz [metin]{noformat}",
				"{quote}",
				"alıntı",
				"{quote}",
				"bq. kısa alıntı",
				"{warning:title=Dikkat}",
				"Yedek alın.",
				"{warning}",
				"----",
			].join("\n"),
		);
		expect(md).toContain("```python\nprint('*not bold*')\n```");
		expect(md).toContain("```\ndüz [metin]\n```");
		expect(md).toContain("> alıntı");
		expect(md).toContain("> kısa alıntı");
		expect(md).toContain("> **⚠️ Dikkat**\n>\n> Yedek alın.");
		expect(md).toContain("---");
	});

	it("converts tables, keeping links with pipes in a cell", () => {
		const md = confluenceToMarkdown(
			["||Ad||Bağlantı||", "|Kalem|[site|https://kalem.dev]|", "|Boş| |"].join("\n"),
		);
		expect(md).toMatch(/\| Ad +\| Bağlantı +\|/);
		expect(md).toContain("[site](https://kalem.dev)");
		expect(md).toMatch(/\| Boş +\| +\|/);
	});

	it("keeps line breaks inside a paragraph", () => {
		const md = confluenceToMarkdown("bir\niki\\\\üç");
		expect(md.split("\n").length).toBeGreaterThanOrEqual(3);
	});

	it("drops unsafe links", () => {
		const md = confluenceToMarkdown("[tıkla|javascript:alert(1)]");
		expect(md).not.toContain("javascript:");
		expect(md).toContain("tıkla");
	});
});

describe("wiki markup export", () => {
	it("writes wiki markup", () => {
		const wiki = markdownToWiki(
			[
				"# Başlık",
				"",
				"Bir **kalın** *eğik* ~~çizik~~ `kod` [web](https://example.com) ![logo](logo.png)",
				"",
				"- bir",
				"  - iki",
				"- [x] bitti",
				"",
				"1. sıra",
				"",
				"```javascript",
				"run();",
				"```",
				"",
				"> alıntı",
				"",
				"| A | B |",
				"| - | - |",
				"| 1 |   |",
				"",
				"---",
			].join("\n"),
		);
		expect(wiki).toContain("h1. Başlık");
		expect(wiki).toContain(
			'Bir *kalın* _eğik_ -çizik- {{kod}} [web|https://example.com] !logo.png|alt="logo"!',
		);
		expect(wiki).toContain("* bir\n** iki\n* (/) bitti");
		expect(wiki).toContain("# sıra");
		expect(wiki).toContain("{code:language=js}\nrun();\n{code}");
		expect(wiki).toContain("bq. alıntı");
		expect(wiki).toContain("||A||B||\n|1| |");
		expect(wiki).toContain("----");
	});

	it("writes icon quotes back as panels", () => {
		expect(markdownToWiki("> **ℹ️ Bilgi**\n>\n> Metin\n")).toBe(
			"{info:title=Bilgi}\nMetin\n{info}\n",
		);
	});

	it("escapes markup in text but leaves ordinary punctuation", () => {
		expect(escapeWiki("e-posta, 3 - 2, *yıldız* [x] {a} C:\\yol")).toBe(
			"e-posta, 3 - 2, \\*yıldız\\* \\[x\\] \\{a\\} C:&#92;yol",
		);
	});

	it("round-trips through import", () => {
		const markdown = [
			"## Plan",
			"",
			"Bir **kalın** ve *eğik* metin, [bağlantı](https://example.com).",
			"",
			"- bir",
			"  - iki",
			"- [ ] görev",
			"",
			"```python",
			"print(1)",
			"```",
			"",
			"| A | B |",
			"| --- | --- |",
			"| 1 | 2 |",
			"",
		].join("\n");
		expect(confluenceToMarkdown(markdownToWiki(markdown))).toBe(markdown);
	});
});
