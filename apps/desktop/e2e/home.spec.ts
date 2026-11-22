import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, stubMessageBox, tempDir } from "./launch.js";

const saved = async (userData: string) =>
	(
		JSON.parse(await readFile(join(userData, "settings.json"), "utf8")) as {
			settings: Record<string, unknown>;
		}
	).settings;

test("the first start asks whom to set Kalem up for, and the pick sets the ribbon, panes and line numbers", async () => {
	const { app, page, userData, errors } = await launch({ welcomed: false });
	const picker = page.locator(".role-picker");
	await expect(picker).toBeVisible();
	await expect(picker.locator(".role-name")).toHaveText(["Writer", "Analyst", "Developer"]);
	await picker.locator('[data-role="developer"]').click();
	await expect(picker).toBeHidden();
	await expect(page.locator(".ribbon")).toHaveAttribute("data-simple", "");
	await expect(page.locator(".files-pane")).toBeVisible();
	await expect.poll(async () => (await saved(userData)).role).toBe("developer");
	expect(await saved(userData)).toMatchObject({ lineNumbers: true, assistant: true });
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();

	// Not asked again; the View menu asks it.
	const again = await launch({ userData });
	await again.page.waitForTimeout(500);
	await expect(again.page.locator(".role-picker")).toBeHidden();
	await clickMenu(again.app, "View", "Set Kalem Up For…");
	await expect(again.page.locator(".role-picker")).toBeVisible();
	await expect(again.page.locator('.role-card[aria-checked="true"]')).toHaveAttribute(
		"data-role",
		"developer",
	);
	await again.page.locator(".role-skip").click();
	await expect(again.page.locator(".role-picker")).toBeHidden();
	await again.app.close();
});

test("Home: the way back to the last document, templates a click away, and one empty tab for it", async () => {
	const folder = await tempDir("home");
	const plan = join(folder, "plan.md");
	await writeFile(plan, "# Plan\n");
	const { app, page, errors } = await launch({ args: [plan] });
	await expect(page.locator("#editor h1")).toHaveText("Plan");

	await clickMenu(app, "View", "Home");
	const start = page.locator(".start-page:visible");
	await expect(start).toBeVisible();
	await expect(start.locator(".start-continue-name")).toHaveText("plan.md");
	await expect(start.locator(".start-template").first()).toBeVisible();
	// Home again: the same empty tab, not another.
	const tabs = page.locator(".doc-tab");
	const count = await tabs.count();
	await clickMenu(app, "View", "Home");
	await expect(tabs).toHaveCount(count);

	// A template, a click away: a new document from it, in the empty tab.
	await start.locator(".start-template").first().click();
	await expect(page.locator(".start-page:visible")).toHaveCount(0);
	await expect(page.locator("#editor h2").first()).toBeVisible();
	await expect(tabs).toHaveCount(count);

	// The way back opens the last document.
	await clickMenu(app, "View", "Home");
	await page.locator(".start-page:visible .start-continue").click();
	await expect(page.locator('.doc-tab[aria-selected="true"]')).toContainText("plan");
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});
