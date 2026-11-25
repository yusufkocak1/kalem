import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import type { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { fakeClaude } from "./fake-claude.js";
import { clickMenu, launch, stubOpenDialog, tempDir } from "./launch.js";

const PACK = join(import.meta.dirname, "..", "scripts", "pack-extension.mjs");
const SAMPLE = join(import.meta.dirname, "..", "extension-samples", "run-configurations");
/** A Tomcat to run, unpacked; its tests are skipped without one. */
const TOMCAT = process.env.KALEM_TEST_TOMCAT ?? "";

test.skip(process.platform === "win32", "The stand-ins are Unix scripts.");

async function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

async function launchWith(
	folder: string,
	extra: { env?: Record<string, string>; settings?: Record<string, unknown> } = {},
) {
	const userData = await tempDir("profile");
	await writeFile(
		join(userData, "settings.json"),
		JSON.stringify({
			settings: { language: "en", theme: "light", restoreSession: false, ...extra.settings },
			welcomed: true,
			workspaces: [folder],
		}),
	);
	const launched = await launch({
		userData,
		...(extra.env === undefined ? {} : { env: extra.env }),
	});
	await launched.app.evaluate(({ shell }) => {
		const opened: string[] = [];
		(globalThis as { opened?: string[] }).opened = opened;
		shell.openExternal = async (url: string) => {
			opened.push(url);
		};
	});
	return launched;
}

const opened = (app: ElectronApplication): Promise<string[]> =>
	app.evaluate(() => [...((globalThis as { opened?: string[] }).opened ?? [])]);

async function installRunner(app: ElectronApplication, page: Page): Promise<FrameLocator> {
	const packagePath = join(await tempDir("runner"), "run.kalem-ext");
	execFileSync(process.execPath, [PACK, SAMPLE, packagePath]);
	await stubOpenDialog(app, [packagePath]);
	await clickMenu(app, "Extensions", "Manage Extensions…");
	const settings = page.locator('[data-block="extensions"]');
	await settings.locator(".ext-intro").getByRole("button", { name: "Install from File…" }).click();
	const preview = settings.locator(".ext-preview");
	await expect(preview).toContainText("Run programs on this computer");
	await expect(preview).toContainText("Read and write files on this computer");
	await preview.getByRole("button", { name: "Install", exact: true }).click();
	await expect(settings.locator(".ext-badge")).toHaveText("Running");
	await page.locator('.stripe-bottom [data-pane="ext:kalem.run-configurations/run"]').click();
	return page.frameLocator('iframe.ext-pane-frame[title="Run"]');
}

async function writeConfigs(folder: string, configurations: unknown[]): Promise<void> {
	await mkdir(join(folder, ".kalem"), { recursive: true });
	await writeFile(
		join(folder, ".kalem", "run.json"),
		JSON.stringify({ version: 1, configurations }),
	);
}

const statusItem = (page: Page) =>
	page.locator('.ext-status-item[data-extension="kalem.run-configurations"]');

test("an npm dev server runs after its before-launch step, opens the browser at its address, and stops", async () => {
	const folder = await tempDir("web");
	await writeFile(
		join(folder, "package.json"),
		JSON.stringify({ name: "web", scripts: { dev: "node server.js", lint: "echo lint" } }),
	);
	await writeFile(
		join(folder, "server.js"),
		`const server = require("node:http").createServer((_, res) => res.end("ok"));
server.listen(0, () => console.log("\\n  \\u001b[32m➜\\u001b[39m  Local:   http://localhost:" + server.address().port + "/\\n"));
`,
	);
	const { app, page, errors } = await launchWith(folder);
	const pane = await installRunner(app, page);
	await expect(pane.locator(".output")).toContainText("No run configurations yet");

	await pane.getByRole("button", { name: "Edit Configurations…" }).click();
	await pane.locator("#add").selectOption({ label: "Command" });
	await pane.locator('input[name="name"]').fill("Build");
	await pane
		.locator('textarea[name="commandLine"]')
		.fill(`node -e "console.log('built ' + process.env.MODE)"`);
	await pane.locator('textarea[name="env"]').fill("MODE=prod");
	await pane.locator("#add").selectOption({ label: "npm script" });
	await pane.locator('input[name="name"]').fill("Web");
	await pane.locator('input[name="script"]').fill("dev");
	await expect(pane.locator("datalist option")).toHaveCount(2);
	await pane.getByLabel("Build").check();
	await pane.getByRole("button", { name: "Save" }).click();
	await expect(pane.locator("#editor")).toBeHidden();

	const stored = JSON.parse(await readFile(join(folder, ".kalem", "run.json"), "utf8"));
	expect(stored.configurations).toEqual([
		{
			name: "Build",
			type: "command",
			encoding: "utf-8",
			commandLine: `node -e "console.log('built ' + process.env.MODE)"`,
			env: "MODE=prod",
		},
		{
			name: "Web",
			type: "npm",
			packageManager: "auto",
			openBrowser: true,
			script: "dev",
			beforeLaunch: ["Build"],
		},
	]);
	await expect(pane.locator("#selected")).toHaveValue("Web");
	await expect(statusItem(page)).toHaveText("▶ Web");

	await statusItem(page).click();
	const output = pane.locator(".output");
	await expect(output).toContainText("Before launch: Build");
	await expect(pane.locator('.tab[data-session] >> text="Build"')).toBeVisible();
	await expect(output).toContainText("npm run dev");
	await expect(output).toContainText(/Local:\s+http:\/\/localhost:\d+\//);
	await expect
		.poll(() => opened(app))
		.toEqual([expect.stringMatching(/^http:\/\/localhost:\d+\/$/)]);
	await expect(statusItem(page)).toHaveText("■ Web");
	const url = (await opened(app))[0] as string;
	expect(await (await fetch(url)).text()).toBe("ok");

	await pane.getByRole("button", { name: "■ Stop" }).click();
	await expect(output).toContainText("Process finished with exit code");
	await expect(statusItem(page)).toHaveText("▶ Web");
	await expect(fetch(url)).rejects.toThrow();

	await pane.locator('.tab:has-text("Build")').click();
	await expect(output).toContainText("built prod");
	await expect(output).toContainText("Process finished with exit code 0");
	expect(errors).toEqual([]);
});

test("a Java class runs as an Application, and a failing step stops what comes after it", async () => {
	const folder = await tempDir("java");
	await mkdir(join(folder, "src"), { recursive: true });
	await writeFile(
		join(folder, "src", "Hello.java"),
		'public class Hello { public static void main(String[] a) { System.out.println("Merhaba " + a[0] + " " + System.getenv("WHO")); System.exit(0); } }\n',
	);
	execFileSync("javac", [
		"-d",
		join(folder, "target", "classes"),
		join(folder, "src", "Hello.java"),
	]);
	await writeConfigs(folder, [
		{
			name: "Hello",
			type: "application",
			mainClass: "Hello",
			classpath: "target/classes",
			programArgs: "dünya",
			env: "WHO=Kalem\nLANG=C.UTF-8",
			mavenClasspath: false,
		},
		{ name: "Broken", type: "command", commandLine: "echo half; exit 4" },
		{ name: "Maven", type: "maven", goals: "-v" },
		{ name: "After broken", type: "command", commandLine: "echo never", beforeLaunch: ["Broken"] },
	]);
	const { app, page } = await launchWith(folder);
	const pane = await installRunner(app, page);
	await expect(pane.locator("#selected option")).toHaveCount(4);

	await pane.locator("#selected").selectOption("Maven");
	await pane.getByRole("button", { name: "▶ Run" }).click();
	await expect(pane.locator(".output")).toContainText("Apache Maven");
	await expect(pane.locator(".output")).toContainText("Process finished with exit code 0");

	await pane.locator("#selected").selectOption("Hello");
	await pane.getByRole("button", { name: "▶ Run" }).click();
	const output = pane.locator(".output");
	await expect(output).toContainText("Merhaba dünya Kalem");
	await expect(output).toContainText("Process finished with exit code 0");

	await pane.locator("#selected").selectOption("After broken");
	await pane.getByRole("button", { name: "▶ Run" }).click();
	await expect(output).toContainText('"Broken" failed (exit code 4): After broken is not run.');
	await expect(output).not.toContainText("never");
	await expect(
		pane.locator(".tab").filter({ hasText: "After broken" }).locator(".dot"),
	).toHaveAttribute("data-status", "failed");
});

test("Tomcat runs a web application on its own port, with a base of its own, and stops", async () => {
	test.skip(
		TOMCAT === "" || !existsSync(join(TOMCAT, "bin", "catalina.sh")),
		"KALEM_TEST_TOMCAT is not set.",
	);
	test.setTimeout(120_000);
	const folder = await tempDir("tomcat");
	await mkdir(join(folder, "web", "WEB-INF"), { recursive: true });
	await writeFile(join(folder, "web", "index.html"), "<h1>Merhaba Tomcat</h1>");
	const port = await freePort();
	await writeConfigs(folder, [
		{
			name: "Sipariş Servisi",
			type: "tomcat",
			tomcatHome: TOMCAT,
			artifact: "web",
			contextPath: "/order",
			httpPort: port,
			openBrowser: true,
			vmOptions: "-Xmx256m",
		},
	]);
	const { app, page } = await launchWith(folder);
	const pane = await installRunner(app, page);
	await pane.getByRole("button", { name: "▶ Run" }).click();
	const output = pane.locator(".output");
	await expect(output).toContainText("Server startup in", { timeout: 60_000 });
	const url = `http://localhost:${port}/order/`;
	await expect.poll(() => opened(app)).toEqual([url]);
	expect(await (await fetch(url)).text()).toBe("<h1>Merhaba Tomcat</h1>");

	const base = join(folder, ".kalem", "run", "tomcat", "Siparis-Servisi");
	expect(await readFile(join(base, "conf", "server.xml"), "utf8")).toContain(
		`<Connector port="${port}"`,
	);
	expect(
		await readFile(join(base, "conf", "Catalina", "localhost", "order.xml"), "utf8"),
	).toContain(`docBase="${join(folder, "web")}"`);
	expect(existsSync(join(base, "conf", "web.xml"))).toBe(true);
	expect(await readFile(join(folder, ".kalem", "run", ".gitignore"), "utf8")).toBe("*\n");

	await pane.getByRole("button", { name: "■ Stop" }).click();
	await expect(output).toContainText("Process finished with exit code");
	await expect
		.poll(() =>
			fetch(url).then(
				() => "up",
				() => "down",
			),
		)
		.toBe("down");
});

test("the assistant lists, runs and reads a run configuration once the user allows it", async () => {
	const folder = await tempDir("runner-agent");
	await writeConfigs(folder, [
		{ name: "Tests", type: "command", commandLine: "echo '3 passed, 1 failed: OrderTest'; exit 1" },
	]);
	const claude = await fakeClaude(folder, "Bir test başarısız.", [
		{ name: "run_configurations", input: {} },
		{ name: "run_configuration_start", input: { name: "Tests" } },
		{ name: "run_configuration_output", input: { name: "Tests" } },
	]);
	const { app, page } = await launchWith(folder, {
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	await installRunner(app, page);
	await page.keyboard.press("Escape");
	const assistant = page.locator(".assistant");
	await assistant.locator(".assistant-input").fill("Testleri çalıştır");
	await assistant.locator(".assistant-input").press("Enter");
	const card = assistant.locator(".assistant-approval").first();
	await expect(card).toContainText("Run Configurations: run run_configuration_start?");
	await expect(card).toContainText('"name": "Tests"');
	await card.getByRole("button", { name: "Allow" }).click();
	await expect(
		assistant.locator(".assistant-assistant").last().locator(".assistant-markdown"),
	).toContainText("Bir test başarısız.");
	const [call] = await claude.calls();
	const [list, started, output] = call?.tools ?? [];
	expect(list?.text).toBe("- Tests [Command]: not run");
	expect(started?.text).toContain("Tests: failed.");
	expect(output?.text).toContain("Tests: failed (exit code 1)");
	expect(output?.text).toContain("3 passed, 1 failed: OrderTest");
});
