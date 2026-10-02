import type { Code } from "@kalem-editor/core";
import { parse, serialize } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import { formatAllCodeBlocks, formatCodeBlock } from "./code-blocks.js";

function firstCode(markdown: string): Code {
	const block = parse(markdown).children[0];
	if (block?.type !== "code") throw new Error("expected a code block");
	return block;
}

describe("formatCodeBlock", () => {
	it("reformats the value and keeps the fence", () => {
		const { code } = formatCodeBlock(firstCode('~~~~json\n{"a":[1,2]}\n~~~~\n'));
		expect(code?.value).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
		expect(code?.lang).toBe("json");
		expect(code?.syntax).toEqual({ style: "fenced", fence: "~", fenceLength: 4 });
	});

	it("returns null when the block is already formatted", () => {
		const { result, code } = formatCodeBlock(firstCode('```json\n{\n  "a": 1\n}\n```\n'));
		expect(result.ok).toBe(true);
		expect(code).toBeNull();
	});

	it("labels an unlabeled block with the detected language", () => {
		const { code } = formatCodeBlock(firstCode("```\n<a><b/></a>\n```\n"));
		expect(code?.lang).toBe("xml");
		expect(code?.value).toBe("<a>\n  <b/>\n</a>\n");
	});

	it("turns an indented block into a fenced one when it gains a language", () => {
		const doc = parse('    {"a":1}\n');
		const { code } = formatCodeBlock(doc.children[0] as Code);
		expect(code).not.toBeNull();
		expect(serialize({ ...doc, children: [code as Code] })).toBe('```json\n{\n  "a": 1\n}\n```\n');
	});

	it("leaves invalid and unsupported blocks alone", () => {
		const invalid = formatCodeBlock(firstCode("```json\n{a: 1}\n```\n"));
		expect(invalid.code).toBeNull();
		expect(invalid.result).toMatchObject({ ok: false, reason: "invalid", language: "json" });

		const python = formatCodeBlock(firstCode("```python\nprint({})\n```\n"));
		expect(python.code).toBeNull();
		expect(python.result).toEqual({ ok: false, reason: "unsupported" });
	});
});

describe("formatAllCodeBlocks", () => {
	const SOURCE = [
		"# Başlık",
		"",
		"```json",
		'{"a":1}',
		"```",
		"",
		"- madde",
		"",
		"  ```xml",
		"  <a><b/></a>",
		"  ```",
		"",
		"```json",
		"{bozuk}",
		"```",
		"",
		"```python",
		"print(1)",
		"```",
		"",
	].join("\n");

	it("formats top-level and nested blocks and counts the invalid ones", () => {
		const { doc, formatted, invalid } = formatAllCodeBlocks(parse(SOURCE));
		expect(formatted).toBe(2);
		expect(invalid).toBe(1);

		const output = serialize(doc);
		expect(output).toContain('```json\n{\n  "a": 1\n}\n```');
		expect(output).toContain("  ```xml\n  <a>\n    <b/>\n  </a>\n  ```");
		expect(output).toContain("```json\n{bozuk}\n```");
		expect(output).toContain("```python\nprint(1)\n```");
		expect(output.startsWith("# Başlık\n\n")).toBe(true);
	});

	it("keeps the identity of everything it does not change", () => {
		const doc = parse(SOURCE);
		const result = formatAllCodeBlocks(doc);
		expect(result.doc.children[0]).toBe(doc.children[0]);
		expect(result.doc.children[3]).toBe(doc.children[3]);
		expect(result.doc.children[1]).not.toBe(doc.children[1]);

		const again = formatAllCodeBlocks(result.doc);
		expect(again.formatted).toBe(0);
		expect(again.doc).toBe(result.doc);
	});
});
