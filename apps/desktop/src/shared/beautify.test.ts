import { describe, expect, it } from "vitest";
import { beautify, detectLanguage, formatJson, formatXml, formatYaml } from "./beautify.js";

describe("formatJson", () => {
	it("indents objects and arrays", () => {
		expect(formatJson('{"ad":"Ayşe","yaş":30,"etiketler":["a","b"],"adres":{"il":"İzmir"}}')).toBe(
			[
				"{",
				'  "ad": "Ayşe",',
				'  "yaş": 30,',
				'  "etiketler": [',
				'    "a",',
				'    "b"',
				"  ],",
				'  "adres": {',
				'    "il": "İzmir"',
				"  }",
				"}",
			].join("\n"),
		);
	});

	it("keeps empty containers on one line", () => {
		expect(formatJson('{"a":{},"b":[ ]}')).toBe('{\n  "a": {},\n  "b": []\n}');
		expect(formatJson("[]")).toBe("[]");
	});

	it("does not rewrite values", () => {
		const source = '{"n":1.0,"big":12345678901234567890,"e":1E5,"s":"a\\u00e7\\"b","k":1,"k":2}';
		const formatted = formatJson(source);
		expect(formatted).toContain('"n": 1.0');
		expect(formatted).toContain('"big": 12345678901234567890');
		expect(formatted).toContain('"e": 1E5');
		expect(formatted).toContain('"s": "a\\u00e7\\"b"');
		expect(formatted.match(/"k"/g)).toHaveLength(2);
	});

	it("leaves punctuation inside strings alone", () => {
		expect(formatJson('{"a":"x, {y}: [z]"}')).toBe('{\n  "a": "x, {y}: [z]"\n}');
	});

	it("is idempotent", () => {
		const once = formatJson('{"a":[1,{"b":null}],"c":true}');
		expect(formatJson(once)).toBe(once);
	});

	it("handles scalars", () => {
		expect(formatJson(' "metin" ')).toBe('"metin"');
		expect(formatJson("42")).toBe("42");
	});

	it("throws on invalid JSON", () => {
		expect(() => formatJson("{a: 1}")).toThrow();
		expect(() => formatJson('{"a": 1,}')).toThrow();
	});
});

describe("formatXml", () => {
	it("indents nested elements", () => {
		expect(formatXml('<kök><a x="1"><b/><c></c></a><d>metin</d></kök>')).toBe(
			[
				"<kök>",
				'  <a x="1">',
				"    <b/>",
				"    <c></c>",
				"  </a>",
				"  <d>metin</d>",
				"</kök>",
			].join("\n"),
		);
	});

	it("keeps the declaration, comments and doctype on their own lines", () => {
		const source =
			'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE not [<!ENTITY x "y">]><!-- üst --><not><a/></not>';
		expect(formatXml(source)).toBe(
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<!DOCTYPE not [<!ENTITY x "y">]>',
				"<!-- üst -->",
				"<not>",
				"  <a/>",
				"</not>",
			].join("\n"),
		);
	});

	it("does not touch text content", () => {
		expect(formatXml("<p>  iki  boşluk <b>kalın</b> son </p>")).toBe(
			"<p>  iki  boşluk <b>kalın</b> son </p>",
		);
		expect(formatXml("<a><b><![CDATA[ <ham> ]]></b></a>")).toBe(
			"<a>\n  <b><![CDATA[ <ham> ]]></b>\n</a>",
		);
	});

	it('respects xml:space="preserve"', () => {
		expect(formatXml('<a><pre xml:space="preserve"> <b/> </pre></a>')).toBe(
			'<a>\n  <pre xml:space="preserve"> <b/> </pre>\n</a>',
		);
	});

	it("is not confused by > inside attribute values", () => {
		expect(formatXml('<a koşul="x > y"><b/></a>')).toBe('<a koşul="x > y">\n  <b/>\n</a>');
	});

	it("reformats already indented input and is idempotent", () => {
		const once = formatXml("<a>\n        <b>\n<c/>\n   </b>\n</a>\n");
		expect(once).toBe("<a>\n  <b>\n    <c/>\n  </b>\n</a>");
		expect(formatXml(once)).toBe(once);
	});

	it("throws on malformed XML", () => {
		expect(() => formatXml("<a><b></a>")).toThrow("Expected </b> but found </a>");
		expect(() => formatXml("<a><b>")).toThrow("Missing closing tag </b>");
		expect(() => formatXml("</a>")).toThrow("Unexpected closing tag </a>");
		expect(() => formatXml("<a")).toThrow("Unclosed tag");
		expect(() => formatXml("<!-- x")).toThrow("Unclosed comment");
		expect(() => formatXml("metin")).toThrow();
		expect(() => formatXml("<a/> kuyruk")).toThrow("Text outside the root element");
	});
});

describe("detectLanguage", () => {
	it("uses the fence language when there is one", () => {
		expect(detectLanguage("x", "json")).toBe("json");
		expect(detectLanguage("x", " XML ")).toBe("xml");
		expect(detectLanguage("x", "svg")).toBe("xml");
		expect(detectLanguage('{"a":1}', "python")).toBeNull();
	});

	it("guesses from the content otherwise", () => {
		expect(detectLanguage('  {"a":1}', null)).toBe("json");
		expect(detectLanguage("[1]", "")).toBe("json");
		expect(detectLanguage("<a/>", "text")).toBe("xml");
		expect(detectLanguage("SELECT 1", null)).toBeNull();
	});
});

describe("beautify", () => {
	it("formats and reports the language", () => {
		expect(beautify('{"a":1}', "json")).toEqual({
			ok: true,
			text: '{\n  "a": 1\n}',
			language: "json",
		});
		expect(beautify("<a><b/></a>", null)).toEqual({
			ok: true,
			text: "<a>\n  <b/>\n</a>",
			language: "xml",
		});
	});

	it("reports invalid content of a declared language", () => {
		expect(beautify("{a: 1}", "json")).toMatchObject({
			ok: false,
			reason: "invalid",
			language: "json",
		});
		expect(beautify("<a>", "xml")).toMatchObject({
			ok: false,
			reason: "invalid",
			message: "Missing closing tag </a>",
		});
	});

	it("treats a wrong guess and other languages as unsupported", () => {
		expect(beautify("{ not: json }", null)).toEqual({ ok: false, reason: "unsupported" });
		expect(beautify("print(1)", "python")).toEqual({ ok: false, reason: "unsupported" });
	});
});

describe("formatJson with comments (JSONC)", () => {
	it("keeps line and block comments where they were", () => {
		const source = '{ // settings\n"a":1, /* inline */ "b":[1,2],\n// own line\n"c":{}}';
		expect(formatJson(source, true)).toBe(
			[
				"{ // settings",
				'  "a": 1, /* inline */',
				'  "b": [',
				"    1,",
				"    2",
				"  ],",
				"  // own line",
				'  "c": {}',
				"}",
			].join("\n"),
		);
	});

	it("keeps trailing commas and ignores comment markers in strings", () => {
		expect(formatJson('{"url":"http://x//y","a":[1,],}', true)).toBe(
			'{\n  "url": "http://x//y",\n  "a": [\n    1,\n  ],\n}',
		);
	});

	it("rejects comments in plain JSON and invalid JSONC", () => {
		expect(() => formatJson('{"a":1 // x\n}')).toThrow();
		expect(() => formatJson('{"a": /* x */ }', true)).toThrow();
		expect(() => formatJson('{"a":1 /* open', true)).toThrow("Unclosed comment");
	});
});

describe("formatXml as HTML", () => {
	it("knows void elements and keeps text and raw content as written", () => {
		const source =
			'<!DOCTYPE html><html><head><meta charset="utf-8"><style>a { b: c }\n</style></head><body><p>Bir  <b>kalın</b> söz<br></p><script>if (a < b) x();</script></body></html>';
		expect(formatXml(source, true)).toBe(
			[
				"<!DOCTYPE html>",
				"<html>",
				"  <head>",
				'    <meta charset="utf-8">',
				"    <style>a { b: c }\n</style>",
				"  </head>",
				"  <body>",
				"    <p>Bir  <b>kalın</b> söz<br></p>",
				"    <script>if (a < b) x();</script>",
				"  </body>",
				"</html>",
			].join("\n"),
		);
	});

	it("accepts left-out optional closing tags and mixed-case names", () => {
		expect(formatXml("<UL><li>bir<li>iki</ul>", true)).toBe("<UL>\n  <li>bir\n  <li>iki\n</ul>");
	});

	it("still reports a missing required closing tag", () => {
		expect(() => formatXml("<div><span></div>", true)).toThrow("Expected </span> but found </div>");
	});
});

describe("formatYaml", () => {
	it("re-indents without rewriting values or dropping comments", () => {
		const source = [
			"# top",
			"big:    12345678901234567890",
			"e: 1E5",
			"octal: 010",
			"flag: yes",
			"q: 'single'   # kept",
			"list:",
			"      - a",
			"      - &x {k: v}",
			"ref: *x",
			"lit: |",
			"    line1",
			"      line2",
		].join("\n");
		expect(formatYaml(source)).toBe(
			[
				"# top",
				"big: 12345678901234567890",
				"e: 1E5",
				"octal: 010",
				"flag: yes",
				"q: 'single' # kept",
				"list:",
				"  - a",
				"  - &x { k: v }",
				"ref: *x",
				"lit: |",
				"  line1",
				"    line2",
			].join("\n"),
		);
	});

	it("keeps every document of a stream", () => {
		expect(formatYaml("a:   1\n---\nb:   2\n")).toBe("a: 1\n---\nb: 2");
	});

	it("reports invalid YAML", () => {
		expect(() => formatYaml("a: [1, 2\nb: c")).toThrow();
	});
});

describe("beautify with the newer languages", () => {
	it("takes yaml, yml, html, htm and jsonc fences", () => {
		expect(detectLanguage("x", "yml")).toBe("yaml");
		expect(detectLanguage("x", "htm")).toBe("html");
		expect(detectLanguage("x", "jsonc")).toBe("jsonc");
		expect(detectLanguage("<!doctype html><p>x", null)).toBe("html");
	});

	it("falls back to JSONC and HTML when a guess does not parse strictly", () => {
		expect(beautify('{"a":1, // c\n}', null)).toMatchObject({ ok: true, language: "jsonc" });
		expect(beautify("<ul><li>a<li>b</ul>", null)).toMatchObject({ ok: true, language: "html" });
	});

	it("reports invalid YAML in a yaml fence", () => {
		expect(beautify("a: [1", "yaml")).toMatchObject({
			ok: false,
			reason: "invalid",
			language: "yaml",
		});
	});
});
