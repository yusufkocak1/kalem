import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const REPLY = [
	"İşte akış:",
	"",
	"```kalem-diagram",
	JSON.stringify({
		title: "Onay akışı",
		nodes: [
			{ id: "a", shape: "terminal", text: "Başla" },
			{ id: "b", shape: "decision", text: "Uygun mu?" },
			{ id: "c", text: "Onayla" },
		],
		edges: [
			{ from: "a", to: "b" },
			{ from: "b", to: "c", text: "Evet" },
		],
	}),
	"```",
	"",
	"Bitti.",
].join("\n");

/**
 * A stand-in for the Claude Code CLI: answers `--version`, writes down how it
 * was run and what it was asked, and streams a reply the way the CLI does.
 */
export async function fakeClaude(
	folder: string,
	/** The reply, or replies by what the question holds: the first whose text is in it, else the last. */
	answer: string | readonly (readonly [string, string])[] = REPLY,
	/**
	 * Tools to call before answering, as Claude Code does: through the MCP
	 * server its `--mcp-config` names. What they return is written down
	 * with the call, and the calls show in the stream as tool uses.
	 */
	tools: readonly { readonly name: string; readonly input: Record<string, unknown> }[] = [],
): Promise<{ path: string; calls: () => Promise<Call[]> }> {
	const log = join(folder, "calls.jsonl");
	const script = join(folder, "fake-claude.cjs");
	await writeFile(
		script,
		`const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
	console.log("9.9.9 (Claude Code)");
	process.exit(0);
}
if (args.includes("--help")) {
	console.log("Usage: claude [options] [command] [prompt]\\n\\nOptions:\\n  -p, --print  Print response and exit\\n  --model <model>  Model for the current session. Provide an alias for the latest model (e.g. 'sonnet' or 'opus') or a\\n                   model's full name (e.g. 'claude-sonnet-4-5-20250929').\\n  --resume [value]  Resume a conversation");
	process.exit(0);
}
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (prompt += chunk));
const tools = ${JSON.stringify(tools)};
/** Calls the tools through the configured MCP server; their texts. */
async function callTools() {
	const at = args.indexOf("--mcp-config");
	if (tools.length === 0 || at === -1) return [];
	const config = JSON.parse(fs.readFileSync(args[at + 1], "utf8"));
	const [name, server] = Object.entries(config.mcpServers)[0];
	const child = require("node:child_process").spawn(server.command, server.args, {
		env: { ...process.env, ...server.env },
		stdio: ["pipe", "pipe", "inherit"],
	});
	const pending = new Map();
	let rest = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		rest += chunk;
		const lines = rest.split("\\n");
		rest = lines.pop();
		for (const line of lines) {
			if (line.trim() === "") continue;
			const message = JSON.parse(line);
			pending.get(message.id)?.(message);
		}
	});
	let next = 0;
	const ask = (method, params) =>
		new Promise((resolve) => {
			const id = ++next;
			pending.set(id, resolve);
			child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");
		});
	await ask("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake" } });
	const results = [];
	for (const tool of tools) {
		const allowed = args.includes("mcp__" + name + "__" + tool.name);
		const answer = await ask("tools/call", { name: tool.name, arguments: tool.input });
		results.push({ tool: "mcp__" + name + "__" + tool.name, allowed, text: answer.result.content[0].text });
	}
	child.stdin.end();
	return results;
}
process.stdin.on("end", async () => {
	const used = await callTools();
	const mcpAt = args.indexOf("--mcp-config");
	const mcp = mcpAt === -1 ? null : JSON.parse(fs.readFileSync(args[mcpAt + 1], "utf8"));
	fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, prompt, cwd: process.cwd(), tools: used, mcp }) + "\\n");
	const answers = ${JSON.stringify(answer)};
	const reply =
		typeof answers === "string"
			? answers
			: (answers.find(([needle]) => prompt.includes(needle)) ?? answers[answers.length - 1])[1];
	const out = (line) => process.stdout.write(JSON.stringify(line) + "\\n");
	// As Claude Code does, the first line names the model that answers: an alias's, or the default's.
	const alias = args.includes("--model") ? args[args.indexOf("--model") + 1] : "";
	const model = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", "": "claude-sonnet-5-5" }[alias] ?? alias;
	out({ type: "system", subtype: "init", session_id: "sess-1", model });
	if (used.length > 0) {
		const input = (i) => tools[i].input;
		out({ type: "assistant", message: { content: used.map((call, i) => ({ type: "tool_use", id: "t" + i, name: call.tool, input: input(i) })) }, session_id: "sess-1" });
	}
	out({ type: "stream_event", event: { type: "message_start" } });
	for (let i = 0; i < reply.length; i += 7) {
		out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: reply.slice(i, i + 7) } } });
	}
	out({ type: "assistant", message: { content: [{ type: "text", text: reply }] }, session_id: "sess-1" });
	out({ type: "result", subtype: "success", is_error: false, result: reply, session_id: "sess-1" });
});
`,
	);
	let path = script;
	if (process.platform === "win32") {
		// The npm shim form, which the app runs through Node.
		path = join(folder, "claude.cmd");
		await writeFile(path, `@ECHO off\r\nnode "%dp0%\\fake-claude.cjs" %*\r\n`);
	} else {
		path = join(folder, "claude");
		await writeFile(path, `#!/usr/bin/env node\nrequire(${JSON.stringify(script)});\n`);
		await chmod(path, 0o755);
	}
	return {
		path,
		calls: async () =>
			(await readFile(log, "utf8").catch(() => ""))
				.split("\n")
				.filter((line) => line !== "")
				.map((line) => JSON.parse(line) as Call),
	};
}

export interface Call {
	readonly args: string[];
	readonly prompt: string;
	readonly cwd: string;
	/** The tools called through the MCP server: their names, whether allowed, and what they returned. */
	readonly tools?: readonly {
		readonly tool: string;
		readonly allowed: boolean;
		readonly text: string;
	}[];
	/** The `--mcp-config` file's contents, when one was given. */
	readonly mcp?: { readonly mcpServers: Record<string, Record<string, unknown>> } | null;
}
