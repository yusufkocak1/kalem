import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launch, stubMessageBox, tempDir } from "./launch.js";

test("the headings pane folds while the document has no heading, and comes back with the first", async () => {
	const folder = await tempDir("outline-fold");
	const doc = join(folder, "baslikli.md");
	await writeFile(doc, "# Başlıklı\n\nMetin.\n");
	const { app, page, userData, errors } = await launch();
	const dock = page.locator(".tool-dock.dock-left");
	const button = page.locator('.stripe-left .stripe-button[data-pane="outline"]');

	// A new, empty document: nothing to list, the page has the room.
	await expect(dock).toBeHidden();
	await expect(button).toBeVisible();
	await expect(button).toHaveAttribute("aria-pressed", "true");

	// The first heading brings it back, once the typing pauses.
	await page.locator("#editor [contenteditable]").first().click();
	await page.keyboard.type("# Giriş");
	await expect(page.locator("#editor h1")).toHaveText("Giriş");
	await expect(dock).toBeVisible();
	await expect(dock).toContainText("Giriş");

	// Without it, the pane folds again.
	await page.keyboard.press("Control+a");
	await page.keyboard.press("Backspace");
	await expect(page.locator("#editor h1")).toHaveCount(0);
	await expect(dock).toBeHidden();

	// Its button opens it for this tab all the same, and saves nothing.
	await button.click();
	await expect(dock).toBeVisible();
	await expect(button).toHaveAttribute("aria-pressed", "true");
	const saved = JSON.parse(await readFile(join(userData, "settings.json"), "utf8")) as {
		settings: { navigation?: boolean };
	};
	expect(saved.settings.navigation).not.toBe(false);

	// A document with headings shows them at once.
	await page.evaluate(
		(file) =>
			(window as unknown as { kalem: { openPath(path: string): Promise<unknown> } }).kalem.openPath(
				file,
			),
		doc,
	);
	await expect(page.locator("#editor h1").filter({ hasText: "Başlıklı" })).toBeVisible();
	await expect(dock).toBeVisible();
	await expect(dock).toContainText("Başlıklı");
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});
