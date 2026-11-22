import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, stubMessageBox, tempDir } from "./launch.js";

function longDocument(): string {
	const parts: string[] = [];
	for (let section = 1; section <= 6; section++) {
		parts.push(`## Bölüm ${section}`);
		for (let i = 1; i <= 6; i++) {
			parts.push(`Bölüm ${section} paragraf ${i}: sipariş kargoya verilmeden iptal edilebilir.`);
		}
	}
	parts.push("Son paragrafta aranacak sözcük: zebra.");
	return `# Harita\n\n${parts.join("\n\n")}\n`;
}

test("the document map beside the scrollbar marks headings and what was found, and a click goes there", async () => {
	const folder = await tempDir("map");
	const path = join(folder, "harita.md");
	await writeFile(path, longDocument());
	const short = join(folder, "kisa.md");
	await writeFile(short, "# Kısa\n\nBir satır.\n");
	const { app, page, errors } = await launch({ args: [path] });
	await page.locator("#editor p", { hasText: "zebra" }).waitFor();

	const map = page.locator(".doc-map");
	await expect(map).toBeVisible();
	// The title and the six sections.
	await expect(map.locator(".doc-map-heading")).toHaveCount(7);
	await expect(map.locator(".doc-map-heading").nth(1)).toHaveAttribute("title", "Bölüm 1");

	// What the search finds is marked, near the bottom.
	await clickMenu(app, "Edit", "Find…");
	await page.locator(".kalem-find input").first().fill("zebra");
	await expect(map.locator(".doc-map-found")).toHaveCount(1);
	const share = await map
		.locator(".doc-map-found")
		.evaluate((tick) => Number.parseFloat((tick as HTMLElement).style.top));
	expect(share).toBeGreaterThan(80);
	await page.keyboard.press("Escape");

	// A click near the bottom goes there.
	const desk = page.locator(".desk:not([hidden])");
	const box = await map.boundingBox();
	if (box === null) throw new Error("no map");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.95);
	await expect.poll(() => desk.evaluate((d) => d.scrollTop)).toBeGreaterThan(300);

	// Off from the View menu.
	await clickMenu(app, "View", "Document Map Beside the Scrollbar");
	await expect(map).toBeHidden();
	await clickMenu(app, "View", "Document Map Beside the Scrollbar");
	await expect(map).toBeVisible();

	// A page that fits in the view has none.
	await page.evaluate(
		(file) =>
			(window as unknown as { kalem: { openPath(p: string): Promise<unknown> } }).kalem.openPath(
				file,
			),
		short,
	);
	await expect(page.locator("#editor h1")).toHaveText("Kısa");
	await expect(map).toBeHidden();
	expect(errors).toEqual([]);
	await stubMessageBox(app, 1);
	await app.close();
});
