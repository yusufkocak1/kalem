import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launch, stubMessageBox, tempDir } from "./launch.js";

test("the panes' buttons on the edges are icons, named beside them when pointed at, with the notes' count", async () => {
	const folder = await tempDir("activity");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n\nKullanıcı siparişi iptal edebilir.\n");
	const { app, page, errors } = await launch({ args: [doc] });

	const files = page.locator('.stripe-left .stripe-button[data-pane="files"]');
	await expect(files).toBeVisible();
	// An icon, not a word written down the edge.
	const box = await files.boundingBox();
	expect(box?.height).toBeLessThan(40);
	await expect(files).toHaveAccessibleName("Files");

	// Pointed at, its name shows beside it, at its right.
	await files.hover();
	const tip = page.locator(".app-tip");
	await expect(tip).toBeVisible();
	await expect(tip).toHaveText("Files");
	const tipBox = await tip.boundingBox();
	expect(tipBox?.x ?? 0).toBeGreaterThan((box?.x ?? 0) + (box?.width ?? 0));
	await page.mouse.move(700, 500);
	await expect(tip).toBeHidden();

	// A note in the document: its count on My Notes' button.
	const notes = page.locator('.stripe-button[data-pane="notes"]');
	await expect(notes.locator(".stripe-badge")).toHaveCount(0);
	await page.evaluate(() => {
		const words = document.querySelector("#editor p")?.firstChild as Text;
		const range = document.createRange();
		range.setStart(words, 0);
		range.setEnd(words, 9);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
	});
	await page.locator('.ribbon-tab:has-text("Review")').click();
	await page.locator('[data-command="note-new"]').click();
	await page.keyboard.type("Kim?");
	await page.keyboard.press("ControlOrMeta+Enter");
	await expect(notes.locator(".stripe-badge")).toHaveText("1");
	await expect(notes).toHaveAccessibleName("My Notes (1)");

	// The assistant's button is an icon too, its name beside it.
	const assistant = page.locator(".assistant-rail-button");
	await assistant.hover();
	await expect(tip).toContainText("Assistant");
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});

test("the assistant takes a side as the panes do: its button on that edge, one panel open there at a time", async () => {
	const folder = await tempDir("assistant-side");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, "# Notlar\n\nKullanıcı siparişi iptal edebilir.\n");
	const { app, page, errors } = await launch({
		args: [doc],
		env: { KALEM_CLAUDE: join(folder, "nothing-here") },
	});
	const assistant = page.locator(".assistant");
	const notes = page.locator(".dock-right");
	const assistantButton = page.locator(".assistant-rail-button");
	const notesButton = page.locator('.stripe-button[data-pane="notes"]');

	// On the right, after the right dock's panes.
	await expect(page.locator(".stripe-right .assistant-rail-button")).toBeVisible();

	// My Notes and the assistant share the right side: one opens, the other closes.
	await notesButton.click();
	await expect(notes).toBeVisible();
	await assistantButton.click();
	await expect(assistant).toBeVisible();
	await expect(notes).toBeHidden();
	await expect(notesButton).toHaveAttribute("aria-pressed", "false");
	await notesButton.click();
	await expect(notes).toBeVisible();
	await expect(assistant).toBeHidden();
	await expect(assistantButton).toHaveAttribute("aria-expanded", "false");

	// Moved to the left from its button's menu: its button goes with it, the right edge keeps My Notes'.
	await assistantButton.click({ button: "right" });
	await page.locator(".dock-menu").getByRole("menuitem", { name: "Move to Left" }).click();
	await expect(page.locator(".stripe-left .assistant-rail-button")).toBeVisible();
	await expect(page.locator(".stripe-right .assistant-rail-button")).toHaveCount(0);
	// Opened there, it takes the left side's place: the headings pane closes.
	await page.locator(".stripe-left .assistant-rail-button").click();
	await expect(assistant).toBeVisible();
	await expect(assistant).toHaveAttribute("data-place", "left");
	await expect(page.locator(".dock-left")).toBeHidden();
	await expect(notes).toBeVisible();

	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});
