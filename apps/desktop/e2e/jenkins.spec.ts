import type { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { installSample } from "./api-fakes.js";
import { fakeClaude } from "./fake-claude.js";
import { fakeJenkins, JENKINS_TOKEN, JENKINS_USER, quickPipelineConfig } from "./fake-jenkins.js";
import { launch, tempDir } from "./launch.js";

const cleanup: (() => Promise<void>)[] = [];
test.afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

async function installJenkins(
	app: ElectronApplication,
	page: Page,
	url: string,
): Promise<FrameLocator> {
	const pane = await installSample(
		app,
		page,
		"jenkins",
		"jenkins",
		"Jenkins",
		"en",
		async (card) => {
			const field = (title: string) => card.locator("label", { hasText: title }).locator("input");
			await field("Jenkins address").fill(url);
			await field("Jenkins address").press("Tab");
			await field("User name").fill(JENKINS_USER);
			await field("User name").press("Tab");
			await card.locator('input[type="password"]').fill(JENKINS_TOKEN);
			await card.getByRole("button", { name: "Save", exact: true }).click();
			await expect(card.locator('input[type="password"]')).toHaveAttribute("placeholder", "Saved");
		},
	);
	await expect(pane.locator(".jk-connection")).toContainText(
		"Connected · Demo User · Jenkins 2.462.3",
	);
	return pane;
}

async function importQuickPipeline(pane: FrameLocator, url: string): Promise<void> {
	await pane.getByRole("button", { name: "Import QuickPipeline" }).click();
	const dialog = pane.locator(".jk-dialog");
	await dialog.locator(".jk-import-text").fill(JSON.stringify(quickPipelineConfig(url)));
	await dialog.locator(".jk-dialog-actions").getByRole("button", { name: "Import" }).click();
	await expect(dialog.locator(".k-notice")).toContainText(
		"Imported 1 pipelines, 4 groups, 4 targets and 4 quick actions.",
	);
	await dialog.getByRole("button", { name: "Close" }).last().click();
}

const node = (pane: FrameLocator, name: string) =>
	pane.locator(".jk-node", { hasText: name }).first();

test("Jenkins runs QuickPipeline's quick actions on a group's targets with their inherited parameters, and follows the builds", async () => {
	const jenkins = await fakeJenkins();
	cleanup.push(jenkins.close);
	const { app, page, errors } = await launch();
	await page.setViewportSize({ width: 1500, height: 950 });
	const pane = await installJenkins(app, page, jenkins.url);

	await expect(pane.locator(".jk-main .k-empty")).toContainText("No groups yet");
	await importQuickPipeline(pane, jenkins.url);
	await expect(pane.locator(".jk-tree .jk-node-name")).toHaveText([
		"Test Ortamı",
		"CRM",
		"crm-web",
		"crm-api",
		"Billing",
		"billing-core",
		"Preprod",
		"crm-web",
	]);

	await node(pane, "crm-api").click();
	const rows = pane.locator(".jk-params tbody tr");
	await expect(rows.filter({ hasText: "admin_url" }).locator(".jk-value")).toHaveText(
		"t3://10.80.13.21:12000",
	);
	await expect(rows.filter({ hasText: "admin_url" }).locator(".jk-source")).toHaveText(
		"group: Test Ortamı",
	);
	await expect(rows.filter({ hasText: "application_name" }).locator(".jk-value")).toHaveText(
		"crm-api",
	);
	await expect(rows.filter({ hasText: "application_name" }).locator(".jk-source")).toHaveText(
		"target",
	);
	await expect(rows.filter({ hasText: "action" }).first().locator(".jk-source")).toHaveText(
		"default",
	);

	await node(pane, "Test Ortamı").click({ button: "right" });
	await pane.locator(".jk-menu").getByRole("menuitem", { name: "Restart (3)" }).click();
	const preview = pane.locator(".jk-dialog");
	await expect(preview.locator(".jk-dialog-head h2")).toHaveText("Restart — 3 targets");
	await expect(preview.locator(".jk-preview-item")).toHaveCount(3);
	await expect(preview.locator(".jk-preview-item").first()).toContainText("t3://10.80.13.21:12000");
	await preview.getByRole("button", { name: "Run (3)" }).click();

	const runs = pane.locator(".jk-runs .jk-run");
	await expect(runs).toHaveCount(3);
	await expect(page.locator('.ext-status-item[data-extension="kalem.jenkins"]')).toContainText(
		"Jenkins ▶",
	);
	await expect(runs.locator(".k-badge.info").first()).toBeVisible();
	await expect(runs.locator(".k-badge.ok")).toHaveCount(3, { timeout: 20_000 });
	const byTarget = Object.fromEntries(
		jenkins.triggered.map((each) => [each.params.application_name, each.params]),
	);
	expect(byTarget).toEqual({
		"crm-web": {
			action: "Restart",
			application_name: "crm-web",
			application_version: "-",
			admin_url: "t3://10.80.13.21:12000",
		},
		"crm-api": {
			action: "Restart",
			application_name: "crm-api",
			application_version: "2.4",
			admin_url: "t3://10.80.13.21:12000",
		},
		BillingCore: {
			action: "Restart",
			application_name: "BillingCore",
			application_version: "-",
			admin_url: "t3://10.80.13.15:12000",
		},
	});

	await node(pane, "crm-api").click();
	await pane.locator(".jk-actions").getByRole("button", { name: "Fail" }).click();
	await expect(runs.first()).toContainText("crm-api");
	await expect(runs.first().locator(".k-badge")).toHaveText("FAILURE", { timeout: 20_000 });
	await runs.first().getByRole("button", { name: "Console" }).click();
	const consoleBox = pane.locator(".jk-dialog .jk-console");
	await expect(consoleBox).toContainText("ERROR: crm-api could not be found on the server");
	await expect(pane.locator(".jk-dialog .jk-stage")).toHaveCount(2);
	await expect(pane.locator('.jk-dialog .jk-stage[data-status="FAILED"]')).toContainText("Fail");
	await pane.locator(".jk-dialog").getByRole("button", { name: "Close" }).last().click();

	await pane.getByRole("tab", { name: "Jobs" }).click();
	await pane.locator(".jk-side .k-list-item", { hasText: "WL" }).click();
	await expect(pane.locator(".jk-crumbs")).toContainText("WL");
	await pane.locator(".jk-side .k-list-item", { hasText: "datasource" }).click();
	await expect(pane.locator(".jk-builds tbody tr")).toHaveCount(1);
	await expect(pane.locator(".jk-builds tbody tr").first()).toContainText("#7");
	await pane.locator(".jk-detail-head").getByRole("button", { name: "Run" }).click();
	await expect(runs.first()).toContainText("WL / datasource");
	await expect(runs.first().locator(".k-badge")).toHaveText("SUCCESS", { timeout: 20_000 });
	expect(jenkins.triggered.at(-1)).toMatchObject({ job: "WL/datasource", number: 8 });

	await pane.getByRole("button", { name: "History" }).click();
	await expect(runs).toHaveCount(5);
	expect(errors).toEqual([]);
});

test("the assistant reads why a Jenkins build failed through the extension's tools", async () => {
	test.skip(process.platform === "win32", "The stand-in CLI is a Unix script.");
	const jenkins = await fakeJenkins(100);
	cleanup.push(jenkins.close);
	const folder = await tempDir("jenkins-agent");
	const claude = await fakeClaude(folder, "Datasource build'i başarılı.", [
		{ name: "jenkins_job_status", input: { job: "WL" } },
		{ name: "jenkins_build_log", input: { job: "WL/datasource", build: "last", lines: 20 } },
	]);
	const { app, page } = await launch({
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	await installJenkins(app, page, jenkins.url);
	await page.keyboard.press("Escape");

	const assistant = page.locator(".assistant");
	await assistant.locator(".assistant-input").fill("Datasource job'ı neden kırıldı?");
	await assistant.locator(".assistant-input").press("Enter");
	await expect(
		assistant.locator(".assistant-assistant").last().locator(".assistant-markdown"),
	).toContainText("Datasource build'i başarılı.");
	const [call] = await claude.calls();
	const [status, log] = call?.tools ?? [];
	expect(status?.text).toBe("- app-actions: never built\n- datasource: #7 SUCCESS");
	expect(log?.text).toContain("#7: SUCCESS");
	expect(log?.text).toContain("Reset datasource jdbc/crm");
});
