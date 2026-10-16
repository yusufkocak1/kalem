import { chmod, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { parseDiagram } from "../src/shared/diagram.js";
import { clickMenu, launch, tempDir } from "./launch.js";

const REPLY = [
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
async function fakeClaude(folder: string): Promise<{ path: string; calls: () => Promise<Call[]> }> {
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
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (prompt += chunk));
process.stdin.on("end", () => {
	fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, prompt, cwd: process.cwd() }) + "\\n");
	const reply = ${JSON.stringify(REPLY)};
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

interface Call {
	readonly args: string[];
	readonly prompt: string;
	readonly cwd: string;
}

test("asks the local Claude about the document and inserts its reply with the diagram", async () => {
	const folder = await tempDir("assistant");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n\nGiriş\n");
	const claude = await fakeClaude(folder);
	const { app, page, errors } = await launch({ args: [doc], env: { KALEM_CLAUDE: claude.path } });

	await page.locator("#editor p", { hasText: "Giriş" }).click();
	await page.keyboard.press("End");
	await clickMenu(app, "View", "AI Assistant");
	const pane = page.locator(".assistant");
	await expect(pane).toBeVisible();
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await expect(pane.locator(".assistant-empty")).toContainText("Ask about your document");

	const input = pane.locator(".assistant-input");
	await input.fill("Onay sürecini çiz");
	await input.press("Enter");

	const reply = pane.locator(".assistant-assistant").last();
	await expect(reply.locator(".assistant-markdown").first()).toHaveText("İşte akış:");
	await expect(reply.locator(".assistant-diagram figcaption")).toHaveText("Onay akışı");
	await expect(reply.locator(".assistant-diagram img")).toBeVisible();
	await expect(reply.locator(".assistant-markdown").last()).toHaveText("Bitti.");
	await expect(pane.locator(".assistant-user")).toContainText("Onay sürecini çiz");
	await expect(pane.locator(".assistant-user .assistant-notes")).toHaveText("with “notlar.md”");

	// Claude got Kalem's instructions, the document and the question, and ran next to the document.
	const [first] = await claude.calls();
	expect(first?.args).toContain("--append-system-prompt");
	expect(first?.args).toContain("stream-json");
	expect(first?.args).not.toContain("--resume");
	expect(first?.prompt).toContain('<document name="notlar.md">\n# Notlar\n\nGiriş\n</document>');
	expect(first?.prompt.endsWith("Onay sürecini çiz")).toBe(true);
	expect(first?.cwd).toBe(folder);

	// The whole reply goes in at the caret, the diagram as a picture with its data next to it.
	await reply.locator(".assistant-actions").last().getByRole("button", { name: "Insert" }).click();
	const image = page.locator("#editor img");
	await expect(image).toHaveAttribute("src", "notlar.assets/Onay-ak%C4%B1%C5%9F%C4%B1.diagram.png");
	await expect(page.locator("#editor p", { hasText: "Bitti." })).toBeVisible();
	const data = parseDiagram(
		await readFile(join(folder, "notlar.assets", "Onay-akışı.diagram.json"), "utf8"),
	);
	expect(data?.nodes.map((node) => node.text)).toEqual(["Başla", "Uygun mu?", "Onayla"]);
	expect(data?.edges.map((edge) => edge.text)).toEqual(["", "Evet"]);

	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");
	const saved = await readFile(doc, "utf8");
	expect(saved).toContain("İşte akış:");
	expect(saved).toContain("![Onay akışı](notlar.assets/Onay-ak%C4%B1%C5%9F%C4%B1.diagram.png)");
	expect(saved).toContain("Bitti.");
	expect(saved).not.toContain("kalem-diagram");

	// The next question continues the conversation; the changed document goes along with it,
	// and the diagram now in it is given to Claude to read.
	await input.fill("Bir adım ekle");
	await input.press("Enter");
	await expect(pane.locator(".assistant-assistant")).toHaveCount(2);
	await expect(
		pane.locator(".assistant-assistant").last().locator(".assistant-diagram"),
	).toBeVisible();
	const second = (await claude.calls())[1];
	expect(second?.args.slice(-2)).toEqual(["--resume", "sess-1"]);
	expect(second?.prompt).toContain(
		'<diagram src="notlar.assets/Onay-ak%C4%B1%C5%9F%C4%B1.diagram.png">',
	);

	// Without sharing, only the question goes.
	await pane.getByLabel("Share the document").uncheck();
	await input.fill("Teşekkürler");
	await input.press("Enter");
	await expect(pane.locator(".assistant-assistant")).toHaveCount(3);
	await expect.poll(async () => (await claude.calls())[2]?.prompt).toBe("Teşekkürler");

	expect(errors).toEqual([]);
	await app.close();
});

test("explains how to install Claude Code when it is not found", async () => {
	const folder = await tempDir("assistant-missing");
	const { app, page } = await launch({
		settings: { assistant: true },
		env: { KALEM_CLAUDE: join(folder, "nothing-here") },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-missing")).toContainText(
		"Claude Code was not found on this computer",
	);
	await expect(pane.locator(".assistant-command")).toHaveText(
		"npm install -g @anthropic-ai/claude-code",
	);
	await expect(pane.locator(".assistant-input")).toBeDisabled();
	await app.close();
});

interface Received {
	readonly path: string;
	readonly headers: IncomingMessage["headers"];
	readonly body: Record<string, unknown>;
}

/** A local stand-in for an OpenAI-compatible service and the Anthropic API, streaming REPLY. */
async function fakeServices(): Promise<{ url: string; received: Received[]; close(): void }> {
	const received: Received[] = [];
	const chunks = (text: string): string[] => text.match(/[\s\S]{1,9}/g) ?? [];
	const sse = (response: ServerResponse, events: readonly [string | null, unknown][]): void => {
		response.writeHead(200, { "content-type": "text/event-stream" });
		for (const [event, data] of events) {
			response.write(
				`${event === null ? "" : `event: ${event}\n`}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
			);
		}
		response.end();
	};
	const server = createServer((request, response) => {
		let raw = "";
		request.on("data", (chunk: Buffer) => {
			raw += chunk.toString("utf8");
		});
		request.on("end", () => {
			const path = (request.url ?? "").replace(/\?.*$/, "");
			received.push({ path, headers: request.headers, body: raw === "" ? {} : JSON.parse(raw) });
			if (request.method === "GET" && path === "/v1/models") {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						data: ["fake-small", "fake-large"].map((id) => ({
							id,
							type: "model",
							display_name: id,
							created_at: "2026-01-01T00:00:00Z",
						})),
						has_more: false,
						first_id: "fake-small",
						last_id: "fake-large",
					}),
				);
			} else if (path === "/v1/chat/completions") {
				sse(response, [
					...chunks(REPLY).map((text): [null, unknown] => [
						null,
						{ choices: [{ delta: { content: text } }] },
					]),
					[null, "[DONE]"],
				]);
			} else if (path === "/v1/messages") {
				const message = {
					id: "msg_1",
					type: "message",
					role: "assistant",
					model: "claude-opus-5-5",
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 10, output_tokens: 1 },
				};
				sse(response, [
					["message_start", { type: "message_start", message }],
					[
						"content_block_start",
						{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
					],
					...chunks(REPLY).map((text): [string, unknown] => [
						"content_block_delta",
						{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
					]),
					["content_block_stop", { type: "content_block_stop", index: 0 }],
					[
						"message_delta",
						{
							type: "message_delta",
							delta: { stop_reason: "end_turn", stop_sequence: null },
							usage: { output_tokens: 20 },
						},
					],
					["message_stop", { type: "message_stop" }],
				]);
			} else {
				response.writeHead(404, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: `No route ${path}` } }));
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return { url: `http://127.0.0.1:${port}`, received, close: () => server.close() };
}

test("connects to an OpenAI-compatible service and to the Anthropic API with a key", async () => {
	const services = await fakeServices();
	const folder = await tempDir("assistant-api");
	const doc = join(folder, "plan.md");
	await writeFile(doc, "# Plan\n");
	const { app, page, userData, errors } = await launch({
		args: [doc],
		settings: { assistant: true },
		env: {
			KALEM_CLAUDE: join(folder, "nothing-here"),
			NO_PROXY: "127.0.0.1",
			no_proxy: "127.0.0.1",
		},
	});
	const pane = page.locator(".assistant");
	await pane.getByRole("button", { name: "Connect a Service…" }).click();

	// An OpenAI-compatible service at an address of its own; its models are listed.
	const form = pane.locator(".assistant-settings");
	await form.getByLabel("Service").selectOption("custom");
	await form.getByLabel("Address").fill(`${services.url}/v1`);
	await form.getByLabel("API key").fill("sk-test");
	await form.getByRole("button", { name: "Fetch models" }).click();
	await expect(form.locator(".assistant-field-note[role=status]")).toHaveText(
		"2 models found; pick one in the model field.",
	);
	await expect(form.locator("#assistant-models option")).toHaveCount(2);
	await form.getByLabel("Model").fill("fake-large");
	await form.getByRole("button", { name: "Save" }).click();
	await expect(form).toBeHidden();
	await expect(pane.locator(".assistant-subtitle")).toHaveText(
		"Other (OpenAI-compatible) · fake-large",
	);

	const input = pane.locator(".assistant-input");
	await input.fill("Planı çiz");
	await input.press("Enter");
	await expect(pane.locator(".assistant-assistant .assistant-diagram figcaption")).toHaveText(
		"Onay akışı",
	);
	await expect(pane.getByRole("button", { name: "Insert", exact: true })).toBeVisible();
	const first = services.received.find((request) => request.path === "/v1/chat/completions");
	expect(first?.headers.authorization).toBe("Bearer sk-test");
	expect(first?.body.model).toBe("fake-large");
	const sent = first?.body.messages as { role: string; content: string }[];
	expect(sent.map((message) => message.role)).toEqual(["system", "user"]);
	expect(sent[0]?.content).toContain("Kalem diagrams");
	expect(sent[0]?.content).toContain('"File" → "Export"');
	expect(sent[1]?.content).toContain('<document name="plan.md">');

	// The service keeps no conversation: what was said goes again with the next question.
	await input.fill("Kısalt");
	await input.press("Enter");
	await expect(pane.locator(".assistant-assistant")).toHaveCount(2);
	await expect(pane.getByRole("button", { name: "Insert", exact: true })).toHaveCount(2);
	const second = services.received.filter((request) => request.path === "/v1/chat/completions")[1];
	const history = second?.body.messages as { role: string; content: string }[];
	expect(history.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
	expect(history[2]?.content).toBe(REPLY);
	expect(await readFile(join(userData, "assistant.json"), "utf8")).not.toContain("sk-test");

	// The Anthropic API, through its SDK; a new service starts a new chat.
	await pane.getByRole("button", { name: "Connection settings" }).click();
	await form.getByLabel("Service").selectOption("anthropic");
	await expect(form.getByLabel("Model")).toHaveValue("claude-opus-5-5");
	await form.getByLabel("Address").fill(services.url);
	await form.getByLabel("API key").fill("sk-ant-test");
	await form.getByRole("button", { name: "Save" }).click();
	await expect(pane.locator(".assistant-subtitle")).toHaveText(
		"Anthropic (Claude API) · claude-opus-5-5",
	);
	await expect(pane.locator(".assistant-assistant")).toHaveCount(0);
	await input.fill("Planı çiz");
	await input.press("Enter");
	await expect(pane.locator(".assistant-assistant .assistant-diagram figcaption")).toHaveText(
		"Onay akışı",
	);
	const anthropic = services.received.find((request) => request.path === "/v1/messages");
	expect(anthropic?.headers["x-api-key"]).toBe("sk-ant-test");
	expect(anthropic?.body.model).toBe("claude-opus-5-5");
	expect(anthropic?.body.stream).toBe(true);
	expect(String(anthropic?.body.system)).toContain("Kalem diagrams");

	expect(errors).toEqual([]);
	await app.close();
	services.close();
});

test("asks for setup when an API service has no key yet", async () => {
	const { app, page } = await launch({ settings: { assistant: true } });
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).not.toHaveText("Looking for Claude Code…");
	await pane.getByRole("button", { name: "Connection settings" }).click();
	const form = pane.locator(".assistant-settings");
	await form.getByLabel("Service").selectOption("openai");
	await expect(form.getByLabel("API key")).toHaveAttribute("placeholder", "Required");
	await form.getByLabel("Model").fill("some-model");
	await form.getByRole("button", { name: "Save" }).click();
	await expect(pane.locator(".assistant-missing")).toContainText(
		"Choose a service for the assistant",
	);
	await expect(pane.locator(".assistant-input")).toBeDisabled();
	await app.close();
});
