import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Call } from "./fake-claude.js";
import { fakeClaude } from "./fake-claude.js";
import { clickMenu, launch, tempDir } from "./launch.js";
import { shot } from "./shots.js";

/** The settings the app keeps, as written: the parts these tests read. */
interface Stored {
	readonly assistantMcpServers?: readonly { readonly name: string }[];
	readonly assistantModes?: Record<string, { readonly mcp?: readonly string[] } | undefined>;
	readonly assistantCustomModes?: readonly { readonly mcp?: readonly string[] }[];
}

async function stored(userData: string): Promise<Stored> {
	return JSON.parse(await readFile(join(userData, "settings.json"), "utf8")).settings;
}

/** A profile with these settings and these folders open in the Files pane. */
async function profile(
	settings: Record<string, unknown>,
	workspaces: string[] = [],
): Promise<string> {
	const userData = await tempDir("profile");
	await writeFile(
		join(userData, "settings.json"),
		JSON.stringify({
			settings: { language: "en", theme: "light", restoreSession: false, ...settings },
			welcomed: true,
			workspaces,
		}),
	);
	return userData;
}

/** The CLI's runs for the user's questions (not the one that names the chat). */
async function questions(claude: { calls(): Promise<Call[]> }): Promise<Call[]> {
	return (await claude.calls()).filter((call) => call.args.includes("--append-system-prompt"));
}

async function openSettings(app: ElectronApplication, page: Page, category: string) {
	await clickMenu(app, "File", "Settings…");
	const settings = page.locator(".settings-dialog");
	await settings.locator(`[data-category="${category}"]`).click();
	return settings;
}

/** Asks the assistant in a mode and waits for its answer. */
async function ask(page: Page, mode: string, question: string, answer: string): Promise<void> {
	const pane = page.locator(".assistant");
	await pane.locator(".assistant-mode").click();
	await pane.locator(`.assistant-mode-item[data-mode="${mode}"]`).click();
	await pane.locator(".assistant-input").fill(question);
	await pane.locator(".assistant-input").press("Enter");
	await expect(pane.locator(".assistant-assistant").last()).toContainText(answer);
}

const I18N = {
	name: "i18n-db",
	transport: "stdio",
	command: "npx",
	args: ["-y", "@bytebase/dbhub", "--config", "/home/me/dbhub.toml"],
	tools: ["add_i18n_key"],
	purpose: "The i18n database.",
};

test("servers kept in modes by an earlier version move to the assistant, and each mode keeps using them", async () => {
	const folder = await tempDir("mcp-migrate");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n");
	const userData = await profile({
		assistant: true,
		assistantModes: {
			code: { detail: "short", mcp: [I18N, { name: "files", command: "npx", args: ["a"] }] },
			ask: { mcp: [{ name: "files", command: "npx", args: ["a"], enabled: false }] },
		},
		assistantCustomModes: [
			{ id: "custom-1", name: "Test Analisti", mcp: [{ name: "files", command: "other" }] },
		],
	});
	const { app, page, errors } = await launch({ userData, args: [doc] });
	const settings = await openSettings(app, page, "assistant");
	const block = settings.locator('[data-block="mcp"]');
	// Serena, which the assistant starts with, and each server once; a different one of a taken name is files-2.
	await expect(block.locator(".mcp-card")).toHaveCount(4);
	expect(
		await block
			.locator(".mcp-card .mcp-name")
			.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
	).toEqual(["serena", "i18n-db", "files", "files-2"]);
	await expect(block.locator('.mcp-card[data-server="i18n-db"] .mcp-used-in')).toHaveText(
		"Used in: Code",
	);
	await expect(block.locator('.mcp-card[data-server="files-2"] .mcp-used-in')).toHaveText(
		"Used in: Test Analisti",
	);
	await expect(block.locator('.mcp-card[data-server="serena"] .mcp-used-in')).toHaveText(
		"Used in: Review analysis, Prepare prompt, Code",
	);
	await block
		.locator('.mcp-card[data-server="i18n-db"] .mcp-card-head')
		.evaluate((head) => head.scrollIntoView({ block: "start" }));
	await shot(page, "01-migrated-servers");

	await settings.locator('[data-category="modes"]').click();
	await settings.locator('.mode-tab[data-mode="code"]').click();
	const choice = settings.locator(".mcp-choice-list");
	await choice.scrollIntoViewIfNeeded();
	for (const [name, on] of [
		["serena", true],
		["i18n-db", true],
		["files", true],
		["files-2", false],
	] as const) {
		await expect(choice.getByRole("switch", { name, exact: true })).toBeChecked({ checked: on });
	}
	// `${project}` reads as what it stands for.
	await expect(choice.locator('.mcp-choice[data-server="serena"]')).toContainText(
		"the user's code at the code folder of each question",
	);
	await shot(page, "02-code-mode-choice");
	// It was off in the Ask mode: Ask uses none.
	await settings.locator('.mode-tab[data-mode="ask"]').click();
	await expect(choice.getByRole("switch", { checked: true })).toHaveCount(0);
	await settings.locator('.mode-tab[data-mode="custom-1"]').click();
	await expect(settings.getByRole("switch", { name: "files-2" })).toBeChecked();
	await expect(settings.getByRole("switch", { name: "serena" })).not.toBeChecked();
	await settings
		.locator(".custom-mode .mode-mcp")
		.evaluate((section) => section.scrollIntoView({ block: "center" }));
	await shot(page, "03-custom-mode-choice");
	await settings.getByRole("button", { name: "Done" }).click();

	// Kept in the new shape: servers in the assistant, names in the modes.
	await expect
		.poll(async () => {
			const kept = await stored(userData);
			return [
				kept.assistantMcpServers?.map((server) => server.name),
				kept.assistantModes?.code?.mcp,
				kept.assistantCustomModes?.[0]?.mcp,
			];
		})
		.toEqual([
			["serena", "i18n-db", "files", "files-2"],
			["serena", "i18n-db", "files"],
			["files-2"],
		]);
	expect(errors).toEqual([]);
	await app.close();
});

test("a server renamed in the assistant is renamed in its modes, and removed from them when removed", async () => {
	const folder = await tempDir("mcp-rename");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n");
	const userData = await profile({
		assistantMcpServers: [{ ...I18N, name: "db" }],
		assistantModes: { code: { mcp: ["db"] }, ask: { mcp: ["db"] } },
	});
	const { app, page, errors } = await launch({ userData, args: [doc] });
	const settings = await openSettings(app, page, "assistant");
	const card = settings.locator('.mcp-card[data-server="db"]');
	await expect(card.locator(".mcp-used-in")).toHaveText("Used in: Ask, Code");
	await card.getByRole("textbox", { name: "Server name" }).fill("database");
	await card.getByRole("textbox", { name: "Server name" }).press("Tab");
	await expect
		.poll(async () => {
			const kept = await stored(userData);
			return [kept.assistantModes?.code?.mcp, kept.assistantModes?.ask?.mcp];
		})
		.toEqual([["database"], ["database"]]);
	const renamed = settings.locator('.mcp-card[data-server="database"]');
	await expect(renamed.locator(".mcp-used-in")).toHaveText("Used in: Ask, Code");
	// A name already taken, or Kalem's own, is not taken.
	await renamed.getByRole("textbox", { name: "Server name" }).fill("kalem");
	await renamed.getByRole("textbox", { name: "Server name" }).press("Tab");
	await expect(renamed.getByRole("textbox", { name: "Server name" })).toHaveValue("database");
	await renamed.evaluate((card) => card.scrollIntoView({ block: "start" }));
	await shot(page, "04-renamed-server");

	await settings.locator('[data-category="modes"]').click();
	await settings.locator('.mode-tab[data-mode="code"]').click();
	await expect(settings.getByRole("switch", { name: "database" })).toBeChecked();
	await settings.locator('[data-category="assistant"]').click();
	await renamed.getByRole("button", { name: "Remove the server" }).click();
	await expect(settings.locator('.mcp-card[data-server="database"]')).toHaveCount(0);
	await expect
		.poll(async () => {
			const kept = await stored(userData);
			return [kept.assistantModes?.code?.mcp, kept.assistantModes?.ask?.mcp];
		})
		// Code turned Serena-less on purpose is kept; Ask uses none by default, so nothing is kept.
		.toEqual([[], undefined]);
	await settings.locator('[data-category="modes"]').click();
	await settings.locator('.mode-tab[data-mode="ask"]').click();
	await expect(settings.locator(".mcp-choice")).toHaveCount(0);
	await expect(settings.locator(".mcp-choice-list")).toContainText(
		"The assistant has no MCP servers yet",
	);
	await settings.locator(".mcp-choice-list").scrollIntoViewIfNeeded();
	await shot(page, "05-no-servers-left");
	expect(errors).toEqual([]);
	await app.close();
});

test("Serena turned off in a mode stays off after a restart, and the CLI is not given it there", async () => {
	const folder = await tempDir("mcp-serena-off");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n");
	const claude = await fakeClaude(folder, "Tamam.", []);
	const userData = await profile({ assistant: true });
	const first = await launch({ userData, args: [doc], env: { KALEM_CLAUDE: claude.path } });
	await expect(first.page.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	let settings = await openSettings(first.app, first.page, "modes");
	await settings.locator('.mode-tab[data-mode="code"]').click();
	await settings.getByRole("switch", { name: "serena" }).uncheck();
	await settings.getByRole("button", { name: "Done" }).click();
	await expect.poll(async () => (await stored(userData)).assistantModes?.code).toEqual({ mcp: [] });
	await first.app.close();

	const { app, page, errors } = await launch({
		userData,
		args: [doc],
		env: { KALEM_CLAUDE: claude.path },
	});
	await expect(page.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	settings = await openSettings(app, page, "modes");
	await settings.locator('.mode-tab[data-mode="code"]').click();
	await expect(settings.getByRole("switch", { name: "serena" })).not.toBeChecked();
	await settings.locator('.mode-tab[data-mode="review"]').click();
	await expect(settings.getByRole("switch", { name: "serena" })).toBeChecked();
	await settings.getByRole("button", { name: "Done" }).click();

	await ask(page, "code", "Giriş ekranına hata mesajı ekle", "Tamam.");
	await ask(page, "prompt", "Bunun için bir prompt hazırla", "Tamam.");
	const [code, prompt] = await questions(claude);
	expect(code?.mcp?.mcpServers.serena).toBeUndefined();
	expect(code?.args).not.toContain("mcp__serena");
	expect(prompt?.mcp?.mcpServers.serena).toBeDefined();
	expect(prompt?.args).toContain("mcp__serena");
	expect(errors).toEqual([]);
	await app.close();
});

test("Serena works on the folder of each question: one added to it, else the Files pane's, else the document's", async () => {
	const folder = await tempDir("mcp-serena-project");
	const docs = join(folder, "docs");
	const project = join(folder, "project");
	const other = join(folder, "other-repo");
	for (const each of [docs, project, other]) await mkdir(each);
	const doc = join(docs, "analiz.md");
	await writeFile(doc, "# Analiz\n");
	const claude = await fakeClaude(folder, "Tamam.", []);
	const userData = await profile({ assistant: true }, [project]);
	const { app, page, errors } = await launch({
		userData,
		args: [doc],
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	const projectOf = (call: {
		mcp?: { mcpServers: Record<string, Record<string, unknown>> } | null;
	}) => (call.mcp?.mcpServers.serena?.args as string[] | undefined)?.at(-1);

	// The folder open in the Files pane, not the document's.
	await ask(page, "code", "Login hatası nerede?", "Tamam.");
	// A folder added to the question comes first: the code is somewhere else this time.
	await app.evaluate(
		({ dialog }, filePaths) => {
			dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as never;
		},
		[other],
	);
	await pane.getByRole("button", { name: "Add files or folders to the chat" }).click();
	await pane.getByRole("menuitem", { name: "Folder…" }).click();
	// The Files pane's folder goes with every question; this one was added for it.
	await expect(pane.locator(".assistant-source:not(.assistant-source-document)")).toHaveText([
		"project",
		"other-repo",
	]);
	await shot(pane, "06-folder-added-to-question");
	await ask(page, "code", "Bu depoda login nerede?", "Tamam.");

	const [first, second] = await questions(claude);
	expect(projectOf(first ?? {})).toBe(project);
	expect(projectOf(second ?? {})).toBe(other);
	const system = second?.args[second.args.indexOf("--append-system-prompt") + 1] ?? "";
	expect(system).toContain(`the user's code at ${other}`);
	expect(errors).toEqual([]);
	await app.close();

	// Without a folder open, the document's.
	const alone = await launch({
		userData: await profile({ assistant: true }),
		args: [doc],
		env: { KALEM_CLAUDE: claude.path },
	});
	await expect(alone.page.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await ask(alone.page, "code", "Login hatası nerede?", "Tamam.");
	expect(projectOf((await questions(claude))[2] ?? {})).toBe(docs);
	await alone.app.close();
});

test("the assistant adds a server and uses it in a mode only once the user sees the whole change and allows it", async () => {
	const folder = await tempDir("mcp-assistant-adds");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n");
	const claude = await fakeClaude(folder, "Context7 eklendi.", [
		{ name: "mode_mcp_list", input: {} },
		{
			name: "mode_mcp_change",
			input: { action: "add", preset: "context7", mode: "ask", reason: "Kütüphane dokümanı için" },
		},
	]);
	const userData = await profile({ assistant: true });
	const { app, page, errors } = await launch({
		userData,
		args: [doc],
		env: { KALEM_CLAUDE: claude.path },
	});
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	await pane.locator(".assistant-mode").click();
	await pane.locator('.assistant-mode-item[data-mode="ask"]').click();
	await pane.locator(".assistant-input").fill("Context7'yi ekle ve Sor modunda kullan");
	await pane.locator(".assistant-input").press("Enter");
	const card = pane.locator(".assistant-approval");
	await expect(card).toContainText(
		"Add the MCP server context7 to the assistant and use it in the Ask mode",
	);
	await expect(card).toContainText("Command: npx -y @upstash/context7-mcp@latest");
	await expect(card).toContainText("Kütüphane dokümanı için");
	await expect(card).toContainText("Tools it may use: All of them");
	await expect(card).not.toContainText("separated by commas");
	// Only once: it can never be allowed for later.
	await expect(card.locator(".assistant-approval-scope")).toBeHidden();
	await shot(card, "07-assistant-approval-card");
	await card.getByRole("button", { name: "Allow" }).click();
	await expect(pane.locator(".assistant-assistant").last()).toContainText("Context7 eklendi.");
	await expect
		.poll(async () => {
			const kept = await stored(userData);
			return [
				kept.assistantMcpServers?.map((server) => server.name),
				kept.assistantModes?.ask?.mcp,
			];
		})
		.toEqual([["serena", "context7"], ["context7"]]);
	const [call] = await questions(claude);
	const listed = call?.tools?.find((each) => each.tool.endsWith("mode_mcp_list"))?.text ?? "";
	expect(listed).toContain("- serena");
	expect(listed).toContain("used in: review, prompt, code");
	expect(listed).not.toContain("git+https://github.com/oraios/serena");
	expect(errors).toEqual([]);
	await app.close();
});
