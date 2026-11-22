import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launch, tempDir } from "./launch.js";

test("the documents' tabs are in the title bar Kalem draws, which drags the window", async () => {
	const { app, page, errors } = await launch();
	const bar = page.locator(".title-bar");
	await expect(bar).toBeVisible();
	await expect(bar.locator(".doc-tab")).toHaveCount(1);
	// Above the ribbon, as tall as the system's window buttons over its right end.
	const box = await bar.boundingBox();
	expect(box?.y).toBe(0);
	expect(box?.height).toBe(38);
	const ribbonTop = await page
		.locator(".ribbon")
		.evaluate((ribbon) => ribbon.getBoundingClientRect().top);
	expect(ribbonTop).toBeGreaterThanOrEqual(38);
	const region = (selector: string) =>
		page
			.locator(selector)
			.first()
			.evaluate((element) => getComputedStyle(element).getPropertyValue("app-region"));
	expect(await region(".title-bar")).toBe("drag");
	expect(await region(".title-bar .doc-tab")).toBe("no-drag");
	expect(await region(".title-bar .doc-tab-new")).toBe("no-drag");
	// File and the quick access buttons are at its left, before the tabs.
	await expect(bar.locator(".ribbon-file")).toBeVisible();
	await expect(bar.locator('.ribbon-quick [data-command="save"]')).toBeVisible();
	expect(await region(".title-bar .ribbon-head")).toBe("no-drag");
	expect(
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
				"navigator.windowControlsOverlay?.visible ?? null",
			),
		),
	).toBe(process.platform === "darwin" ? null : true);
	expect(errors).toEqual([]);
	await app.close();
});

test("with the tabs out of the title bar, the system draws it and the tabs are under the ribbon", async () => {
	const { app, page, errors } = await launch({ settings: { tabsInTitleBar: false } });
	await expect(page.locator(".doc-tab")).toHaveCount(1);
	await expect(page.locator(".title-bar")).toHaveCount(0);
	const ribbonBottom = await page
		.locator(".ribbon")
		.evaluate((ribbon) => ribbon.getBoundingClientRect().bottom);
	const tabTop = await page
		.locator(".tabstrip")
		.evaluate((strip) => strip.getBoundingClientRect().top);
	expect(tabTop).toBeGreaterThanOrEqual(ribbonBottom - 1);
	expect(errors).toEqual([]);
	await app.close();
});

test("under the title bar the simplified ribbon is one row, its tabs a menu at its start", async () => {
	const { app, page, errors } = await launch({ settings: { ribbonSimple: true } });
	const ribbon = page.locator(".ribbon");
	await expect(ribbon).toHaveAttribute("data-one-row", "");
	await expect(page.locator(".ribbon-top")).toBeHidden();
	// The title bar and one row of buttons: as tall as about two rows.
	const bottom = await ribbon.evaluate((element) => element.getBoundingClientRect().bottom);
	expect(bottom).toBeLessThan(90);

	const pick = page.locator(".ribbon-switch");
	await expect(pick).toHaveText("Home");
	await pick.click();
	await expect(page.locator(".ribbon-switch-menu")).toBeVisible();
	await page.locator('.ribbon-switch-item[data-tab="insert"]').click();
	await expect(page.locator(".ribbon-switch-menu")).toBeHidden();
	await expect(pick).toHaveText("Insert");
	await expect(page.locator('[data-command="import-word"]')).toBeVisible();

	// The full ribbon has its tab row back.
	await page.locator(".ribbon-simplify").click();
	await expect(ribbon).not.toHaveAttribute("data-one-row", "");
	await expect(page.locator(".ribbon-tabs")).toBeVisible();
	await expect(pick).toHaveCount(0);
	expect(errors).toEqual([]);
	await app.close();
});

test("above the page, where the document is: a folder lists what is in it, a file there opens", async () => {
	const folder = await tempDir("path-bar");
	await mkdir(join(folder, "specs"));
	const doc = join(folder, "specs", "odeme.md");
	await writeFile(doc, "# Ödeme\n");
	await writeFile(join(folder, "specs", "iade.md"), "# İade\n");
	const { app, page, errors } = await launch({ args: [doc] });
	const bar = page.locator(".path-bar");
	await expect(bar.locator(".path-bar-part")).toHaveText(["specs", "odeme.md"]);
	await bar.locator(".path-bar-button", { hasText: "odeme.md" }).click();
	const menu = page.locator(".path-bar-menu");
	await expect(menu.locator(".path-bar-item")).toHaveText(["iade.md", "odeme.md"]);
	await menu.locator(".path-bar-item", { hasText: "iade.md" }).click();
	await expect(page.locator("#editor h1", { hasText: "İade" })).toBeVisible();
	await expect(bar.locator(".path-bar-part")).toHaveText(["specs", "iade.md"]);
	expect(errors).toEqual([]);
	await app.close();
});
