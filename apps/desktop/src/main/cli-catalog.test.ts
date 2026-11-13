import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() }, shell: {} }));

const { askClaude, askCopilot, CliCatalog } = await import("./cli-catalog.js");

/** A CLI made of a Node script: it answers as the real one does. */
async function fakeCli(script: string) {
	const folder = await mkdtemp(join(tmpdir(), "kalem-fake-cli-"));
	const path = join(folder, "cli.cjs");
	await writeFile(path, script);
	return { command: process.execPath, prefix: [path], path };
}

const CLAUDE = `
let rest = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	rest += chunk;
	for (const line of rest.split("\\n").slice(0, -1)) {
		const asked = JSON.parse(line);
		console.log(JSON.stringify({ type: "system", subtype: "status" }));
		console.log(JSON.stringify({
			type: "control_response",
			response: {
				subtype: "success",
				request_id: asked.request_id,
				response: {
					models: [
						{ value: "default", displayName: "Default (recommended)" },
						{ value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5" },
						{ value: "claude-sonnet-4-6", displayName: "Sonnet 4.6" },
					],
					commands: [
						{ name: "clear", builtin: true },
						{ name: "docs-kit:outline", description: "Outline", argumentHint: "[topic]" },
					],
				},
			},
		}));
	}
	rest = rest.split("\\n").at(-1);
});
`;

const COPILOT = `
let buffer = Buffer.alloc(0);
const send = (message) => {
	const body = JSON.stringify(message);
	process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
};
process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	for (;;) {
		const end = buffer.indexOf("\\r\\n\\r\\n");
		if (end === -1) return;
		const size = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1]);
		if (buffer.length < end + 4 + size) return;
		const asked = JSON.parse(buffer.subarray(end + 4, end + 4 + size).toString());
		buffer = buffer.subarray(end + 4 + size);
		if (asked.method === "connect") send({ jsonrpc: "2.0", id: asked.id, result: { protocolVersion: 3 } });
		else if (asked.method === "models.list")
			send({ jsonrpc: "2.0", id: asked.id, result: { models: [
				{ id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", policy: { state: "enabled" } },
				{ id: "gpt-5", name: "GPT-5 ü", policy: { state: "unconfigured" } },
				{ id: "o-old", name: "Old", policy: { state: "disabled" } },
			] } });
	}
});
`;

describe("what the CLIs say the account has", () => {
	it("asks Claude Code with an initialize request: its models and the plugins' commands", async () => {
		const launch = await fakeCli(CLAUDE);
		const account = await new CliCatalog().claude(launch);
		expect(account.models).toEqual([
			{ id: "opus", label: "opus · Opus 5.5" },
			{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
		]);
		expect(account.commands).toEqual([
			{ name: "docs-kit:outline", description: "Outline", argument: "[topic]" },
		]);
	});

	it("asks the Copilot CLI as its SDK does: connect, then models.list", async () => {
		const launch = await fakeCli(COPILOT);
		expect(await new CliCatalog().copilot(launch)).toEqual([
			{ id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
			{ id: "gpt-5", label: "GPT-5 ü" },
		]);
	});

	it("gives up on a CLI that does not answer, and says nothing", async () => {
		const launch = await fakeCli("process.exit(3);");
		await expect(askClaude(launch)).rejects.toThrow();
		await expect(askCopilot(launch)).rejects.toThrow();
		expect(await new CliCatalog().copilot(launch)).toEqual([]);
	});
});
