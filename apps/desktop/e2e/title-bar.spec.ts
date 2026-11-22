import { expect, test } from "@playwright/test";
import { launch } from "./launch.js";

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
