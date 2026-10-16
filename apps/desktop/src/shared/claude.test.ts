import { describe, expect, it } from "vitest";
import type { ClaudeEvent } from "./claude.js";
import {
	ClaudeStreamReader,
	claudeArgs,
	composePrompt,
	copilotArgs,
	DIAGRAM_FENCE,
	diagramForPrompt,
	diagramFromReply,
	LineSplitter,
	SYSTEM_PROMPT,
	splitReply,
	systemPrompt,
	withInstructions,
} from "./claude.js";
import { ancestors, SHAPES } from "./diagram.js";
import { stringsFor } from "./i18n.js";

const read = (lines: readonly unknown[]): ClaudeEvent[] => {
	const reader = new ClaudeStreamReader();
	return lines.flatMap((line) => reader.feed(JSON.stringify(line)));
};

const text = (events: readonly ClaudeEvent[]): string =>
	events.map((event) => (event.kind === "text" ? event.text : "")).join("");

const delta = (value: string) => ({
	type: "stream_event",
	event: { type: "content_block_delta", delta: { type: "text_delta", text: value } },
});
const assistant = (...blocks: unknown[]) => ({ type: "assistant", message: { content: blocks } });
const start = { type: "stream_event", event: { type: "message_start" } };
const success = (result = "") => ({ type: "result", subtype: "success", is_error: false, result });

describe("the system prompt", () => {
	it("teaches every shape and the diagram fence", () => {
		for (const shape of SHAPES) expect(SYSTEM_PROMPT).toContain(`"${shape}"`);
		expect(SYSTEM_PROMPT).toContain(`\`\`\`${DIAGRAM_FENCE}`);
		expect(SYSTEM_PROMPT).toContain("mermaid");
		expect(SYSTEM_PROMPT).toContain("math");
	});

	it("has an example diagram that Kalem reads", () => {
		const example = /```kalem-diagram\n([\s\S]*?)\n```/.exec(SYSTEM_PROMPT)?.[1] ?? "";
		const reply = diagramFromReply(example);
		expect(reply?.title).toBe("Order flow");
		expect(reply?.diagram.nodes).toHaveLength(5);
		expect(reply?.diagram.edges).toHaveLength(5);
	});
});

describe("CLI arguments", () => {
	it("streams JSON, adds Kalem's instructions and keeps file tools away", () => {
		const args = claudeArgs({ sessionId: null });
		expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "stream-json"]);
		expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(SYSTEM_PROMPT);
		expect(args).toContain("Bash");
		expect(args).toContain("Write");
		expect(args).not.toContain("--resume");
	});

	it("asks for a model when one is picked", () => {
		const args = claudeArgs({ sessionId: "s", model: "sonnet" });
		expect(args.join(" ")).toContain("--model sonnet --resume s");
		expect(claudeArgs({ sessionId: null, model: "" })).not.toContain("--model");
	});

	it("resumes a conversation", () => {
		const args = claudeArgs({ sessionId: "abc-123" });
		expect(args.slice(-2)).toEqual(["--resume", "abc-123"]);
	});
});

describe("Copilot CLI arguments", () => {
	it("writes only the answer, may not run commands or write files, and keeps the session", () => {
		const args = copilotArgs({ sessionId: "s-1", model: "" });
		expect(args.slice(0, 3)).toEqual(["-s", "--stream", "on"]);
		expect(args.join(" ")).toContain("--deny-tool shell --deny-tool write");
		expect(args.slice(-2)).toEqual(["--session-id", "s-1"]);
		expect(args).not.toContain("-p");
		expect(copilotArgs({ sessionId: "s-1", model: "gpt-5" }).slice(-2)).toEqual([
			"--model",
			"gpt-5",
		]);
	});

	it("puts the instructions before a conversation's first question", () => {
		expect(withInstructions("KURALLAR", "Soru")).toBe(
			"<instructions>\nKURALLAR\n</instructions>\n\nSoru",
		);
	});
});

describe("reading the stream", () => {
	it("passes on text deltas and the session, without repeating the whole message", () => {
		const events = read([
			{ type: "system", subtype: "init", session_id: "s1" },
			start,
			delta("Mer"),
			delta("haba"),
			assistant({ type: "text", text: "Merhaba" }),
			{ ...success("Merhaba"), session_id: "s1" },
		]);
		expect(events[0]).toEqual({ kind: "session", id: "s1" });
		expect(text(events)).toBe("Merhaba");
		expect(events.at(-1)).toEqual({ kind: "done" });
	});

	it("uses whole messages from a CLI that sends no deltas, apart by a blank line", () => {
		const events = read([
			assistant({ type: "text", text: "First." }),
			assistant({ type: "tool_use", id: "t", name: "Read", input: {} }),
			assistant({ type: "text", text: "Second." }),
			success("Second."),
		]);
		expect(text(events)).toBe("First.\n\nSecond.");
	});

	it("keeps the messages of one turn apart", () => {
		const events = read([start, delta("One"), start, delta("Two"), success()]);
		expect(text(events)).toBe("One\n\nTwo");
	});

	it("falls back to the result when nothing streamed", () => {
		expect(text(read([success("Only the result")]))).toBe("Only the result");
	});

	it("reports an error result", () => {
		const events = read([
			{
				type: "result",
				subtype: "success",
				is_error: true,
				result: "Invalid API key · Please run /login",
			},
		]);
		expect(events).toEqual([{ kind: "error", message: "Invalid API key · Please run /login" }]);
	});

	it("ignores lines that are not JSON", () => {
		const reader = new ClaudeStreamReader();
		expect(reader.feed("not json")).toEqual([]);
		expect(reader.finished).toBe(false);
	});
});

describe("line splitting", () => {
	it("waits for the end of a line", () => {
		const lines = new LineSplitter();
		expect(lines.push('{"a":')).toEqual([]);
		expect(lines.push('1}\r\n{"b":2}\n\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
		expect(lines.end()).toEqual(['{"c"']);
	});
});

describe("the question", () => {
	it("puts the document, diagrams and selection before the question", () => {
		const prompt = composePrompt({
			question: "  Özetle  ",
			document: { name: 'a "b".md', text: "# Başlık" },
			selection: "seçili",
			diagrams: [
				{
					src: "a.assets/d.diagram.png",
					diagram: {
						nodes: [
							{
								id: "n1",
								shape: "process",
								x: 0,
								y: 0,
								w: 160,
								h: 70,
								text: "Adım",
								color: "default",
							},
						],
						edges: [],
					},
				},
			],
		});
		expect(prompt).toBe(
			[
				'<document name="a &quot;b&quot;.md">\n# Başlık\n</document>',
				'<diagram src="a.assets/d.diagram.png">\n{"nodes":[{"id":"n1","shape":"process","x":0,"y":0,"w":160,"h":70,"text":"Adım"}],"edges":[]}\n</diagram>',
				"<selection>\nseçili\n</selection>",
				"Özetle",
			].join("\n\n"),
		);
	});

	it("says when the shared document has not changed", () => {
		const prompt = composePrompt({ question: "Devam", documentUnchanged: true });
		expect(prompt).toContain("<document-unchanged>");
		expect(prompt.endsWith("Devam")).toBe(true);
	});

	it("is only the question without context", () => {
		expect(composePrompt({ question: "Merhaba", selection: "  " })).toBe("Merhaba");
	});

	it("cuts a very long document", () => {
		const prompt = composePrompt({
			question: "?",
			document: { name: "x", text: "a".repeat(250_000) },
		});
		expect(prompt.length).toBeLessThan(201_000);
		expect(prompt).toContain("more characters left out");
	});
});

describe("diagrams in a reply", () => {
	it("fills in what Claude leaves out and lays the flow out top-down", () => {
		const reply = diagramFromReply(
			JSON.stringify({
				title: "Akış",
				nodes: [
					{ id: "a", shape: "terminal", text: "Başla" },
					{ id: "b", shape: "decision", text: "Uygun mu?" },
					{ id: "c", text: "Onayla" },
					{ id: "d", text: "Reddet", color: "red" },
				],
				edges: [
					{ from: "a", to: "b" },
					{ from: "b", to: "c", text: "Evet" },
					{ from: "b", to: "d", text: "Hayır" },
				],
			}),
		);
		expect(reply).not.toBeNull();
		const { diagram, title, src } = reply as NonNullable<typeof reply>;
		expect(title).toBe("Akış");
		expect(src).toBeNull();
		expect(diagram.edges.map((edge) => edge.id)).toEqual(["e1", "e2", "e3"]);
		const at = Object.fromEntries(diagram.nodes.map((node) => [node.id, node]));
		expect(at.c?.shape).toBe("process");
		expect(at.d?.color).toBe("red");
		// Each row below the one before; the two answers side by side.
		expect(at.b?.y).toBeGreaterThan(at.a?.y ?? 0);
		expect(at.c?.y).toBe(at.d?.y);
		expect(at.c?.y).toBeGreaterThan(at.b?.y ?? 0);
		expect(at.c?.x).toBeLessThan(at.d?.x ?? 0);
	});

	it("keeps coordinates that are given for every node", () => {
		const reply = diagramFromReply(
			JSON.stringify({
				nodes: [
					{ id: "a", text: "A", x: 500, y: 40 },
					{ id: "b", text: "B", x: 100, y: 40 },
				],
				edges: [{ id: "a", from: "a", to: "b" }],
			}),
		);
		expect(reply?.diagram.nodes.map((node) => [node.x, node.y])).toEqual([
			[500, 40],
			[100, 40],
		]);
		// An edge id that is a node's id is replaced.
		expect(reply?.diagram.edges[0]?.id).toBe("e1");
	});

	it("puts a group around its contents", () => {
		const reply = diagramFromReply(
			JSON.stringify({
				nodes: [
					{ id: "api", shape: "process", text: "API" },
					{ id: "svc", shape: "group", text: "Backend" },
					{ id: "h", text: "Handler", parent: "svc" },
					{ id: "db", shape: "database", text: "DB", parent: "svc" },
				],
				edges: [
					{ from: "api", to: "svc" },
					{ from: "h", to: "db" },
				],
			}),
		);
		const diagram = reply?.diagram;
		expect(diagram).toBeDefined();
		if (diagram === undefined) return;
		const at = Object.fromEntries(diagram.nodes.map((node) => [node.id, node]));
		const group = at.svc;
		expect(group).toBeDefined();
		if (group === undefined) return;
		for (const id of ["h", "db"]) {
			const inner = at[id];
			expect(ancestors(diagram, id)).toEqual(["svc"]);
			expect(inner?.x).toBeGreaterThan(group.x);
			expect(inner?.y).toBeGreaterThan(group.y);
			expect((inner?.x ?? 0) + (inner?.w ?? 0)).toBeLessThan(group.x + group.w);
			expect((inner?.y ?? 0) + (inner?.h ?? 0)).toBeLessThan(group.y + group.h);
		}
		expect(at.db?.y).toBeGreaterThan(at.h?.y ?? 0);
		expect(group.y).toBeGreaterThan(at.api?.y ?? 0);
	});

	it("is not a diagram without nodes, or when the JSON is broken", () => {
		expect(diagramFromReply('{"nodes": []}')).toBeNull();
		expect(diagramFromReply('{"nodes": [{"id": "a",}]}')).toBeNull();
		expect(diagramFromReply("[1, 2]")).toBeNull();
	});

	it("names the document's diagram it updates", () => {
		const reply = diagramFromReply(
			'{"src": "a.assets/d.diagram.png", "nodes": [{"id": "a", "text": "A"}], "edges": []}',
		);
		expect(reply?.src).toBe("a.assets/d.diagram.png");
	});

	it("reads back what it gives Claude", () => {
		const first = diagramFromReply(
			'{"nodes": [{"id": "a", "text": "A", "color": "blue"}, {"id": "b", "shape": "mux", "direction": "down"}], "edges": [{"from": "a", "to": "b", "dashed": true, "arrow": "both"}]}',
		);
		expect(first).not.toBeNull();
		if (first === null) return;
		const again = diagramFromReply(diagramForPrompt(first.diagram));
		expect(again?.diagram).toEqual(first.diagram);
	});
});

describe("splitting a reply", () => {
	it("cuts out the diagrams and keeps the Markdown around them", () => {
		const reply = [
			"Akış şöyle:",
			"",
			"```kalem-diagram",
			'{"title": "T", "nodes": [{"id": "a", "text": "A"}]}',
			"```",
			"",
			"```mermaid",
			"graph TD; A-->B",
			"```",
			"",
			"````kalem-diagram",
			"not json",
			"````",
		].join("\n");
		const parts = splitReply(reply);
		expect(parts.map((part) => part.kind)).toEqual(["markdown", "diagram", "markdown"]);
		expect(parts[0]).toEqual({ kind: "markdown", text: "Akış şöyle:\n\n" });
		expect(parts[1]?.kind === "diagram" && parts[1].title).toBe("T");
		// A Mermaid block and a broken diagram stay Markdown.
		expect(parts[2]?.kind === "markdown" && parts[2].text).toContain("```mermaid");
		expect(parts[2]?.kind === "markdown" && parts[2].text).toContain("not json");
	});

	it("leaves a diagram that is still being written as text", () => {
		const parts = splitReply('Bakın:\n\n```kalem-diagram\n{"nodes": [');
		expect(parts).toEqual([{ kind: "markdown", text: 'Bakın:\n\n```kalem-diagram\n{"nodes": [' }]);
	});

	it("is empty for an empty reply", () => {
		expect(splitReply("  \n")).toEqual([]);
	});
});

describe("what Claude is told about the app", () => {
	it("names menus in the interface's language", () => {
		const tr = systemPrompt(stringsFor("tr"));
		expect(tr.startsWith(SYSTEM_PROMPT)).toBe(true);
		expect(tr).toContain('"Dosya" → "Dışa Aktar" → "Word (.docx)"');
		expect(tr).toContain('"Ekle" → "Görsel"');
		expect(tr).toContain("<!-- kalem:table color=blue widths=120,,200 -->");
		expect(systemPrompt(stringsFor("en"))).toContain('"File" → "Version History"');
	});

	it("is what the CLI gets", () => {
		const prompt = systemPrompt(stringsFor("en"));
		const args = claudeArgs({ sessionId: null, systemPrompt: prompt });
		expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(prompt);
	});
});
