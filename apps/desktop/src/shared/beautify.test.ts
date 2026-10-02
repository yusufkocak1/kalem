import { describe, expect, it } from "vitest";
import { beautify, detectLanguage, formatJson, formatXml } from "./beautify.js";

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
