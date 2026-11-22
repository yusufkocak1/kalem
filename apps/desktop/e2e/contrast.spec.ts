import { expect, test } from "@playwright/test";
import { launch } from "./launch.js";

test("in a contrast theme, what is pressed, chosen and focused is drawn by the system, and the page has an edge", async () => {
	const { app, page, errors } = await launch();
	await page.emulateMedia({ forcedColors: "active" });
	const style = (selector: string, property: string) =>
		page
			.locator(selector)
			.first()
			.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
	// The page's edge, and the pressed style in the ribbon: lines, not tints.
	expect(await style(".page:not([hidden])", "border-top-style")).toBe("solid");
	await page.locator("#editor [contenteditable]").first().click();
	await page.locator('[data-tab="home"]').click();
	const pressed = page.locator('.ribbon-style[aria-pressed="true"]').first();
	await expect(pressed).toBeVisible();
	expect(await pressed.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
	// The caret's block: a line in the margin the system draws.
	expect(await style("#editor [contenteditable]:focus", "border-inline-start-style")).toBe("solid");
	// Colours that say something keep theirs.
	expect(await style(".files-icon, .ribbon-swatch, .status-goal-ring", "forced-color-adjust")).toBe(
		"none",
	);
	expect(errors).toEqual([]);
	await app.close();
});

test("asked for more contrast, the greys come closer to the text", async () => {
	const { app, page } = await launch();
	const muted = () =>
		page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-muted"));
	const before = await muted();
	await page.emulateMedia({ contrast: "more" });
	await expect.poll(muted).not.toBe(before);
	await app.close();
});
