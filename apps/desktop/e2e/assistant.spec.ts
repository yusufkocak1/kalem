import { chmod, readFile, writeFile } from "node:fs/promises";
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
	await clickMenu(app, "View", "Claude Assistant");
	const pane = page.locator(".assistant");
	await expect(pane).toBeVisible();
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await expect(pane.locator(".assistant-empty")).toContainText("Ask Claude about your document");

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
