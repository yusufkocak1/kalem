import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Call } from "./fake-claude.js";
import { fakeClaude } from "./fake-claude.js";
import { clickMenu, launch, stubMessageBox, tempDir } from "./launch.js";

/**
 * A stand-in for the GitHub Copilot CLI that answers by what the question
 * holds (the first answer whose needle is in it, else the last). With
 * `mcp`, its help offers `--additional-mcp-config`, and a run given one
 * fails as a Copilot that cannot start the server would.
 */
async function fakeCopilot(
	folder: string,
	answers: readonly (readonly [string, string])[],
	mcp = false,
): Promise<{ path: string; calls: () => Promise<Call[]> }> {
	const log = join(folder, "copilot-calls.jsonl");
	const script = join(folder, "fake-copilot.cjs");
	await writeFile(
		script,
		`const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
	console.log("9.9.9-copilot");
	process.exit(0);
}
if (args.includes("--help")) {
	console.log("Usage: copilot [options]\\n  -s, --silent  Output only the agent response${mcp ? "\\n  --additional-mcp-config <json>  More MCP servers" : ""}");
	process.exit(0);
}
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (prompt += chunk));
process.stdin.on("end", () => {
	fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, prompt, cwd: process.cwd() }) + "\\n");
	if (args.includes("--additional-mcp-config")) {
		process.stderr.write("Error: failed to start MCP server kalem");
		process.exit(1);
	}
	const answers = ${JSON.stringify(answers)};
	const reply = (answers.find(([needle]) => prompt.includes(needle)) ?? answers[answers.length - 1])[1];
	process.stdout.write(reply);
});
`,
	);
	const path = join(folder, "copilot");
	await writeFile(path, `#!/usr/bin/env node\nrequire(${JSON.stringify(script)});\n`);
	await chmod(path, 0o755);
	return {
		path,
		calls: async () =>
			(await readFile(log, "utf8").catch(() => ""))
				.split("\n")
				.filter((line) => line !== "")
				.map((line) => JSON.parse(line) as Call),
	};
}

const isDark = (page: import("@playwright/test").Page) =>
	page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);

test.skip(process.platform === "win32", "The stand-in CLIs are Unix scripts.");

test("Claude Code changes a setting through Kalem's tools once the user allows it", async () => {
	const folder = await tempDir("agent-settings");
	const claude = await fakeClaude(folder, "Koyu temaya geçtim.", [
		{ name: "settings_find", input: { query: "koyu tema" } },
		{
			name: "settings_set",
			input: { changes: [{ key: "theme", value: "dark" }], reason: "koyu tema" },
		},
		{ name: "pane_move", input: { pane: "files", place: "bottom" } },
	]);
	const { app, page, userData, errors } = await launch({
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await pane.locator(".assistant-input").fill("Koyu temaya geç, dosyaları alta al");
	await pane.locator(".assistant-input").press("Enter");

	// The CLI waits on its tool call while the user is asked in the panel.
	const card = pane.locator(".assistant-approval").first();
	await expect(card).toContainText("Change settings");
	await expect(card).toContainText("Theme: Light → Dark");
	await expect(card).toContainText("Why: koyu tema");
	await card.locator(".assistant-approval-scope").selectOption("always");
	await card.getByRole("button", { name: "Allow" }).click();
	await expect.poll(() => isDark(page)).toBe(true);

	const second = pane.locator(".assistant-approval").nth(1);
	await expect(second).toContainText("Files: Left → Bottom");
	await second.getByRole("button", { name: "Deny" }).click();
	await expect(second).toContainText("Denied");

	const reply = pane.locator(".assistant-assistant").last();
	await expect(reply.locator(".assistant-markdown")).toContainText("Koyu temaya geçtim.");
	const [call] = await claude.calls();
	expect(call?.args).toEqual(
		expect.arrayContaining(["mcp__kalem__settings_set", "mcp__kalem__pane_move"]),
	);
	const [found, set, moved] = call?.tools ?? [];
	expect(found?.text).toContain('- theme: "Theme" (appearance) = "light"');
	expect(set?.text).toBe("Changed: Theme: Light → Dark.");
	expect(moved?.text).toBe("The user did not allow it. Do not try again.");
	// The short instructions: the guides are asked for when needed.
	const system = call?.args[call.args.indexOf("--append-system-prompt") + 1] ?? "";
	expect(system).toContain("You are the AI assistant inside Kalem");
	expect(system).not.toContain('"nodes"');

	// What was allowed always is kept; the change can be undone from the reply.
	await expect
		.poll(async () => JSON.parse(await readFile(join(userData, "settings.json"), "utf8")).settings)
		.toMatchObject({ theme: "dark", assistantPermissions: ["settings:appearance"] });
	await reply.locator(".assistant-change").getByRole("button", { name: "Undo" }).click();
	await expect.poll(() => isDark(page)).toBe(false);
	await expect(reply.locator(".assistant-change")).toContainText("Undone");

	// The always-allowed kinds are listed in the settings, and can be taken back.
	await clickMenu(app, "File", "Settings…");
	const dialog = page.locator(".settings-dialog");
	await dialog.locator('[data-category="assistant"]').click();
	const allowed = dialog.locator('[data-block="permissions"]');
	await expect(allowed).toContainText("Settings: Appearance");
	await allowed.getByRole("button", { name: "Remove" }).click();
	await expect(allowed).toContainText("Nothing is allowed always");
	expect(errors).toEqual([]);
	await app.close();
});

test("Copilot without MCP calls Kalem's tools in blocks and changes the document once allowed", async () => {
	const folder = await tempDir("agent-copilot");
	const doc = join(folder, "analiz.md");
	await writeFile(doc, "# Analiz\n\nİptal işlemi hızlı yapılmalı.\n");
	const block = [
		"Düzeltiyorum.",
		"",
		"```kalem-tool",
		JSON.stringify([
			{
				tool: "document_edit",
				input: {
					actions: [
						{ type: "replace", find: "hızlı yapılmalı", replace: "2 saniye içinde onaylanmalı" },
					],
					reason: "ölçülebilir olsun",
				},
			},
		]),
		"```",
	].join("\n");
	const copilot = await fakeCopilot(folder, [
		['<result tool="document_edit">', "Gereksinim artık ölçülebilir."],
		["", block],
	]);
	const { app, page, errors } = await launch({
		args: [doc],
		settings: { assistant: true },
		env: { KALEM_COPILOT: copilot.path, KALEM_CLAUDE: join(folder, "none") },
	});
	const pane = page.locator(".assistant");
	await pane.getByRole("button", { name: "Connection settings" }).click();
	await pane.locator(".assistant-settings").getByLabel("Service").selectOption("copilot");
	await pane.locator(".assistant-settings").getByRole("button", { name: "Save" }).click();
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9-copilot");

	await pane.locator(".assistant-input").fill("İptal gereksinimini ölçülebilir yap");
	await pane.locator(".assistant-input").press("Enter");
	const card = pane.locator(".assistant-approval");
	await expect(card).toContainText("Change “analiz.md”");
	await expect(card.locator(".assistant-approval-preview")).toContainText("- hızlı yapılmalı");
	await expect(card.locator(".assistant-approval-preview")).toContainText(
		"+ 2 saniye içinde onaylanmalı",
	);
	await card.getByRole("button", { name: "Allow" }).click();
	await expect(page.locator("#editor p")).toHaveText("İptal işlemi 2 saniye içinde onaylanmalı.");

	const reply = pane.locator(".assistant-assistant").last();
	await expect(reply.locator(".assistant-markdown").last()).toContainText(
		"Gereksinim artık ölçülebilir.",
	);
	await expect(reply).not.toContainText("kalem-tool");

	const [first, second] = await copilot.calls();
	// No MCP in its help: the instructions teach the blocks, and the results come back in the same session.
	expect(first?.args).not.toContain("--additional-mcp-config");
	expect(first?.prompt).toContain("```kalem-tool");
	expect(second?.prompt).toContain('<result tool="document_edit">');
	expect(second?.prompt).toContain("Changed the document");
	expect(second?.args[second.args.indexOf("--session-id") + 1]).toBe(
		first?.args[first.args.indexOf("--session-id") + 1],
	);

	// The change can be undone from the reply.
	await reply.locator(".assistant-change").getByRole("button", { name: "Undo" }).click();
	await expect(page.locator("#editor p")).toHaveText("İptal işlemi hızlı yapılmalı.");
	expect(errors).toEqual([]);
	await app.close();
});

test("a Copilot that cannot start Kalem's MCP server is asked again with blocks", async () => {
	const folder = await tempDir("agent-copilot-mcp");
	const copilot = await fakeCopilot(folder, [["", "Merhaba."]], true);
	const { app, page, errors } = await launch({
		settings: { assistant: true },
		env: { KALEM_COPILOT: copilot.path, KALEM_CLAUDE: join(folder, "none") },
	});
	const pane = page.locator(".assistant");
	await pane.getByRole("button", { name: "Connection settings" }).click();
	await pane.locator(".assistant-settings").getByLabel("Service").selectOption("copilot");
	await pane.locator(".assistant-settings").getByRole("button", { name: "Save" }).click();
	await pane.locator(".assistant-input").fill("Selam");
	await pane.locator(".assistant-input").press("Enter");
	const reply = pane.locator(".assistant-assistant").last();
	await expect(reply.locator(".assistant-markdown")).toHaveText("Merhaba.");
	await expect(reply.locator(".assistant-error")).toHaveCount(0);

	const calls = await copilot.calls();
	expect(calls).toHaveLength(2);
	expect(calls[0]?.args).toContain("--additional-mcp-config");
	expect(calls[0]?.args[calls[0].args.indexOf("--additional-mcp-config") + 1]).toMatch(
		/^@.*copilot-[0-9a-f]+\.json$/,
	);
	expect(calls[1]?.args).not.toContain("--additional-mcp-config");
	expect(calls[1]?.prompt).toContain("```kalem-tool");

	// The next question goes with blocks at once.
	await pane.locator(".assistant-input").fill("Yine");
	await pane.locator(".assistant-input").press("Enter");
	await expect(pane.locator(".assistant-assistant")).toHaveCount(2);
	await expect.poll(async () => (await copilot.calls()).length).toBe(3);
	expect((await copilot.calls())[2]?.args).not.toContain("--additional-mcp-config");
	expect(errors).toEqual([]);
	await app.close();
});

test("a review lists the rules' and the model's findings, and the user fixes them in the document", async () => {
	const folder = await tempDir("agent-review");
	const doc = join(folder, "iptal.md");
	await writeFile(
		doc,
		"# Sipariş İptali\n\n## Amaç ve Kapsam\n\nİptal hızlı yapılmalı.\n\n## Fonksiyonel Gereksinimler\n\n### FR-01: İptal\n\nKullanıcı iptal eder.\n",
	);
	const claude = await fakeClaude(folder, "İnceleme bitti: 2 sorun önemli.", [
		{ name: "analysis_lint", input: {} },
		{
			name: "report_findings",
			input: {
				findings: [
					{
						severity: "high",
						kind: "ambiguity",
						section: "Amaç ve Kapsam",
						quote: "İptal hızlı yapılmalı.",
						problem: "Ölçülemez.",
						suggestion: "İptal 2 saniye içinde onaylanmalı.",
					},
					{
						severity: "medium",
						kind: "missing",
						section: "FR-01: İptal",
						quote: "",
						problem: "Kargodaki sipariş belirsiz.",
						question: "Kargodaki sipariş iptal edilebilir mi?",
					},
				],
			},
		},
	]);
	const { app, page, errors } = await launch({
		args: [doc],
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await pane.locator(".assistant-mode").selectOption("review");
	await pane.locator(".assistant-input").fill("İncele");
	await pane.locator(".assistant-input").press("Enter");

	const review = pane.locator(".assistant-review");
	await expect(review.locator('[data-finding="F-01"]')).toContainText("Ölçülemez.");
	// The rules found theirs too: the template's missing sections, the vague word, the criteria.
	await expect(review.locator(".assistant-finding-rule").first()).toHaveText("rule");
	await expect(review).toContainText("FR-01 has no acceptance criteria.");
	await expect(review.locator(".assistant-review-head")).toContainText("Ready for development:");
	// Marked in the document for this run, nothing written into it.
	await expect
		.poll(() => page.evaluate(() => CSS.highlights.get("kalem-findings")?.size ?? 0))
		.toBeGreaterThan(0);

	await review.locator('[data-finding="F-01"]').getByRole("button", { name: "Fix" }).click();
	await expect(page.locator("#editor p", { hasText: "saniye" })).toHaveText(
		"İptal 2 saniye içinde onaylanmalı.",
	);
	await expect(review.locator('[data-finding="F-01"]')).toContainText("Fixed");

	await review
		.locator('[data-finding="F-02"]')
		.getByRole("button", { name: "Add to Open Questions" })
		.click();
	await expect(page.locator("#editor h2", { hasText: "Open Questions" })).toBeVisible();
	await expect(page.locator("#editor li", { hasText: "F-02" })).toContainText(
		"F-02: Kargodaki sipariş iptal edilebilir mi? (FR-01: İptal)",
	);

	const [call] = await claude.calls();
	const system = call?.args[call.args.indexOf("--append-system-prompt") + 1] ?? "";
	expect(system).toContain("## Mode: review an analysis document");
	expect(call?.args).toContain("mcp__kalem__report_findings");
	expect(call?.tools?.[0]?.text).toContain("Checked against the template");
	expect(call?.tools?.[1]?.text).toBe("Reported 2 findings.");
	expect(errors).toEqual([]);
	// "Don't Save" for the changed document.
	await stubMessageBox(app, 1);
	await app.close();
});

test("templates: the team's and the user's own, a default, and new documents from them", async () => {
	const folder = await tempDir("agent-templates");
	await mkdir(join(folder, ".kalem", "templates"), { recursive: true });
	await writeFile(
		join(folder, ".kalem", "templates", "kurum.md"),
		'---\nkalem-template: "Kurum Analiz Şablonu"\nrequired: [Amaç, Kapsam]\n---\n# {{title}}\n\n## Amaç\n\n## Kapsam\n',
	);
	const userData = await tempDir("profile");
	await writeFile(
		join(userData, "settings.json"),
		JSON.stringify({
			settings: { language: "en", theme: "light" },
			welcomed: true,
			workspaces: [folder],
		}),
	);
	const { app, page, errors } = await launch({ userData });
	await page.locator("#editor [contenteditable]").first().click();
	await page.keyboard.type("# Benim Şablonum");

	await clickMenu(app, "File", "Settings…");
	const dialog = page.locator(".settings-dialog");
	await dialog.locator('[data-category="templates"]').click();
	const block = dialog.locator('[data-block="templates"]');
	await expect(block.locator(".settings-template")).toHaveCount(2);
	await expect(block.locator(".settings-template").first()).toContainText("Kurum Analiz Şablonu");
	await expect(block.locator(".settings-template").first()).toContainText(
		"Team (open folder) · 2 required sections",
	);
	await expect(block.locator(".settings-template").last()).toContainText(
		"Software Analysis Document (best practice)",
	);
	await expect(block.locator(".settings-template").last()).toContainText("Default");

	// The active document kept as the user's own template.
	await block.getByRole("button", { name: "Keep the Active Document as a Template…" }).click();
	await block.getByLabel("The template's name").fill("Benim Şablonum");
	await block.getByRole("button", { name: "Save" }).click();
	await expect(block.locator(".settings-template")).toHaveCount(3);
	await expect(block.locator(".settings-template").nth(1)).toContainText("Mine");

	// The team's is the default from now on.
	await block.locator(".settings-template").first().locator('input[type="radio"]').check();
	await dialog.getByRole("button", { name: "Done" }).click();

	await clickMenu(app, "File", "New from Template…");
	const picker = page.locator(".template-picker");
	await expect(picker.locator(".template-item").first()).toContainText("Kurum Analiz Şablonu");
	await expect(picker.locator(".template-item").first()).toContainText("Default");
	await picker.locator(".template-item").first().click();
	await expect(page.locator("#editor h1")).toHaveText("Untitled");
	await expect(page.locator("#editor h2")).toHaveText(["Amaç", "Kapsam"]);
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});
