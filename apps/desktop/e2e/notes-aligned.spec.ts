import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, stubMessageBox, tempDir } from "./launch.js";

function longDocument(): string {
	const parts = ["# Notlar"];
	for (let i = 1; i <= 24; i++) {
		parts.push(`Paragraf ${i}: kullanıcı siparişi kargoya verilmeden önce iptal edebilir.`);
	}
	return `${parts.join("\n\n")}\n`;
}

/** Selects a paragraph's first word and adds a note on it. */
async function noteOn(page: Page, paragraph: string, text: string): Promise<void> {
	await page.evaluate((which) => {
		const p = [...document.querySelectorAll("#editor p")].find((node) =>
			node.textContent?.startsWith(which),
		);
		const words = p?.firstChild as Text;
		const range = document.createRange();
		range.setStart(words, 0);
		range.setEnd(words, which.length);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
	}, paragraph);
	await page.locator('.ribbon-tab:has-text("Review")').click();
	await page.locator('[data-command="note-new"]').click();
	await page.keyboard.type(text);
	await page.keyboard.press("ControlOrMeta+Enter");
}

/** How far a card is from its words, up or down, in pixels. */
function offset(page: Page, index: number, paragraph: string): Promise<number> {
	return page.evaluate(
		([i, which]) => {
			const card = document.querySelectorAll<HTMLElement>(".note-balloon")[i as number];
			const p = [...document.querySelectorAll("#editor p")].find((node) =>
				node.textContent?.startsWith(which as string),
			);
			if (card === undefined || p === undefined) return Number.NaN;
			return card.getBoundingClientRect().top - p.getBoundingClientRect().top;
		},
		[index, paragraph] as const,
	);
}

test("My Notes' cards sit beside their lines and move with the page; as a list without the setting", async () => {
	const folder = await tempDir("notes-aligned");
	const doc = join(folder, "notlar.md");
	await writeFile(doc, longDocument());
	const { app, page, errors } = await launch({ args: [doc] });
	await page.locator("#editor p", { hasText: "Paragraf 20:" }).waitFor();
	await noteOn(page, "Paragraf 2:", "Birinci");
	await noteOn(page, "Paragraf 12:", "İkinci");

	const pane = page.locator(".notes-pane");
	await expect(pane).toHaveAttribute("data-aligned", "");
	// Each card at its words' height, not one under the other.
	await expect.poll(async () => Math.abs(await offset(page, 0, "Paragraf 2:"))).toBeLessThan(12);
	await expect.poll(async () => Math.abs(await offset(page, 1, "Paragraf 12:"))).toBeLessThan(12);

	// The page scrolls; the cards go with their words.
	await page.locator(".desk:not([hidden])").evaluate((desk) => {
		desk.scrollTop += 300;
	});
	await expect.poll(async () => Math.abs(await offset(page, 1, "Paragraf 12:"))).toBeLessThan(12);

	// Without the setting, a list as before.
	await clickMenu(app, "View", "My Notes Beside Their Lines");
	await expect(pane).not.toHaveAttribute("data-aligned", "");
	const gap = await page.locator(".note-balloon").evaluateAll((cards) => {
		const [a, b] = cards.map((card) => card.getBoundingClientRect());
		return a === undefined || b === undefined ? Number.NaN : b.top - a.bottom;
	});
	expect(gap).toBeLessThan(20);
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});
