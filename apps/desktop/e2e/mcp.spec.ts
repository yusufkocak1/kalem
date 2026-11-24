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
	readonly assistantMcpServers?: readonly { readonly name: string; readonly keepAlive?: boolean }[];
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
	const settings = await openSettings(app, page, "mcp");
	const block = settings.locator('[data-block="mcp"]');
	// Serena, which the assistant starts with, and each server once; a different one of a taken name is files-2.
	await expect(block.locator(".mcp-pick")).toHaveCount(4);
	expect(
		await block
			.locator(".mcp-pick")
			.evaluateAll((picks) => picks.map((pick) => (pick as HTMLElement).dataset.server)),
	).toEqual(["serena", "i18n-db", "files", "files-2"]);
	// The list says how many modes use each; the chosen one's settings say which.
	await expect(block.locator('.mcp-pick[data-server="i18n-db"]')).toContainText("1 modes");
	const usedIn = async (server: string): Promise<void> => {
		await block.locator(`.mcp-pick[data-server="${server}"]`).click();
	};
	await usedIn("files-2");
	await expect(block.locator('.mcp-card[data-server="files-2"] .mcp-used-in')).toHaveText(
		"Used in: Test Analisti",
	);
	await usedIn("serena");
	await expect(block.locator('.mcp-card[data-server="serena"] .mcp-used-in')).toHaveText(
		"Used in: Review analysis, Prepare prompt, Code",
	);
	await usedIn("i18n-db");
	await expect(block.locator('.mcp-card[data-server="i18n-db"] .mcp-used-in')).toHaveText(
		"Used in: Code",
	);
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
	const settings = await openSettings(app, page, "mcp");
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
	await settings.locator('[data-category="mcp"]').click();
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

/** A stdio MCP server that holds a count, as a browser holds a sign-in: `open` counts up. */
const COUNTER = `
let opened = 0;
let rest = "";
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	rest += chunk;
	let at;
	while ((at = rest.indexOf("\\n")) !== -1) {
		const message = JSON.parse(rest.slice(0, at));
		rest = rest.slice(at + 1);
		if (message.method === "initialize") {
			send({ id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "counter", version: "1" } } });
		} else if (message.method === "tools/call") {
			opened++;
			send({ id: message.id, result: { content: [{ type: "text", text: "open:" + opened + ":" + process.pid }] } });
		}
	}
});
process.stdin.on("end", () => process.exit(0));
`;

test("a server kept running between questions still holds what it held at the next one", async () => {
	const folder = await tempDir("mcp-kept");
	const script = join(folder, "counter.cjs");
	await writeFile(script, COUNTER);
	const claude = await fakeClaude(folder, "Tamam.", [{ name: "open", input: {}, server: "sayac" }]);
	const counter = {
		name: "sayac",
		transport: "stdio",
		command: process.execPath,
		args: [script],
		purpose: "A count.",
	};
	const userData = await profile({
		assistant: true,
		assistantMcpServers: [{ ...counter, keepAlive: true }],
		assistantModes: { ask: { mcp: ["sayac"] } },
	});
	const { app, page, errors } = await launch({ userData, env: { KALEM_CLAUDE: claude.path } });
	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-subtitle")).toHaveText("9.9.9 (Claude Code)");
	const opened = async (n: number): Promise<string> => {
		await expect.poll(async () => (await questions(claude)).length).toBe(n);
		return (await questions(claude))[n - 1]?.tools?.[0]?.text ?? "";
	};

	// Two questions, two CLIs: the same server, its count still there.
	await ask(page, "ask", "Bir", "Tamam.");
	const first = await opened(1);
	expect(first).toMatch(/^open:1:\d+$/);
	await ask(page, "ask", "İki", "Tamam.");
	expect(await opened(2)).toBe(`open:2:${first.split(":")[2]}`);
	// The CLI was given Kalem's stand-in for it, not the program itself.
	const config = (await questions(claude))[1]?.mcp?.mcpServers.sayac ?? {};
	expect(config.args).toEqual([expect.stringMatching(/kalem-kept\.cjs$/)]);
	expect(JSON.stringify(config)).not.toContain(script);

	// Set to run per question in Settings: each CLI starts it anew.
	const settings = await openSettings(app, page, "mcp");
	const keep = settings.locator('.mcp-card[data-server="sayac"] input[data-setting="keepAlive"]');
	await expect(keep).toBeChecked();
	await expect(settings.locator('.mcp-card[data-server="sayac"]')).toContainText(
		"Keep it running between questions",
	);
	await keep.uncheck();
	await expect
		.poll(async () => (await stored(userData)).assistantMcpServers)
		.toEqual([expect.objectContaining({ name: "sayac", keepAlive: false })]);
	await settings.getByRole("button", { name: "Done" }).click();
	await ask(page, "ask", "Üç", "Tamam.");
	const third = await opened(3);
	expect(third).toMatch(/^open:1:\d+$/);
	expect(third.split(":")[2]).not.toBe(first.split(":")[2]);
	expect((await questions(claude))[2]?.mcp?.mcpServers.sayac?.args).toEqual([script]);
	expect(errors).toEqual([]);
	await app.close();
});
