import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
	await pane.locator(".assistant-mode").click();
	await pane.locator('.assistant-mode-item[data-mode="review"]').click();
	await expect(pane.locator(".assistant-mode")).toHaveAttribute("data-mode", "review");
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

	// Each finding is one line, with its kind; opening it shows what can be done.
	const first = review.locator('[data-finding="F-01"]');
	await expect(first.locator(".assistant-finding-kind")).toHaveText("Ambiguity");
	await expect(first.getByRole("button", { name: "Fix" })).toHaveCount(0);
	await first.locator(".assistant-finding-row").click();
	await expect(first.locator(".assistant-finding-row")).toHaveAttribute("aria-expanded", "true");
	await first.getByRole("button", { name: "Fix" }).click();
	await expect(page.locator("#editor p", { hasText: "saniye" })).toHaveText(
		"İptal 2 saniye içinde onaylanmalı.",
	);
	// What was just done stays in sight, with its undo.
	await expect(first).toContainText("Fixed");

	// Changed one's mind: the fix is undone, and the finding can be fixed again.
	await first.getByRole("button", { name: "Undo" }).click();
	await expect(page.locator("#editor p", { hasText: "İptal hızlı" })).toHaveText(
		"İptal hızlı yapılmalı.",
	);
	await expect(first.getByRole("button", { name: "Fix" })).toBeEnabled();
	// A note goes under the quoted paragraph; it can be undone too.
	await first.getByRole("button", { name: "Add a Note" }).click();
	await expect(first).toContainText("Note added under its paragraph");
	const note = page.locator("#editor blockquote", { hasText: "Review F-01:" });
	await expect(note).toContainText("Ölçülemez.");
	await first.getByRole("button", { name: "Undo" }).click();
	await expect(note).toHaveCount(0);
	// The user takes a fix back in the document themselves: Undo only reopens the finding.
	await first.getByRole("button", { name: "Fix" }).click();
	await expect(page.locator("#editor p", { hasText: "saniye" })).toBeVisible();
	await clickMenu(app, "Edit", "Undo");
	await expect(page.locator("#editor p", { hasText: "İptal hızlı" })).toBeVisible();
	await first.getByRole("button", { name: "Undo" }).click();
	await expect(pane).toContainText("F-01 is open again.");
	await expect(page.locator("#editor p", { hasText: "İptal hızlı" })).toHaveText(
		"İptal hızlı yapılmalı.",
	);
	await first.getByRole("button", { name: "Fix" }).click();
	await expect(page.locator("#editor p", { hasText: "saniye" })).toHaveText(
		"İptal 2 saniye içinde onaylanmalı.",
	);
	await expect(first).toContainText("Fixed");

	const second = review.locator('[data-finding="F-02"]');
	await second.locator(".assistant-finding-row").click();
	await second.getByRole("button", { name: "Add to Open Questions" }).click();
	await expect(page.locator("#editor h2", { hasText: "Open Questions" })).toBeVisible();
	await expect(page.locator("#editor li", { hasText: "F-02" })).toContainText(
		"F-02: Kargodaki sipariş iptal edilebilir mi? (FR-01: İptal)",
	);

	// The checks ran side by side, a reviewer each; the conversation then summed up.
	const calls = await claude.calls();
	const systemOf = (call: Call | undefined): string =>
		call?.args[call.args.indexOf("--append-system-prompt") + 1] ?? "";
	const reviewers = calls.slice(0, -1);
	expect(reviewers).toHaveLength(5);
	for (const reviewer of reviewers) {
		expect(systemOf(reviewer)).toContain("## Mode: review an analysis document");
		expect(systemOf(reviewer)).toContain("one of several reviewers");
		expect(reviewer.args).toContain("mcp__kalem__report_findings");
		// A reviewer reads and reports: it cannot change the document, and starts no conversation to resume.
		expect(reviewer.args).not.toContain("mcp__kalem__document_edit");
		expect(reviewer.args).not.toContain("--resume");
		expect(reviewer.prompt).toContain("İptal hızlı yapılmalı.");
		// Kalem ran the rules itself, and told the reviewer what they found.
		expect(reviewer.prompt).toContain("<already-found>");
		expect(reviewer.tools?.[0]?.text).toBe("analysis_lint is not available now.");
		expect(reviewer.tools?.[1]?.text).toBe("Reported 2 findings.");
	}
	expect(reviewers.map((reviewer) => systemOf(reviewer)).join("\n")).toContain(
		"look for contradictions",
	);
	const summary = calls.at(-1);
	expect(systemOf(summary)).toContain("do not check the document again");
	expect(systemOf(summary)).not.toContain("look for contradictions");
	expect(summary?.prompt).toContain("<review-findings");
	expect(summary?.prompt).toContain("F-01 [high, ambiguity] §Amaç ve Kapsam: Ölçülemez.");
	// What five reviewers and the answer all reported is listed once.
	await expect(review.locator(".assistant-finding:not(:has(.assistant-finding-rule))")).toHaveCount(
		2,
	);
	// The rules' findings too, though the answer ran the rules again: the seven missing
	// sections as one item, the vague word and the criteria.
	await expect(review.locator(".assistant-finding:has(.assistant-finding-rule)")).toHaveCount(3);
	const sections = review.locator('[data-sections="7"]');
	await expect(sections).toContainText("7 sections of the template are missing");
	await sections.locator(".assistant-finding-row").click();
	await sections.getByRole("button", { name: "Add All Sections" }).click();
	await expect(page.locator("#editor h2", { hasText: "Glossary" })).toBeVisible();
	// Open Questions was there by now (F-02): it is not added twice.
	await expect(page.locator("#editor h2", { hasText: "Open Questions" })).toHaveCount(1);
	await expect(sections.locator(".assistant-section.finding-fixed")).toHaveCount(7);
	// Closed, what was dealt with goes under its own heading at the end.
	await sections.locator(".assistant-finding-row").click();
	await first.locator(".assistant-finding-row").click();
	await second.locator(".assistant-finding-row").click();
	await expect(review.locator(".assistant-review-done > summary")).toHaveText("Dealt with (9)");
	// The counts filter the list.
	await expect(review.getByRole("button", { name: "Medium 1" })).toBeEnabled();
	await review.getByRole("button", { name: "Medium 1" }).click();
	await expect(review.getByRole("button", { name: "Medium 1" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(review.locator(".assistant-review-hidden")).toContainText("9 hidden by the filter");
	await review.getByRole("button", { name: "Show all" }).click();
	await expect(review.locator(".assistant-review-hidden")).toHaveCount(0);

	// The checks: one line once all is done, opening to each with its time.
	const checks = pane.locator(".assistant-checks-done");
	await expect(checks.locator("summary")).toContainText("5 checks · 2 findings ·");
	await checks.locator("summary").click();
	await expect(checks.locator(".assistant-check.check-done")).toHaveCount(5);
	await expect(checks.locator(".assistant-check").first()).toContainText("Scope check");
	expect(errors).toEqual([]);
	// "Don't Save" for the changed document.
	await stubMessageBox(app, 1);
	await app.close();
});

test("a review's check that failed says why, and runs again on its own", async () => {
	const folder = await tempDir("agent-review-retry");
	const doc = join(folder, "iptal.md");
	await writeFile(doc, "# Sipariş İptali\n\n## Amaç ve Kapsam\n\nİptal hızlı yapılmalı.\n");
	const claude = await fakeClaude(
		folder,
		"İnceleme bitti.",
		[
			{
				name: "report_findings",
				input: {
					findings: [{ severity: "high", quote: "İptal hızlı yapılmalı.", problem: "Ölçülemez." }],
				},
			},
		],
		{ failOnce: "Look for missing security" },
	);
	const { app, page, errors } = await launch({
		args: [doc],
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await pane.locator(".assistant-mode").click();
	await pane.locator('.assistant-mode-item[data-mode="review"]').click();
	await pane.locator(".assistant-input").fill("İncele");
	await pane.locator(".assistant-input").press("Enter");
	await expect(pane.locator(".assistant-assistant")).toContainText("İnceleme bitti.");

	// A failed check keeps the card open, with why.
	const checks = pane.locator(".assistant-checks-done");
	await expect(checks).toHaveAttribute("open", "");
	await expect(checks.locator("summary")).toContainText("1 failed");
	const failed = checks.locator(".assistant-check.check-failed");
	await expect(failed).toHaveCount(1);
	await expect(failed).toContainText("Security, privacy and permissions");
	await expect(failed).toContainText("Could not finish: rate limited");
	// The answer was told, and summed up the others.
	const before = await claude.calls();
	expect(before.at(-1)?.prompt).toContain("These checks could not be made, say so: Security");

	await failed.getByRole("button", { name: "Try Again" }).click();
	await expect(checks.locator(".assistant-check.check-failed")).toHaveCount(0);
	await expect(checks.locator(".assistant-check.check-done")).toHaveCount(5);
	await expect(checks.locator("summary")).not.toContainText("failed");
	const after = await claude.calls();
	expect(after).toHaveLength(before.length + 1);
	expect(after.at(-1)?.args.join(" ")).toContain("Look for missing security");
	// Only one reviewer ran again, and no conversation was resumed for it.
	expect(after.at(-1)?.args).not.toContain("--resume");
	// What it reported was in the list already: it is not listed twice.
	await expect(pane.locator('.assistant-finding[data-finding="F-01"]')).toHaveCount(1);
	expect(errors).toEqual([]);
	await app.close();
});

test("modes: shaped in Settings (a step off, one of the user's own), and picked automatically", async () => {
	const folder = await tempDir("agent-modes");
	const doc = join(folder, "iptal.md");
	await writeFile(doc, "# Sipariş İptali\n\nİptal hızlı yapılmalı.\n");
	const claude = await fakeClaude(folder, "Tamam.", []);
	const { app, page, userData, errors } = await launch({
		args: [doc],
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	// Automatic by default; the picker shows every mode with what it is for.
	const picker = pane.locator(".assistant-mode");
	await expect(picker).toHaveAttribute("data-mode", "auto");
	await picker.click();
	await expect(pane.locator(".assistant-mode-item")).toHaveCount(7);
	await expect(pane.locator('.assistant-mode-item[data-mode="review"]')).toContainText("9 steps");
	await pane.getByRole("menuitem", { name: "Customize modes…" }).click();

	// Settings: the review's rule check off, and a step of the user's own.
	const settings = page.locator(".settings-dialog");
	await expect(settings.locator(".mode-editor")).toBeVisible();
	await settings.locator('.mode-tab[data-mode="review"]').click();
	await settings.locator('.mode-step[data-step="lint"] .mode-switch-input').uncheck();
	await expect(settings.locator('.mode-step[data-step="lint"]')).toHaveAttribute("data-off", "");
	await settings.getByRole("button", { name: "Add a step" }).click();
	const added = settings.locator('.mode-step[data-step="custom-1"]');
	await added.getByRole("textbox", { name: "Step name" }).fill("KVKK");
	await added.locator("textarea").fill("Check the KVKK consent texts.");
	await settings.locator(".mode-preview summary").click();
	await expect(settings.locator(".mode-preview-text")).toContainText(
		"Check the KVKK consent texts.",
	);
	await expect(settings.locator(".mode-preview-text")).not.toContainText("analysis_lint");
	await expect(settings.locator('.mode-tab[data-mode="review"]')).toContainText("9 steps");
	await settings.getByRole("button", { name: "Done" }).click();
	await expect
		.poll(async () => {
			const stored = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"));
			return stored.settings.assistantModes?.review?.steps?.filter(
				(step: { on: boolean }) => !step.on,
			);
		})
		.toEqual([{ id: "lint", on: false }]);

	// "Incele" chooses the review by itself, and says so.
	await pane.locator(".assistant-input").fill("Bu analizi geliştirme öncesi incele");
	await pane.locator(".assistant-input").press("Enter");
	await expect(pane.locator(".assistant-user .assistant-notes")).toContainText(
		"Mode: Review analysis (chosen automatically)",
	);
	await expect(pane.locator(".assistant-assistant")).toContainText("Tamam.");
	// The review's checks went to reviewers side by side: the user's own step to one of them.
	const systems = (await claude.calls()).map(
		(call) => call.args[call.args.indexOf("--append-system-prompt") + 1] ?? "",
	);
	expect(systems.length).toBeGreaterThan(2);
	expect(systems.filter((system) => system.includes("Check the KVKK consent texts."))).toHaveLength(
		1,
	);
	for (const system of systems) {
		expect(system).toContain("## Mode: review an analysis document");
		expect(system).not.toContain("First call analysis_lint");
	}
	const [call] = await claude.calls();
	expect(call?.args).toContain("mcp__kalem__report_findings");
	expect(call?.args.join(" ")).not.toContain("mcp__kalem__analysis_lint");

	// Turned off in Settings, the review is one answer again, with every step in it.
	await picker.click();
	await pane.getByRole("menuitem", { name: "Customize modes…" }).click();
	await settings.locator('.mode-tab[data-mode="review"]').click();
	await settings.getByLabel(/Run the checks side by side/).uncheck();
	await settings.getByRole("button", { name: "Done" }).click();
	await pane.getByRole("button", { name: "New chat" }).first().click();
	await pane.locator(".assistant-input").fill("Bu analizi geliştirme öncesi incele");
	await pane.locator(".assistant-input").press("Enter");
	await expect(pane.locator(".assistant-assistant")).toContainText("Tamam.");
	await expect.poll(async () => (await claude.calls()).length).toBe(systems.length + 1);
	const alone = (await claude.calls()).at(-1);
	const whole = alone?.args[alone.args.indexOf("--append-system-prompt") + 1] ?? "";
	expect(whole).toContain("Check the KVKK consent texts.");
	expect(whole).toContain("Check the scope");
	expect(whole).not.toContain("one of several reviewers");
	expect(errors).toEqual([]);
	await app.close();
});

test("a mode of the user's own: its instructions, its tools and its MCP server go to Claude Code", async () => {
	const folder = await tempDir("agent-custom-mode");
	const doc = join(folder, "gereksinim.md");
	await writeFile(doc, "# Giriş\n\nKullanıcı şifresiyle girer.\n");
	const claude = await fakeClaude(folder, "Senaryolar hazır.", []);
	const { app, page, userData, errors } = await launch({
		args: [doc],
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await pane.locator(".assistant-mode").click();
	await pane.getByRole("menuitem", { name: "Customize modes…" }).click();
	const settings = page.locator(".settings-dialog");

	// A new mode: its name, instructions and a step.
	await settings.locator(".mode-tab-new").click();
	const editor = settings.locator(".custom-mode");
	await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Test Analisti");
	await editor
		.getByRole("textbox", { name: "What it is for" })
		.fill("Gereksinimlerden test senaryosu yazar");
	await editor.getByRole("textbox", { name: "Instructions" }).fill("You are a test analyst.");
	await editor.getByRole("radio", { name: "target" }).click();
	await editor.locator(".mode-add").first().click();
	await editor
		.locator('.mode-step[data-step="step-1"] textarea')
		.fill("Write a test case for each rule.");
	// Only two of Kalem's tools.
	await editor.getByRole("radio", { name: "Only those chosen" }).click();
	await editor.locator('input[data-tool="document_read"]').check();
	await editor.locator('input[data-tool="document_outline"]').check();
	// An MCP server: a program on this computer.
	await editor.getByRole("button", { name: "Add an MCP server" }).click();
	const server = editor.locator(".mcp-card");
	await server.getByRole("textbox", { name: "Server name" }).fill("dosyalar");
	await server.getByRole("textbox", { name: "Server name" }).press("Tab");
	await editor
		.locator(".mcp-card")
		.getByRole("textbox", { name: "Arguments (one a line)" })
		.fill("-y\nmcp-files\n/tmp");
	await editor
		.locator(".mcp-card")
		.getByRole("textbox", { name: "Environment (KEY=value, one a line)" })
		.fill("TOKEN=abc");
	await expect(settings.locator(".mode-tab-custom")).toContainText("Test Analisti");
	await settings.getByRole("button", { name: "Done" }).click();
	await expect
		.poll(async () => {
			const stored = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"));
			const [mode] = stored.settings.assistantCustomModes ?? [];
			return mode === undefined
				? null
				: { name: mode.name, tools: mode.tools, mcp: mode.mcp[0]?.name };
		})
		.toEqual({
			name: "Test Analisti",
			tools: ["document_outline", "document_read"],
			mcp: "dosyalar",
		});

	// It is in the picker, with its line.
	await pane.locator(".assistant-mode").click();
	const item = pane.locator('.assistant-mode-item[data-mode="custom-1"]');
	await expect(item).toContainText("Gereksinimlerden test senaryosu yazar");
	await item.click();
	await pane.locator(".assistant-input").fill("Senaryoları yaz");
	await pane.locator(".assistant-input").press("Enter");
	await expect(pane.locator(".assistant-assistant")).toContainText("Senaryolar hazır.");

	const [call] = await claude.calls();
	const system = call?.args[call.args.indexOf("--append-system-prompt") + 1] ?? "";
	expect(system).toContain("## Mode: Test Analisti");
	expect(system).toContain("You are a test analyst.");
	expect(system).toContain("1. Write a test case for each rule.");
	// Only the chosen tools of Kalem's, and the mode's server, which may be called without asking.
	const allowed = call?.args.slice(call.args.indexOf("--allowedTools") + 1) ?? [];
	expect(allowed).toContain("mcp__kalem__document_read");
	expect(allowed).not.toContain("mcp__kalem__document_edit");
	expect(allowed).toContain("mcp__dosyalar");
	expect(call?.mcp?.mcpServers.dosyalar).toEqual({
		type: "stdio",
		command: "npx",
		args: ["-y", "mcp-files", "/tmp"],
		env: { TOKEN: "abc" },
	});
	expect(errors).toEqual([]);
	await app.close();
});

test("one of Kalem's modes takes an MCP server too, and the model is told what it is for", async () => {
	const folder = await tempDir("agent-mode-mcp");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n");
	const claude = await fakeClaude(folder, "Anahtar eklendi.", []);
	const { app, page, userData, errors } = await launch({
		args: [doc],
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await pane.locator(".assistant-mode").click();
	await pane.getByRole("menuitem", { name: "Customize modes…" }).click();
	const settings = page.locator(".settings-dialog");

	// The Code mode: a database server, one tool of it, and what it is for.
	await settings.locator('.mode-tab[data-mode="code"]').click();
	await settings.getByRole("button", { name: "Add an MCP server" }).click();
	const server = settings.locator(".mcp-card");
	await server.getByRole("textbox", { name: "Server name" }).fill("i18n-db");
	await server.getByRole("textbox", { name: "Server name" }).press("Tab");
	await settings
		.locator(".mcp-card")
		.getByRole("textbox", { name: "Arguments (one a line)" })
		.fill("-y\n@bytebase/dbhub\n--config\n/home/me/dbhub.toml");
	await settings
		.locator(".mcp-card")
		.getByRole("textbox", { name: "Tools it may use" })
		.fill("add_i18n_key");
	await settings
		.locator(".mcp-card")
		.getByRole("textbox", { name: "What it is for (the assistant is told)" })
		.fill("When you add an i18n key in code, add it to the database with add_i18n_key.");
	// One of the ready-made servers, filled in.
	await settings.locator(".mcp-presets summary").click();
	// Its guide first: what it is, the steps, and the files to copy.
	await settings.locator('.mcp-preset[data-preset="dbhub"] .mcp-preset-help').click();
	const guide = settings.locator('.mcp-guide-panel [data-guide="dbhub"]');
	await expect(guide).toContainText("DBHub connects to your database");
	await expect(guide.locator(".mcp-guide-steps li").first()).toContainText("make a user");
	await expect(guide.locator(".mcp-sample-text")).toHaveCount(2);
	await expect(guide.locator(".mcp-sample-text").last()).toContainText(
		'name        = "get_parameter"',
	);
	// Closed again by the same button.
	await settings.locator('.mcp-preset[data-preset="dbhub"] .mcp-preset-help').click();
	await expect(settings.locator(".mcp-guide-panel")).toHaveCount(0);
	await settings.locator('.mcp-preset[data-preset="context7"] .mcp-preset-add').click();
	await expect(settings.locator(".mcp-card")).toHaveCount(2);
	await expect(
		settings
			.locator('.mcp-card[data-server="context7"]')
			.getByRole("textbox", { name: "Arguments (one a line)" }),
	).toHaveValue("-y\n@upstash/context7-mcp@latest");
	// Added from a ready-made server, it keeps its guide.
	const kept = settings.locator('.mcp-card[data-server="context7"] .mcp-card-guide');
	await kept.locator("summary").click();
	await expect(kept).toContainText("Up-to-date documentation");
	await settings.locator(".mode-preview summary").click();
	await expect(settings.locator(".mode-preview-text")).toContainText(
		"- i18n-db (tools: add_i18n_key): When you add an i18n key in code",
	);
	await expect(settings.locator(".mode-preview-text")).toContainText(
		"- context7: Up-to-date documentation",
	);
	await settings.getByRole("button", { name: "Done" }).click();
	await expect
		.poll(async () => {
			const stored = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"));
			return stored.settings.assistantModes?.code?.mcp?.[0]?.tools;
		})
		.toEqual(["add_i18n_key"]);

	await pane.locator(".assistant-mode").click();
	await pane.locator('.assistant-mode-item[data-mode="code"]').click();
	await pane.locator(".assistant-input").fill("Giriş ekranına hata mesajı ekle");
	await pane.locator(".assistant-input").press("Enter");
	await expect(pane.locator(".assistant-assistant")).toContainText("Anahtar eklendi.");

	const [call] = await claude.calls();
	const system = call?.args[call.args.indexOf("--append-system-prompt") + 1] ?? "";
	expect(system).toContain("## Mode: code");
	expect(system).toContain("Use them on your own");
	expect(system).toContain("add it to the database with add_i18n_key");
	const allowed = call?.args.slice(call.args.indexOf("--allowedTools") + 1) ?? [];
	expect(allowed).toContain("mcp__i18n-db__add_i18n_key");
	expect(allowed).toContain("mcp__context7");
	expect(call?.mcp?.mcpServers["i18n-db"]).toEqual({
		type: "stdio",
		command: "npx",
		args: ["-y", "@bytebase/dbhub", "--config", "/home/me/dbhub.toml"],
		env: {},
	});
	expect(errors).toEqual([]);
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
	await block
		.getByRole("button", { name: "Keep the Active Document as a Document Template…" })
		.click();
	await block.getByLabel("The document template's name").fill("Benim Şablonum");
	await block.getByRole("button", { name: "Save" }).click();
	await expect(block.locator(".settings-template")).toHaveCount(3);
	await expect(block.locator(".settings-template").nth(1)).toContainText("Mine");

	// The team's is the default from now on.
	await block.locator(".settings-template").first().locator('input[type="radio"]').check();
	await dialog.getByRole("button", { name: "Done" }).click();

	await clickMenu(app, "File", "New from Document Template…");
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

test("document templates in the assistant: picked in any mode, the question is asked by it", async () => {
	const folder = await tempDir("agent-template-pick");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Sprint 12\n\nGiriş ekranı bitti.\n");
	const claude = await fakeClaude(folder, "Rapor hazır.", []);
	const userData = await tempDir("profile");
	await mkdir(join(userData, "templates"), { recursive: true });
	await writeFile(
		join(userData, "templates", "haftalik.md"),
		'---\nkalem-template: "Haftalık Rapor"\nrequired: [Bu Hafta, Gelecek Hafta]\n---\n# {{title}}\n\n## Bu Hafta\n\n## Gelecek Hafta\n',
	);
	await writeFile(
		join(userData, "settings.json"),
		JSON.stringify({
			settings: { language: "en", theme: "light", restoreSession: false, assistant: true },
			welcomed: true,
		}),
	);
	const { app, page, errors } = await launch({
		userData,
		args: [doc],
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");

	// + → Use a Document Template lists them all; one is picked for the questions.
	await pane.locator(".assistant-add").click();
	await pane.getByRole("menuitem", { name: "Use a Document Template" }).click();
	const items = pane.locator(".assistant-add-menu .assistant-add-item");
	await expect(items).toHaveText(["Haftalık Rapor", "Software Analysis Document (best practice)"]);
	await items.first().click();
	const chip = pane.locator(".assistant-template-chip");
	await expect(chip).toHaveText("Template: Haftalık Rapor");

	// A plain question (no analysis mode) is asked by it too.
	await pane.locator(".assistant-input").fill("Bu haftanın raporunu yaz");
	await pane.locator(".assistant-input").press("Enter");
	await expect(pane.locator(".assistant-user .assistant-notes")).toContainText(
		"By the document template “Haftalık Rapor”",
	);
	await expect(pane.locator(".assistant-assistant")).toContainText("Rapor hazır.");
	const systemOf = (call: Call | undefined): string =>
		call?.args[call.args.indexOf("--append-system-prompt") + 1] ?? "";
	const first = systemOf((await claude.calls()).at(-1));
	expect(first).toContain('## Document template: "Haftalık Rapor"');
	expect(first).toContain("## Gelecek Hafta");

	// Taken off, the next question goes without it.
	await chip.getByRole("button").click();
	await expect(chip).toHaveCount(0);
	await pane.getByRole("button", { name: "New chat" }).first().click();
	await pane.locator(".assistant-input").fill("Teşekkürler");
	await pane.locator(".assistant-input").press("Enter");
	await expect.poll(async () => (await claude.calls()).length).toBe(2);
	expect(systemOf((await claude.calls()).at(-1))).not.toContain("## Document template");
	expect(errors).toEqual([]);
	await app.close();
});

/** A Jira that knows who is signed in, and keeps what it is sent. */
async function fakeJira() {
	const posted: { path: string; body: Record<string, unknown> }[] = [];
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		const reply = (status: number, body: unknown): void => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (request.headers.authorization !== "Bearer jira-pat")
			return reply(401, { errorMessages: ["Unauthorized"] });
		if (request.method === "POST") {
			let body = "";
			for await (const chunk of request) body += chunk;
			posted.push({ path: url.pathname, body: JSON.parse(body) });
			if (url.pathname === "/rest/api/2/issue")
				return reply(201, { key: `ABC-${10 + posted.length}` });
			return reply(201, {});
		}
		if (url.pathname === "/rest/api/2/myself")
			return reply(200, { displayName: "Ayşe", name: "ayse" });
		return reply(200, { issues: [], total: 0 });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return { site: `http://127.0.0.1:${port}`, posted, close: () => server.close() };
}

test("nothing goes to Jira without the user's click; only the issues they pick are created", async () => {
	const jira = await fakeJira();
	const folder = await tempDir("agent-jira");
	const claude = await fakeClaude(folder, "Story'leri oluşturdum.", [
		{
			name: "jira_create_issues",
			input: {
				project: "ABC",
				issues: [
					{
						type: "Story",
						summary: "FR-01 İptal talebi",
						description: "**Kabul:** iptal 2 sn içinde onaylanır.",
					},
					{ type: "Story", summary: "FR-02 İade" },
				],
			},
		},
		{ name: "jira_add_comment", input: { key: "ABC-11", comment: "Analiz güncellendi." } },
	]);
	const { app, page, errors } = await launch({
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	await clickMenu(app, "File", "Settings…");
	const settings = page.locator(".settings-dialog");
	await settings.locator('[data-category="connections"]').click();
	await settings
		.locator('[data-connection="Jira"]')
		.getByRole("button", { name: "Connect to Jira" })
		.click();
	const login = page.locator(".jira-dialog");
	await login.locator('input[type="url"]').fill(jira.site);
	await login.locator('input[type="password"]').fill("jira-pat");
	await login.getByRole("button", { name: "Connect" }).click();
	await expect(page.locator('.stripe-button[data-pane="jira"]')).toBeVisible();
	await page.keyboard.press("Escape");

	const pane = page.locator(".assistant");
	await pane.locator(".assistant-input").fill("Gereksinimlerden story oluştur");
	await pane.locator(".assistant-input").press("Enter");
	const card = pane.locator(".assistant-approval").first();
	await expect(card).toContainText(`Create 2 issue(s) in ABC (${jira.site})`);
	await expect(card).toContainText("This is sent to the server; Kalem cannot undo it.");
	// Online changes are allowed one at a time: no "always".
	await expect(card.locator(".assistant-approval-scope")).toBeHidden();
	await expect(card.locator(".assistant-approval-preview")).toContainText(
		"**Kabul:** iptal 2 sn içinde onaylanır.",
	);
	// Nothing was sent while the card waits.
	await page.waitForTimeout(300);
	expect(jira.posted).toEqual([]);
	await card.getByLabel("Story: FR-02 İade").uncheck();
	await card.getByRole("button", { name: "Allow" }).click();

	const comment = pane.locator(".assistant-approval").nth(1);
	await expect(comment).toContainText("Comment on ABC-11");
	await comment.getByRole("button", { name: "Deny" }).click();
	await expect(pane.locator(".assistant-assistant .assistant-markdown").last()).toContainText(
		"Story'leri oluşturdum.",
	);

	expect(jira.posted).toHaveLength(1);
	expect(jira.posted[0]).toMatchObject({
		path: "/rest/api/2/issue",
		body: {
			fields: {
				project: { key: "ABC" },
				issuetype: { name: "Story" },
				summary: "FR-01 İptal talebi",
			},
		},
	});
	// Its description went as Jira's wiki markup.
	expect(
		(jira.posted[0]?.body.fields as { description?: string } | undefined)?.description,
	).toContain("*Kabul:*");
	const [call] = await claude.calls();
	expect(call?.tools?.[0]?.text).toContain(
		`Created ABC-11: FR-01 İptal talebi (${jira.site}/browse/ABC-11)`,
	);
	expect(call?.tools?.[0]?.text).toContain("The user left out 1 of them.");
	expect(call?.tools?.[1]?.text).toContain("nothing was sent");
	expect(errors).toEqual([]);
	await app.close();
	jira.close();
});

test("the assistant's panel moves left or under the document, and '@' adds a section to the question", async () => {
	const folder = await tempDir("agent-ui");
	const doc = join(folder, "analiz.md");
	await writeFile(doc, "# Analiz\n\n## Amaç\n\nSiparişi iptal etmek.\n\n## Kapsam\n\nWeb.\n");
	const claude = await fakeClaude(folder, "Tamam.");
	const { app, page, errors } = await launch({
		args: [doc],
		settings: { assistant: true, assistantDocument: false },
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");

	await clickMenu(app, "File", "Settings…");
	const dialog = page.locator(".settings-dialog");
	await dialog.locator('[data-category="assistant"]').click();
	await dialog.locator('select[data-setting="assistantPlace"]').selectOption({ label: "Bottom" });
	await expect(page.locator(".desk-column > .assistant")).toBeVisible();
	await expect(pane).toHaveAttribute("data-place", "bottom");
	await dialog.locator('select[data-setting="assistantPlace"]').selectOption({ label: "Left" });
	await expect(page.locator(".body > .assistant")).toHaveAttribute("data-place", "left");
	const paneBox = await pane.boundingBox();
	const deskBox = await page.locator(".desk-column").boundingBox();
	expect((paneBox?.x ?? 0) + (paneBox?.width ?? 0)).toBeLessThanOrEqual((deskBox?.x ?? 0) + 1);
	await dialog.getByRole("button", { name: "Done" }).click();

	// "@" lists the document's sections; the picked one goes with the question, the document is not shared.
	const input = pane.locator(".assistant-input");
	await input.fill("Bunu kısalt @Ama");
	const mentions = pane.locator(".assistant-mention-menu");
	await expect(mentions.locator(".assistant-command")).toHaveText(["§ Amaç"]);
	await input.press("Enter");
	await expect(pane.locator(".assistant-mention")).toHaveText("§ Amaç");
	await expect(input).toHaveValue("Bunu kısalt ");
	await input.press("Enter");
	await expect(pane.locator(".assistant-assistant .assistant-markdown")).toHaveText("Tamam.");
	await expect(pane.locator(".assistant-mention")).toHaveCount(0);
	const [call] = await claude.calls();
	expect(call?.prompt).toContain('<section heading="Amaç">\n## Amaç\n\nSiparişi iptal etmek.\n');
	expect(call?.prompt).not.toContain("<document");
	expect(errors).toEqual([]);
	await app.close();
});
