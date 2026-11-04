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
process.stdin.on("end", () => {
	fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, prompt, cwd: process.cwd() }) + "\\n");
	const answers = ${JSON.stringify(answer)};
	const reply =
		typeof answers === "string"
			? answers
			: (answers.find(([needle]) => prompt.includes(needle)) ?? answers[answers.length - 1])[1];
	const out = (line) => process.stdout.write(JSON.stringify(line) + "\\n");
	out({ type: "system", subtype: "init", session_id: "sess-1" });
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
}
