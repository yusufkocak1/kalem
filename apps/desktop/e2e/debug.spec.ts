import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { KalemBridge } from "../src/shared/bridge.js";
import { fakeJira, JIRA_TOKEN } from "./fake-jira.js";
import { clickMenu, launch } from "./launch.js";

const cleanup: (() => Promise<void>)[] = [];
test.afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

/** The page's bridge to the main process, as the renderer has it. */
declare const window: Window & { readonly kalem: KalemBridge };

/** The View menu's labels. */
async function viewMenu(app: ElectronApplication): Promise<string[]> {
	return app.evaluate(({ Menu }) => {
		const view = Menu.getApplicationMenu()?.items.find((item) => item.label === "View");
		return (view?.submenu?.items ?? []).map((item) => item.label);
	});
}

test("seven clicks on the version open the hidden network log, with the app's requests and no credentials", async () => {
	const jira = await fakeJira();
	cleanup.push(jira.close);
	const { app, page, userData, errors } = await launch();

	// Nothing shows it: no menu item (so no F12 either), no panel.
	expect(await viewMenu(app)).not.toContain("Network Log");
	await expect(page.locator(".network-panel")).toBeHidden();

	// Settings shows the version, small; a few clicks do nothing.
	await clickMenu(app, "File", "Settings…");
	const settings = page.locator(".settings-dialog");
	const version = settings.locator(".settings-version");
	await expect(version).toHaveText(/^Kalem \d+\.\d+\.\d+/);
	for (let i = 0; i < 3; i++) await version.click();
	await expect(settings).toBeVisible();
	await expect(page.locator(".network-panel")).toBeHidden();
	// A pause starts the count again: these three are not part of the seven.
	await page.waitForTimeout(1000);

	// Seven in a row open it.
	for (let i = 0; i < 7; i++) await version.click();
	await expect(settings).toBeHidden();
	const panel = page.locator(".network-panel");
	await expect(panel).toBeVisible();
	await expect(page.locator(".notice", { hasText: "Debug mode is on" })).toBeVisible();
	await expect(panel.locator(".network-empty")).toBeVisible();
	await expect.poll(() => viewMenu(app)).toContain("Network Log");
	const stored = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"));
	expect(stored.debugMode).toBe(true);

	// A request to Jira appears as it is made.
	await page.evaluate(([site, token]) => window.kalem.jiraConnect({ site, username: "", token }), [
		jira.site,
		JIRA_TOKEN,
	] as const);
	const row = panel.locator(".network-row", { hasText: "myself" }).first();
	await expect(row).toBeVisible();
	await expect(row.locator(".network-status")).toHaveText("200");
	await expect(row.locator(".network-method")).toHaveText("GET");
	await expect(row).toContainText("Jira");

	// Its details: the token is masked everywhere.
	await row.click();
	const detail = panel.locator(".network-detail");
	await expect(detail).toBeVisible();
	await expect(detail.locator(".network-headers").first()).toContainText(
		`${jira.site}/rest/api/2/myself`,
	);
	await expect(detail).toContainText("Bearer ••••••");
	await expect(detail).not.toContainText(JIRA_TOKEN);
	await detail.getByRole("tab", { name: "Response" }).click();
	await expect(detail.locator(".network-pre")).toContainText('"name"');

	// The filter and the source buttons narrow the list.
	await panel.locator(".network-filter").fill("no-such-request");
	await expect(panel.locator(".network-empty")).toHaveText("No requests match the filter.");
	await panel.locator(".network-filter").fill("");
	await panel.getByRole("button", { name: "Confluence", exact: true }).click();
	await expect(panel.locator(".network-row:visible")).toHaveCount(0);
	await panel.getByRole("button", { name: "All", exact: true }).click();
	await expect(row).toBeVisible();

	// View › Network Log (F12) closes and opens it now; the rows are still there.
	await clickMenu(app, "View", "Network Log");
	await expect(panel).toBeHidden();
	await clickMenu(app, "View", "Network Log");
	await expect(panel).toBeVisible();
	await expect(row).toBeVisible();
	expect(
		await app.evaluate(
			({ Menu }) =>
				Menu.getApplicationMenu()
					?.items.find((item) => item.label === "View")
					?.submenu?.items.find((item) => item.label === "Network Log")?.accelerator,
		),
	).toBe("F12");

	// Turned off: the panel, the menu items and the log are gone.
	await panel.getByRole("button", { name: "Turn Off Debug Mode" }).click();
	await expect(panel).toBeHidden();
	await expect.poll(() => viewMenu(app)).not.toContain("Network Log");
	expect(JSON.parse(await readFile(join(userData, "settings.json"), "utf8")).debugMode).toBe(false);
	expect(await page.evaluate(() => window.kalem.networkLog())).toEqual({
		recording: false,
		entries: [],
	});

	expect(errors).toEqual([]);
	await app.close();
});
