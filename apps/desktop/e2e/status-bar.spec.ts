import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeClaude } from "./fake-claude.js";
import { launch, stubMessageBox, tempDir } from "./launch.js";

test("the status bar counts the selection, keeps a word goal, offers the usual zooms, and says what the assistant does", async () => {
	const folder = await tempDir("status");
	const path = join(folder, "hedef.md");
	await writeFile(path, "# Hedef\n\nBir iki üç dört beş altı yedi sekiz dokuz on.\n");
	const claude = await fakeClaude(folder, "Tamam.", [], { delay: 1500 });
	const { app, page, errors } = await launch({
		args: [path],
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	const bar = page.locator(".statusbar");
	// Saved or not, at the status bar's right now.
	await expect(bar.locator(".save-status")).toHaveText("Saved");
	// Not connected: no Confluence or Jira chip.
	await expect(bar.locator(".status-confluence")).toBeHidden();
	await expect(bar.locator(".status-jira")).toBeHidden();

	// The selection's words.
	await expect(bar.locator(".status-selection")).toBeHidden();
	await page.locator("#editor p").click();
	await page.locator("#editor p").evaluate((paragraph) => {
		const range = document.createRange();
		range.selectNodeContents(paragraph);
		document.getSelection()?.removeAllRanges();
		document.getSelection()?.addRange(range);
	});
	await expect(bar.locator(".status-selection")).toHaveText("10 words selected");
	await page.keyboard.press("Control+End");
	await expect(bar.locator(".status-selection")).toBeHidden();

	// A goal for this document: its words of it, and a ring.
	const goal = bar.locator(".status-goal");
	await expect(goal).toHaveText("Word goal");
	await goal.click();
	await page.locator(".status-goal-input").fill("20");
	await page.locator(".status-goal-save").click();
	await expect(goal).toHaveText("11 / 20");
	await expect(goal).toHaveAttribute("title", "11 of 20 words (55%)");
	await page.locator("#editor p").click();
	await page.keyboard.press("End");
	await page.keyboard.type(" on bir on iki");
	await expect(goal).toHaveText("14 / 20");

	// The usual zooms, from the zoom's value.
	await bar.locator(".zoom-value").click();
	const menu = page.locator(".zoom-menu");
	await expect(menu.locator(".zoom-menu-item")).toHaveText([
		"80%",
		"90%",
		"100%",
		"110%",
		"120%",
		"150%",
		"200%",
	]);
	await menu.getByText("120%").click();
	await expect(bar.locator(".zoom-value")).toHaveText("120%");

	// The assistant at work: a chip while it answers.
	const chip = bar.locator(".status-assistant");
	await expect(chip).toBeHidden();
	await page.locator(".assistant-input").fill("Merhaba");
	await page.locator(".assistant-input").press("Enter");
	await expect(chip).toBeVisible();
	await expect(chip).toBeHidden({ timeout: 15000 });
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});
