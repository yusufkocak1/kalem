import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, stubMessageBox, tempDir } from "./launch.js";

function longDocument(): string {
	const parts = ["# Odak"];
	for (let i = 1; i <= 30; i++) {
		parts.push(`Paragraf ${i}: kullanıcı siparişi kargoya verilmeden önce iptal edebilir.`);
	}
	return `${parts.join("\n\n")}\n`;
}

/** Where the caret's line is in the view, from its top, as a share of its height. */
function caretInView(page: Page): Promise<number> {
	return page.evaluate(() => {
		const desk = document.querySelector<HTMLElement>(".desk:not([hidden])");
		const selection = document.getSelection();
		if (desk === null || selection === null || selection.rangeCount === 0) return -1;
		// The character at the caret: a caret just moved into a block has no box of its own.
		const range = selection.getRangeAt(0);
		let text = range.startContainer;
		let offset = range.startOffset;
		if (!(text instanceof Text)) {
			const walker = document.createTreeWalker(
				text.childNodes[offset] ?? text,
				NodeFilter.SHOW_TEXT,
			);
			text = walker.nextNode() ?? text;
			offset = 0;
		}
		const probe = document.createRange();
		if (text instanceof Text && text.length > 0) {
			const start = Math.min(offset, text.length - 1);
			probe.setStart(text, start);
			probe.setEnd(text, start + 1);
		} else probe.selectNodeContents(text);
		const box = probe.getBoundingClientRect();
		const view = desk.getBoundingClientRect();
		return (box.top + box.height / 2 - view.top) / view.height;
	});
}

/** The caret's line a little above the middle, as typewriter scrolling keeps it. */
function centred(page: Page): () => Promise<boolean> {
	return async () => {
		const at = await caretInView(page);
		return at > 0.35 && at < 0.5;
	};
}

test("focus mode dims all but the paragraph being written, keeps its line in the middle, and its way out fades", async () => {
	const folder = await tempDir("focus");
	const path = join(folder, "odak.md");
	await writeFile(path, longDocument());
	const { app, page, errors } = await launch({ args: [path] });
	await clickMenu(app, "View", "Focus Mode");
	await expect(page.locator(".app")).toHaveAttribute("data-focus", "");

	// The paragraph with the caret is whole; the others are quieter.
	const third = page.locator("#editor p", { hasText: "Paragraf 3:" });
	await third.click();
	const opacity = (text: string) =>
		page
			.locator("#editor p", { hasText: text })
			.evaluate((block) => Number(getComputedStyle(block).opacity));
	await expect.poll(() => opacity("Paragraf 3:")).toBe(1);
	await expect.poll(() => opacity("Paragraf 4:")).toBeLessThan(0.5);

	// Typing down the page: the line comes to the middle of the view. (Near the
	// top it stays where it is: the page does not scroll above its start.)
	await page.locator("#editor p", { hasText: "Paragraf 14:" }).click();
	await page.keyboard.press("End");
	await page.keyboard.type(" Yeni");
	await expect.poll(centred(page)).toBe(true);
	// Down the page with the arrows, it stays there.
	for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
	await expect.poll(centred(page)).toBe(true);

	// The way out fades with the mouse at rest, and comes back when it moves.
	const exit = page.locator(".focus-exit");
	await page.mouse.move(400, 300);
	await expect(exit).toHaveCSS("opacity", "0.35");
	await expect(page.locator(".app")).toHaveAttribute("data-focus-idle", "", { timeout: 5000 });
	await expect.poll(() => exit.evaluate((b) => Number(getComputedStyle(b).opacity))).toBe(0);
	await page.mouse.move(420, 320);
	await expect(page.locator(".app")).not.toHaveAttribute("data-focus-idle", "");
	await exit.click();
	await expect(page.locator(".app")).not.toHaveAttribute("data-focus", "");
	await expect.poll(() => opacity("Paragraf 4:")).toBe(1);
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});

test("without typewriter scrolling, typing in focus mode leaves the page where it is", async () => {
	const folder = await tempDir("focus-still");
	const path = join(folder, "odak.md");
	await writeFile(path, longDocument());
	const { app, page } = await launch({ args: [path], settings: { typewriterScroll: false } });
	await clickMenu(app, "View", "Focus Mode");
	await page.locator("#editor p", { hasText: "Paragraf 3:" }).click();
	const scroll = () =>
		page.locator(".desk:not([hidden])").evaluate((desk) => Math.round(desk.scrollTop));
	const before = await scroll();
	await page.keyboard.press("End");
	await page.keyboard.type(" Yeni");
	await page.waitForTimeout(200);
	expect(await scroll()).toBe(before);
	await stubMessageBox(app, 1);
	await app.close();
});
