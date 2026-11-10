import { describe, expect, it } from "vitest";
import { assistantInstructions, IDENTITY } from "./assistant-prompt.js";
import { SYSTEM_PROMPT } from "./claude.js";
import {
	documentLines,
	findHeading,
	outlineOf,
	outlineText,
	searchDocument,
} from "./document-outline.js";
import { stringsFor } from "./i18n.js";
import { modeExcluded, modeInstructions } from "./modes.js";
import {
	blockInstructions,
	blockResults,
	parseApprovalAnswer,
	scopesFor,
	toolCalls,
	withoutToolCalls,
} from "./tool-protocol.js";

const tool = {
	name: "settings_set",
	description: "Changes settings; the user is asked first. More words.",
	parameters: {
		type: "object" as const,
		properties: { changes: {}, reason: {} },
		required: ["changes"],
	},
};

describe("tool calls written in blocks", () => {
	it("reads the calls of a reply's kalem-tool blocks, and leaves them out of what is shown", () => {
		const reply = [
			"Bakıyorum.",
			"",
			"```kalem-tool",
			'[{ "tool": "settings_find", "input": { "query": "koyu" } }, { "name": "app_state" }]',
			"```",
			"",
			"```kalem-tool",
			"not json",
			"```",
		].join("\n");
		expect(toolCalls(reply)).toEqual([
			{ tool: "settings_find", input: { query: "koyu" } },
			{ tool: "app_state", input: {} },
		]);
		expect(withoutToolCalls(reply).trim()).toBe("Bakıyorum.");
	});

	it("tells the model the tools by their inputs, and sends the results back", () => {
		const text = blockInstructions([tool]);
		expect(text).toContain("```kalem-tool");
		expect(text).toContain(
			"- settings_set(changes, reason?): Changes settings; the user is asked first.",
		);
		expect(blockResults([{ tool: "app_state", text: "ok" }])).toBe(
			'<tool-results>\n<result tool="app_state">\nok\n</result>\n</tool-results>',
		);
	});

	it("takes only answers it knows, and never lets online changes be allowed for good", () => {
		expect(
			parseApprovalAnswer({ approved: true, scope: "always", selected: [0, 2, -1, "x"] }),
		).toEqual({
			approved: true,
			scope: "always",
			selected: [0, 2],
		});
		expect(parseApprovalAnswer({ approved: "yes" })).toEqual({ approved: false, scope: "once" });
		expect(scopesFor("external")).toEqual(["once"]);
		expect(scopesFor("ui")).toEqual(["once", "session", "always"]);
	});
});

describe("the document's outline", () => {
	const doc =
		"# Analiz\n\n## Amaç\n\nMetin\n\n```\n# kod, başlık değil\n```\n\nKapsam\n------\n\nWeb\n";

	it("lists the headings with their parts, code blocks passed over", () => {
		expect(outlineOf(doc).map(({ level, title, line, end }) => [level, title, line, end])).toEqual([
			[1, "Analiz", 1, 15],
			[2, "Amaç", 3, 10],
			[2, "Kapsam", 11, 15],
		]);
		expect(outlineText(doc)).toContain("  ## Kapsam (lines 11-15");
		expect(findHeading(doc, "## kapsam")?.line).toBe(11);
		expect(documentLines(doc, 3, 5)).toBe("(lines 3-5 of 15)\n## Amaç\n\nMetin");
		expect(searchDocument(doc, "WEB")).toBe("14: Web");
	});
});

describe("the assistant's instructions", () => {
	const t = stringsFor("en");

	it("are short when the model can call tools, and whole when it cannot", () => {
		const short = assistantInstructions(t, { way: "tools", tools: [tool] });
		expect(short.startsWith(IDENTITY)).toBe(true);
		expect(short).not.toContain('"nodes"');
		expect(short.length).toBeLessThan(SYSTEM_PROMPT.length / 2);
		const whole = assistantInstructions(t, { way: "none" });
		expect(whole.startsWith(SYSTEM_PROMPT)).toBe(true);
	});

	it("name the tools as a CLI calls them, and write blocks for one without MCP", () => {
		expect(assistantInstructions(t, { way: "mcp", tools: [tool] })).toContain("mcp__kalem__");
		expect(assistantInstructions(t, { way: "block", tools: [tool] })).toContain("```kalem-tool");
	});

	it("follow the mode, which leaves out the tools it does not need", () => {
		expect(assistantInstructions(t, { way: "tools", tools: [tool], mode: "review" })).toContain(
			"## Mode: review an analysis document",
		);
		expect(modeInstructions("nonsense")).toBe("");
		expect(modeExcluded("review").has("report_findings")).toBe(false);
		expect(modeExcluded("ask").has("report_findings")).toBe(true);
		expect(modeExcluded("ask").has("propose_edit")).toBe(false);
		expect(modeExcluded("write").has("propose_edit")).toBe(true);
	});
});
