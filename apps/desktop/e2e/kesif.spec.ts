/**
 * What an exploratory test of the app found (keşif testi, K-09 … K-14),
 * each kept from coming back. The library's findings are tested in the
 * repository's own browser tests (`e2e/` at its root).
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { PNG_1X1 } from "../src/main/sample-docx.test-helper.js";
import { clickMenu, launch, stubOpenDialog, tempDir } from "./launch.js";

/** Answers every message box and keeps what each said, its detail too. */
async function recordBoxes(app: ElectronApplication): Promise<() => Promise<string[]>> {
	await app.evaluate(({ dialog }) => {
		const said: string[] = [];
		(globalThis as { boxes?: string[] }).boxes = said;
		dialog.showMessageBox = (async (...args: unknown[]) => {
			const options = args.at(-1) as { message: string; detail?: string };
			said.push(`${options.message} | ${options.detail ?? ""}`);
			return { response: 0, checkboxChecked: false };
		}) as typeof dialog.showMessageBox;
	});
	return () => app.evaluate(() => (globalThis as { boxes?: string[] }).boxes ?? []);
}

test("K-09: in a small window with the assistant open, the text keeps a readable width", async () => {
	const folder = await tempDir("kesif-narrow");
	const doc = join(folder, "dar.md");
	await writeFile(
		doc,
		"# Dar pencere\n\nKullanıcı siparişi kargoya verilmeden iptal edebilir; ödeme aynı gün iade edilir.\n",
	);
	const { app, page, errors } = await launch({ args: [doc], settings: { assistant: true } });
	await expect(page.locator(".assistant")).toBeVisible();
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(600, 700));
	const paragraph = page.locator("#editor p").first();
	// It was about 150px, a word or two a line: the grey desk margin, the page's
	// margins and the handle's gutter kept their full size. The rest is the
	// assistant's own smallest width.
	await expect.poll(async () => (await paragraph.boundingBox())?.width ?? 0).toBeGreaterThan(175);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
	expect(errors).toEqual([]);
	await app.close();
});

test("K-10: a picture named .md and a file that is not there say why they do not open", async () => {
	const folder = await tempDir("kesif-open");
	const picture = join(folder, "resim.md");
	await writeFile(picture, PNG_1X1);
	const { app, page, errors } = await launch();
	const boxes = await recordBoxes(app);
	const tabs = await page.locator(".doc-tab").count();

	await stubOpenDialog(app, [picture]);
	await clickMenu(app, "File", "Open…");
	await expect
		.poll(boxes)
		.toEqual([
			`The file could not be opened | ${picture}\n\nIt is not a text file (a picture or a program, for instance), so it was not opened as a document.`,
		]);

	const missing = join(folder, "yok.md");
	await stubOpenDialog(app, [missing]);
	await clickMenu(app, "File", "Open…");
	await expect
		.poll(async () => (await boxes()).at(-1))
		.toBe(`The file could not be opened | ${missing}\n\nThere is no such file.`);
	// Neither opened a tab.
	await expect(page.locator(".doc-tab")).toHaveCount(tabs);
	expect(errors).toEqual([]);
	await app.close();
});

test("K-14: formatting a broken JSON file says the file is not valid JSON", async () => {
	const folder = await tempDir("kesif-json");
	const file = join(folder, "bozuk.json");
	await writeFile(file, '{"ad": "kalem", "eksik": }');
	const { app, page, errors } = await launch();
	await stubOpenDialog(app, [file]);
	await clickMenu(app, "File", "Open…");
	await page.locator(".text-view-format").click();
	await expect(page.locator(".notice")).toContainText("This file is not valid JSON");
	await expect(page.locator(".text-view-area")).toHaveValue('{"ad": "kalem", "eksik": }');
	expect(errors).toEqual([]);
	await app.close();
});

test("settings search finds a setting by a word with a Turkish ending", async () => {
	const { app, page, errors } = await launch({ settings: { language: "tr" } });
	await clickMenu(app, "Dosya", "Ayarlar…");
	const dialog = page.locator(".settings-dialog");
	// "yakınlaştırma" is the setting's keyword "yakınlaştır" with an ending; it found nothing.
	await dialog.locator(".settings-search").fill("yakınlaştırma");
	await expect(dialog.locator('[data-setting="zoom"]')).toBeVisible();
	await expect(dialog.locator(".settings-empty")).toBeHidden();
	// As typed it still wins: "yazım" is spell check, not the zoom's "yazı boyutu".
	await dialog.locator(".settings-search").fill("yazım");
	await expect(dialog.locator('input[data-setting="spellCheck"]')).toBeVisible();
	await expect(dialog.locator('[data-setting="zoom"]')).toBeHidden();
	expect(errors).toEqual([]);
	await app.close();
});
