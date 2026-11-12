import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { KalemBridge } from "../src/shared/bridge.js";
import { launch, recordMessageBoxes, tempDir } from "./launch.js";

test("closing keeps the tabs, unsaved text and place; opening brings them back as they were", async () => {
	const folder = await tempDir("session");
	const long = join(folder, "uzun.md");
	const notes = join(folder, "notlar.md");
	const longText = `# Uzun\n\n${Array.from({ length: 150 }, (_, i) => `Paragraf ${i + 1}.`).join("\n\n")}\n`;
	await writeFile(long, longText);
	await writeFile(notes, "# Notlar\n\nİlk satır.\n");

	const first = await launch({ args: [long, notes], settings: { restoreSession: true } });
	const { app, page } = first;
	const tabs = page.locator(".doc-tab");
	await expect(tabs).toHaveCount(2);

	// The second document is edited and not saved.
	await page.locator("#editor p", { hasText: "İlk satır." }).click();
	await page.keyboard.press("End");
	await page.keyboard.type(" Kaydedilmedi.");
	await expect(page.locator(".save-status")).toHaveText("Unsaved");

	// A new document that was never saved.
	await page.locator(".doc-tab-new").click();
	await expect(tabs).toHaveCount(3);
	await page.locator("#editor").click();
	await page.keyboard.type("Hiç kaydedilmemiş taslak");

	// The long one is the active tab, scrolled down.
	await tabs.filter({ hasText: "uzun" }).click();
	await page.locator(".desk:not([hidden])").evaluate((desk) => {
		desk.scrollTop = 1500;
	});

	// Closing asks nothing: a "Don't Save" would lose the unsaved text.
	await recordMessageBoxes(app, 1);
	await app.close();
	expect(await readFile(notes, "utf8")).toBe("# Notlar\n\nİlk satır.\n");

	// Opened again with no file named: the same tabs, in order, the same one active.
	const again = await launch({ userData: first.userData });
	const restored = again.page.locator(".doc-tab");
	await expect(restored).toHaveCount(3);
	await expect(restored.locator(".doc-tab-title")).toHaveText([/uzun/, /notlar/, /Untitled/]);
	await expect(restored.nth(0)).toHaveAttribute("aria-selected", "true");
	await expect
		.poll(() => again.page.locator(".desk:not([hidden])").evaluate((desk) => desk.scrollTop))
		.toBeGreaterThan(1000);
	// No "recovered" warning: it was kept on purpose.
	await expect(again.page.locator(".notice", { hasText: "recovered" })).toHaveCount(0);

	await restored.nth(1).click();
	await expect(again.page.locator("#editor p", { hasText: "İlk satır." })).toHaveText(
		"İlk satır. Kaydedilmedi.",
	);
	await expect(again.page.locator(".save-status")).toHaveText("Unsaved");
	await restored.nth(2).click();
	await expect(again.page.locator("#editor")).toContainText("Hiç kaydedilmemiş taslak");

	expect(first.errors).toEqual([]);
	expect(again.errors).toEqual([]);
	await recordMessageBoxes(again.app, 1);
	await again.app.close();

	// Turned off: closing asks again, and nothing comes back.
	const third = await launch({ userData: first.userData });
	await expect(third.page.locator(".doc-tab")).toHaveCount(3);
	await third.page.evaluate(() =>
		(window as unknown as { kalem: KalemBridge }).kalem.updateSettings({ restoreSession: false }),
	);
	await recordMessageBoxes(third.app, 1);
	await third.app.close();
	const fourth = await launch({ userData: first.userData });
	await expect(fourth.page.locator(".doc-tab")).toHaveCount(1);
	await expect(fourth.page.locator(".doc-tab-title")).not.toHaveText(/uzun/);
	await fourth.app.close();
});
