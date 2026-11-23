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
	 * server its `--mcp-config` names (the first, or the one named). What
	 * they return is written down with the call, and the calls show in the
	 * stream as tool uses.
	 */
	tools: readonly {
		readonly name: string;
		readonly input: Record<string, unknown>;
		readonly server?: string;
	}[] = [],
	options: {
		/** A run whose arguments hold this fails the first time, as a rate limit would. */
		readonly failOnce?: string;
		/** How long each run takes before it answers, in ms. */
		readonly delay?: number;
		/**
		 * The account's models, given in answer to Claude Code's `initialize`
		 * control request (how Kalem asks which models the account has).
		 * Without it the request goes unanswered, as an older Claude Code's.
		 */
		readonly accountModels?: readonly { readonly value: string; readonly displayName: string }[];
		/** How long the `initialize` answer takes, in ms. */
		readonly accountDelay?: number;
	} = {},
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
const accountModels = ${JSON.stringify(options.accountModels ?? null)};
// With --input-format stream-json Claude Code reads a JSON line per message as it comes, without
// waiting for its input to end, and answers it; a message that comes while it works is taken in.
const streaming = args.includes("--input-format") && args[args.indexOf("--input-format") + 1] === "stream-json";
const waiting = [];
let rest = "";
let inputEnded = false;
let wake = () => {};
process.stdin.on("data", (chunk) => {
	prompt += chunk;
	// Kalem asks for the account's models with an initialize control request.
	const request = prompt.split("\\n").find((line) => line.includes('"control_request"'));
	if (accountModels !== null && request !== undefined) {
		const id = JSON.parse(request).request_id;
		setTimeout(() => {
			process.stdout.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: id, response: { models: accountModels, commands: [] } } }) + "\\n");
			process.exit(0);
		}, ${JSON.stringify(options.accountDelay ?? 0)});
	}
	rest += chunk;
	const lines = rest.split("\\n");
	rest = lines.pop();
	for (const line of lines) {
		try {
			if (JSON.parse(line).type === "user") waiting.push(line + "\\n");
		} catch {}
	}
	wake();
});
process.stdin.on("end", () => {
	inputEnded = true;
	wake();
});
const until = async (ready) => {
	while (!ready()) await new Promise((resolve) => (wake = resolve));
};
/** A message's text, as a JSON line: its first text block. */
const textOf = (line) => {
	const content = JSON.parse(line).message.content;
	return typeof content === "string" ? content : (content.find((block) => block.type === "text")?.text ?? "");
};
const tools = ${JSON.stringify(tools)};
/** Calls the tools through the configured MCP servers; their texts. */
async function callTools() {
	const at = args.indexOf("--mcp-config");
	if (tools.length === 0 || at === -1) return [];
	const config = JSON.parse(fs.readFileSync(args[at + 1], "utf8"));
	const connections = new Map();
	const results = [];
	for (const tool of tools) {
		const [name, server] = tool.server ? [tool.server, config.mcpServers[tool.server]] : Object.entries(config.mcpServers)[0];
		if (!connections.has(name)) connections.set(name, await connect(server));
		const { ask } = connections.get(name);
		const allowed = args.includes("mcp__" + name + "__" + tool.name) || args.includes("mcp__" + name);
		const answer = await ask("tools/call", { name: tool.name, arguments: tool.input });
		results.push({ tool: "mcp__" + name + "__" + tool.name, allowed, text: answer.result ? answer.result.content[0].text : "error: " + answer.error.message });
	}
	for (const { end } of connections.values()) end();
	return results;
}
/** Starts a server as Claude Code does, greets it, and asks it things. */
async function connect(server) {
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
	return { ask, end: () => child.stdin.end() };
}
/** Answers one message; \`input\` is its JSON line, when it came as one. */
async function turn(prompt, input) {
	const options = ${JSON.stringify(options)};
	if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
	const failMark = ${JSON.stringify(join(folder, "failed-once"))};
	if (options.failOnce && args.join(" ").includes(options.failOnce) && !fs.existsSync(failMark)) {
		fs.writeFileSync(failMark, "");
		fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, prompt, cwd: process.cwd(), failed: true }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "rate limited", session_id: "sess-1" }) + "\\n");
		return;
	}
	const used = await callTools();
	const mcpAt = args.indexOf("--mcp-config");
	const mcp = mcpAt === -1 ? null : JSON.parse(fs.readFileSync(args[mcpAt + 1], "utf8"));
	// What came while it worked is taken in by this turn, as Claude Code takes in a message sent meanwhile.
	const added = streaming ? waiting.splice(0).map(textOf) : [];
	fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, prompt, ...(input === undefined ? {} : { input }), cwd: process.cwd(), tools: used, mcp, ...(added.length === 0 ? {} : { added }) }) + "\\n");
	const answers = ${JSON.stringify(answer)};
	const reply =
		(typeof answers === "string"
			? answers
			: (answers.find(([needle]) => prompt.includes(needle)) ?? answers[answers.length - 1])[1]) +
		added.map((text) => "\\n\\nEk: " + text).join("");
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
}
(async () => {
	if (!streaming) {
		await until(() => inputEnded);
		return turn(prompt);
	}
	await until(() => waiting.length > 0 || inputEnded);
	// No message, only a control request: answered as before, when its input ends.
	if (waiting.length === 0) return turn(prompt);
	// One turn a message; it exits once its input has ended and nothing is left.
	while (waiting.length > 0) {
		const line = waiting.shift();
		await turn(textOf(line), line);
		await until(() => waiting.length > 0 || inputEnded);
	}
})();
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
	/** It failed on purpose (`failOnce`). */
	readonly failed?: boolean;
	/** The message as the JSON line it came in, with `--input-format stream-json`. */
	readonly input?: string;
	/** What the user added while it worked, taken in by this turn. */
	readonly added?: readonly string[];
}
