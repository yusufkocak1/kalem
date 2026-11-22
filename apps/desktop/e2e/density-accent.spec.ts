import { expect, test } from "@playwright/test";
import { clickMenu, launch } from "./launch.js";

const height = (page: import("@playwright/test").Page, selector: string) =>
	page
		.locator(selector)
		.first()
		.evaluate((element) => Math.round(element.getBoundingClientRect().height));

test("density brings the app's rows and buttons closer together, or further apart", async () => {
	const { app, page, errors } = await launch();
	await expect(page.locator(":root")).toHaveAttribute("data-density", "standard");
	const standard = {
		top: await height(page, ".ribbon-top"),
		button: await height(page, ".ribbon-panel:not([hidden]) .ribbon-button"),
		status: await height(page, ".statusbar"),
	};

	await clickMenu(app, "View", "Density", "Compact");
	await expect(page.locator(":root")).toHaveAttribute("data-density", "compact");
	expect(await height(page, ".ribbon-top")).toBeLessThan(standard.top);
	expect(await height(page, ".ribbon-panel:not([hidden]) .ribbon-button")).toBeLessThan(
		standard.button,
	);
	expect(await height(page, ".statusbar")).toBeLessThan(standard.status);

	await clickMenu(app, "View", "Density", "Comfortable");
	await expect(page.locator(":root")).toHaveAttribute("data-density", "comfortable");
	expect(await height(page, ".ribbon-top")).toBeGreaterThan(standard.top);
	expect(await height(page, ".statusbar")).toBeGreaterThan(standard.status);
	expect(errors).toEqual([]);
	await app.close();
});

test("the accent can be the system's, made dark enough to read on the light theme", async () => {
	// Windows' yellow: too light on white as it is.
	const { app, page, errors } = await launch({ env: { KALEM_SYSTEM_ACCENT: "FFB900FF" } });
	const accent = () =>
		page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue("--app-accent").trim(),
		);
	expect(await accent()).toBe("#0f4e4a");

	await clickMenu(app, "View", "Accent Colour", "The System's (Windows, macOS)");
	await expect.poll(accent).not.toBe("#0f4e4a");
	const fitted = await accent();
	// Still a yellow, darkened: red above blue.
	const [r, , b] = [1, 3, 5].map((at) => Number.parseInt(fitted.slice(at, at + 2), 16)) as [
		number,
		number,
		number,
	];
	expect(r).toBeGreaterThan(b);
	// The selected ribbon tab's line is in it.
	const line = await page
		.locator('.ribbon-tab[aria-selected="true"]')
		.evaluate((tab) => getComputedStyle(tab).borderBottomColor);
	expect(line).not.toBe("rgb(15, 78, 74)");

	await clickMenu(app, "View", "Accent Colour", "The Palette's");
	await expect.poll(accent).toBe("#0f4e4a");
	expect(errors).toEqual([]);
	await app.close();
});
