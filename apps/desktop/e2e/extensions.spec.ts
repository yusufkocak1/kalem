import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { fakeClaude } from "./fake-claude.js";
import { clickMenu, launch, stubOpenDialog, tempDir } from "./launch.js";

const PACK = join(import.meta.dirname, "..", "scripts", "pack-extension.mjs");
const SAMPLE = join(import.meta.dirname, "..", "extension-samples", "hello-api");

interface Seen {
	readonly url: string;
	readonly authorization: string | undefined;
}

async function fakeApi(): Promise<{ url: string; seen: Seen[]; close(): Promise<void> }> {
	const seen: Seen[] = [];
	const server = createServer((request, response) => {
		seen.push({ url: request.url ?? "", authorization: request.headers.authorization });
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ service: "hello", healthy: true }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		seen,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

async function captureMessages(app: ElectronApplication): Promise<void> {
	await app.evaluate(({ dialog }) => {
		const kept: string[] = [];
		(globalThis as { messages?: string[] }).messages = kept;
		dialog.showMessageBox = (async (...args: unknown[]) => {
			const options = args.at(-1) as { message: string; detail?: string };
			kept.push(`${options.message}: ${options.detail ?? ""}`);
			return { response: 0, checkboxChecked: false };
		}) as typeof dialog.showMessageBox;
	});
}

const messages = (app: ElectronApplication): Promise<string[]> =>
	app.evaluate(() => [...((globalThis as { messages?: string[] }).messages ?? [])]);

const cleanup: (() => Promise<void>)[] = [];
test.afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

test("an extension is installed after the user sees its permissions, keeps its token, and runs a command", async () => {
	const api = await fakeApi();
	cleanup.push(api.close);
	const folder = await tempDir("extension");
	const packagePath = join(folder, "hello.kalem-ext");
	execFileSync(process.execPath, [PACK, SAMPLE, packagePath]);

	const { app, page, userData, errors } = await launch();
	await stubOpenDialog(app, [packagePath]);
	await captureMessages(app);

	await clickMenu(app, "Extensions", "Manage Extensions…");
	const settings = page.locator('[data-block="extensions"]');
	await expect(settings).toContainText("No extensions are installed.");
	await settings.getByRole("button", { name: "Install from File…" }).click();

	const preview = settings.locator(".ext-preview");
	await expect(preview).toContainText("Install Hello API?");
	await expect(preview).toContainText("Connect to: localhost, 127.0.0.1");
	await expect(preview).toContainText("Give the assistant tools");
	await expect(preview).toContainText("Keep encrypted: API token");
	await preview.getByRole("button", { name: "Install", exact: true }).click();

	const card = settings.locator('.ext-card[data-extension="kalem.hello-api"]');
	await expect(card.locator(".ext-badge")).toHaveText("Running");
	await expect(preview).toBeHidden();

	const address = card.locator("label", { hasText: "API address" }).locator("input");
	await address.fill(api.url);
	await address.press("Tab");
	await card.locator('input[type="password"]').fill("s3cret-token");
	await card.getByRole("button", { name: "Save", exact: true }).click();
	await expect(card.locator('input[type="password"]')).toHaveAttribute("placeholder", "Saved");
	expect(
		await readFile(join(userData, "extensions", "secrets.json"), "utf8").catch(() => ""),
	).not.toContain("s3cret-token");

	await clickMenu(app, "Extensions", "Hello API", "Ping the API");
	await expect
		.poll(() => messages(app))
		.toEqual(['Hello API: The API says: {"service":"hello","healthy":true}']);
	expect(api.seen).toEqual([{ url: "/status", authorization: "Bearer s3cret-token" }]);

	await card.locator(".mode-switch-input").uncheck();
	await expect(card.locator(".ext-badge")).toHaveText("Off");
	await expect
		.poll(() =>
			app.evaluate(({ Menu }) =>
				(
					Menu.getApplicationMenu()?.items.find((item) => item.label === "Extensions")?.submenu
						?.items ?? []
				).map((item) => item.label),
			),
		)
		.toEqual(["Manage Extensions…"]);

	const asked: string[] = [];
	page.once("dialog", (dialog) => {
		asked.push(dialog.message());
		void dialog.accept().catch(() => {});
	});
	await card.getByRole("button", { name: "Uninstall" }).click();
	await expect(settings).toContainText("No extensions are installed.");
	expect(asked).toEqual(["Uninstall Hello API? Its settings and saved secrets are removed too."]);
	expect(errors).toEqual([]);
});

test("an installed extension starts with the app and keeps its settings", async () => {
	const folder = await tempDir("extension-again");
	const packagePath = join(folder, "hello.kalem-ext");
	execFileSync(process.execPath, [PACK, SAMPLE, packagePath]);
	const first = await launch();
	await stubOpenDialog(first.app, [packagePath]);
	await clickMenu(first.app, "Extensions", "Manage Extensions…");
	const settings = first.page.locator('[data-block="extensions"]');
	await settings.getByRole("button", { name: "Install from File…" }).click();
	await settings
		.locator(".ext-preview")
		.getByRole("button", { name: "Install", exact: true })
		.click();
	const address = settings.locator("label", { hasText: "API address" }).locator("input");
	await address.fill("http://127.0.0.1:9999");
	await address.press("Tab");
	await expect
		.poll(async () =>
			(await readFile(join(first.userData, "extensions", "state.json"), "utf8")).includes("9999"),
		)
		.toBe(true);
	await first.app.close();

	const { app, page } = await launch({ userData: first.userData });
	await expect
		.poll(() =>
			app.evaluate(({ Menu }) =>
				(
					Menu.getApplicationMenu()?.items.find((item) => item.label === "Extensions")?.submenu
						?.items ?? []
				).map((item) => item.label),
			),
		)
		.toContain("Hello API");
	await clickMenu(app, "Extensions", "Manage Extensions…");
	const card = page.locator('.ext-card[data-extension="kalem.hello-api"]');
	await expect(card.locator(".ext-badge")).toHaveText("Running");
	await expect(card.locator("label", { hasText: "API address" }).locator("input")).toHaveValue(
		"http://127.0.0.1:9999",
	);
});

test("an extension's tool answers the assistant, and the extension reaches only the hosts it was allowed", async () => {
	test.skip(process.platform === "win32", "The stand-in CLI is a Unix script.");
	const api = await fakeApi();
	cleanup.push(api.close);
	const folder = await tempDir("extension-probe");
	const source = join(folder, "probe");
	await mkdir(source);
	await writeFile(
		join(source, "manifest.json"),
		JSON.stringify({
			id: "test.probe",
			name: "Probe",
			version: "1.0.0",
			host: "host.js",
			permissions: { http: ["127.0.0.1"], assistantTools: true },
			contributes: { settings: [{ key: "url", type: "string", default: api.url }] },
		}),
	);
	await writeFile(
		join(source, "host.js"),
		`export async function activate(kalem) {
	const url = await kalem.settings.get("url");
	await kalem.assistant.registerTool({ name: "probe_status", description: "Status." }, async () => {
		const response = await kalem.http.fetch(url + "/status");
		return response.body;
	});
	await kalem.assistant.registerTool({ name: "probe_escape", description: "Tries to get out." }, async () => {
		const results = [];
		try { await fetch(url + "/direct"); results.push("direct: reached"); } catch { results.push("direct: blocked"); }
		try { await kalem.http.fetch("http://localhost:1/other"); results.push("other: reached"); } catch (error) { results.push("other: " + error.message); }
		return results.join("\\n");
	});
}
`,
	);
	const packagePath = join(folder, "probe.kalem-ext");
	execFileSync(process.execPath, [PACK, source, packagePath]);

	const claude = await fakeClaude(folder, "Tamam.", [
		{ name: "probe_status", input: {} },
		{ name: "probe_escape", input: {} },
	]);
	const { app, page } = await launch({
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	await stubOpenDialog(app, [packagePath]);
	await clickMenu(app, "Extensions", "Manage Extensions…");
	const settings = page.locator('[data-block="extensions"]');
	await settings.getByRole("button", { name: "Install from File…" }).click();
	await settings
		.locator(".ext-preview")
		.getByRole("button", { name: "Install", exact: true })
		.click();
	await expect(settings.locator(".ext-badge")).toHaveText("Running");
	await page.keyboard.press("Escape");

	const pane = page.locator(".assistant");
	await expect(pane.locator(".assistant-input")).toBeVisible();
	await pane.locator(".assistant-input").fill("Servis ayakta mı?");
	await pane.locator(".assistant-input").press("Enter");
	await expect(
		pane.locator(".assistant-assistant").last().locator(".assistant-markdown"),
	).toContainText("Tamam.");

	const [call] = await claude.calls();
	const [status, escaped] = call?.tools ?? [];
	expect(status?.text).toBe('{"service":"hello","healthy":true}');
	expect(escaped?.text).toContain("direct: blocked");
	expect(escaped?.text).toContain(
		'other: The extension may not reach http://localhost:1/other: add its host to "permissions.http".',
	);
	expect(api.seen.map((each) => each.url)).toEqual(["/status"]);
});
