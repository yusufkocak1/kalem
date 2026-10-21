import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG_1X1 } from "../src/main/sample-docx.test-helper.js";
import { launch, tempDir } from "./launch.js";

test("shows a clicked picture large, goes through the pictures and edits a description", async () => {
	const folder = await tempDir("image-viewer");
	await writeFile(join(folder, "bir.png"), PNG_1X1);
	await writeFile(join(folder, "iki.png"), PNG_1X1);
	const doc = join(folder, "resimler.md");
	await writeFile(doc, "# Resimler\n\n![Akış şeması](bir.png)\n\n![](iki.png)\n");
	const { app, page, errors } = await launch({ args: [doc] });
	const images = page.locator("#editor img");
	await expect(images).toHaveCount(2);

	await images.first().click();
	const viewer = page.locator("dialog.image-viewer");
	await expect(viewer).toBeVisible();
	await expect(viewer.locator(".image-viewer-caption")).toHaveText("Akış şeması");
	await expect(viewer.locator(".image-viewer-count")).toHaveText("1 / 2");
	await expect(viewer.locator(".image-viewer-image")).toHaveAttribute("src", /bir\.png$/);
	await expect(page.locator(".kalem-alt-editor")).toBeHidden();

	// The arrows go through the document's pictures; one without a description shows its file name.
	await page.keyboard.press("ArrowRight");
	await expect(viewer.locator(".image-viewer-count")).toHaveText("2 / 2");
	await expect(viewer.locator(".image-viewer-caption")).toHaveText("iki.png");
	await viewer.getByRole("button", { name: "Next picture (→)" }).click();
	await expect(viewer.locator(".image-viewer-count")).toHaveText("1 / 2");

	// A click on the picture shows its actual size, another fits it again.
	await viewer.locator(".image-viewer-image").click();
	await expect(viewer.locator(".image-viewer-stage")).toHaveClass(/actual/);
	await viewer.locator(".image-viewer-image").click();
	await expect(viewer.locator(".image-viewer-stage")).not.toHaveClass(/actual/);

	await page.keyboard.press("Escape");
	await expect(viewer).toBeHidden();

	// The description is still edited from the viewer.
	await images.first().click();
	await viewer.getByRole("button", { name: "Edit description" }).click();
	await expect(viewer).toBeHidden();
	const altInput = page.locator(".kalem-alt-editor input");
	await expect(altInput).toBeVisible();
	await altInput.fill("Yeni açıklama");
	await altInput.press("Enter");
	await expect(images.first()).toHaveAttribute("alt", "Yeni açıklama");
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");
	expect(await readFile(doc, "utf8")).toContain("![Yeni açıklama](bir.png)");

	expect(errors).toEqual([]);
	await app.close();
});
