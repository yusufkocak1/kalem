import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { launch, tempDir } from "./launch.js";

const lineHeight = (page: Page): Promise<number> =>
	page
		.locator("#editor > p")
		.first()
		.evaluate((p) => Number.parseFloat(getComputedStyle(p).lineHeight));

test("Text & Paragraph sets the line spacing as it is changed, and Cancel puts it back", async () => {
	const folder = await tempDir("typography");
	const path = join(folder, "belge.md");
	await writeFile(path, "# Amaç ve Kapsam\n\nBir paragraf.\n\nİkinci paragraf.\n\n- bir\n- iki\n");
	const { app, page, errors } = await launch({ args: [path] });
	try {
		const size = await page
			.locator("#editor > p")
			.first()
			.evaluate((p) => Number.parseFloat(getComputedStyle(p).fontSize));
		expect((await lineHeight(page)) / size).toBeCloseTo(1.65, 1);

		await page.locator('[data-command="typography"]').click();
		const dialog = page.locator("dialog.typography");
		await expect(dialog).toBeVisible();
		await dialog.locator('[data-preset="2"]').click();
		await expect.poll(async () => (await lineHeight(page)) / size).toBeCloseTo(2, 1);
		await dialog.locator('[data-typography="documentFont"]').selectOption("serif");
		await expect
			.poll(() =>
				page
					.locator("#editor > p")
					.first()
					.evaluate((p) => getComputedStyle(p).fontFamily),
			)
			.toContain("Georgia");
		await page.screenshot({ path: join("test-results", "typography.png") });

		// Cancel: as it was.
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();
		await expect.poll(async () => (await lineHeight(page)) / size).toBeCloseTo(1.65, 1);

		// OK keeps it, across a restart of the window's settings.
		await page.locator('[data-command="typography"]').click();
		await dialog.locator('[data-typography-box="paragraphSpacing"]').fill("2");
		await dialog.locator('[data-typography-box="paragraphSpacing"]').press("Enter");
		await dialog.getByRole("button", { name: "OK" }).click();
		await expect
			.poll(() =>
				page
					.locator("#editor > p")
					.first()
					.evaluate((p) => Number.parseFloat(getComputedStyle(p).marginBottom)),
			)
			.toBeCloseTo(2 * size, 0);
		expect(errors).toEqual([]);
	} finally {
		await app.close();
	}
});
