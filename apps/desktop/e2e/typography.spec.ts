import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { clickMenu, closeSettings, launch, tempDir } from "./launch.js";

const paragraph = (page: Page) => page.locator("#editor > p").first();
const lineHeight = (page: Page): Promise<number> =>
	paragraph(page).evaluate((p) => Number.parseFloat(getComputedStyle(p).lineHeight));

test("Text & Paragraph in Settings sets the spacing as it is changed", async () => {
	const folder = await tempDir("typography");
	const path = join(folder, "belge.md");
	await writeFile(path, "# Amaç ve Kapsam\n\nBir paragraf.\n\nİkinci paragraf.\n\n- bir\n- iki\n");
	const { app, page, errors } = await launch({ args: [path] });
	try {
		const size = await paragraph(page).evaluate((p) =>
			Number.parseFloat(getComputedStyle(p).fontSize),
		);
		expect((await lineHeight(page)) / size).toBeCloseTo(1.65, 1);

		// The ribbon's button opens the Settings window at its Text & Paragraph part.
		await page.locator('[data-command="typography"]').click();
		const section = page.locator('.settings-dialog [data-section="typography"]');
		await expect(section).toBeVisible();
		await expect(page.locator(".settings-dialog .typography-preview")).toBeVisible();

		await section.locator('[data-preset="2"]').click();
		await expect.poll(async () => (await lineHeight(page)) / size).toBeCloseTo(2, 1);
		await section.locator('[data-typography="documentFont"]').selectOption("serif");
		await expect
			.poll(() => paragraph(page).evaluate((p) => getComputedStyle(p).fontFamily))
			.toContain("Georgia");
		await section.locator('[data-typography-box="paragraphSpacing"]').fill("2");
		await section.locator('[data-typography-box="paragraphSpacing"]').press("Enter");
		await expect
			.poll(() =>
				paragraph(page).evaluate((p) => Number.parseFloat(getComputedStyle(p).marginBottom)),
			)
			.toBeCloseTo(2 * size, 0);
		await page.screenshot({ path: join("test-results", "typography.png") });

		// The section's reset puts every value back.
		await section.getByRole("button", { name: "Reset to Defaults" }).click();
		await expect.poll(async () => (await lineHeight(page)) / size).toBeCloseTo(1.65, 1);
		await closeSettings(page);

		// File is tidied: the Atlassian items are under one submenu.
		const top = await app.evaluate(({ Menu }) =>
			(Menu.getApplicationMenu()?.items.find((item) => item.label === "File")?.submenu?.items ?? [])
				.filter((item) => item.type !== "separator" && item.visible)
				.map((item) => item.label),
		);
		expect(top).toContain("Confluence & Jira");
		expect(top).not.toContain("Open from Confluence…");
		expect(top.length).toBeLessThanOrEqual(22);
		await clickMenu(app, "View", "Text & Paragraph…");
		await expect(section).toBeVisible();
		expect(errors).toEqual([]);
	} finally {
		await app.close();
	}
});
