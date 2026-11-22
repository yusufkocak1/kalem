import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, stubMessageBox, tempDir } from "./launch.js";

/** A plain grey PNG of the given size. */
function png(width: number, height: number): Buffer {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (data: Buffer): number => {
		let c = 0xffffffff;
		for (const byte of data) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer): Buffer => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([length, body, sum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 0; // greyscale
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0xaa)]);
	const raw = Buffer.concat(Array.from({ length: height }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const DOC = [
	"# Amaç ve Kapsam", // 1
	"", // 2
	"Jira İsmi: APIS Bilgisi Girilmiş Yolcuların Offload İşlemi", // 3
	"", // 4
	"![tall](tall.png)", // 5
	"", // 6
	"After the image.", // 7
	"", // 8
	"| Versiyon | Tarih |", // 9
	"|---|---|", // 10
	"| 1.0 | 23.10.2026 |", // 11
	"", // 12
	"- one", // 13
	"- two", // 14
	"", // 15
	"```", // 16
	"let a;", // 17
	"let b;", // 18
	"```", // 19
	"", // 20
	"Last.", // 21
	"",
].join("\n");

/** Each number shown and the middle of its box, in the window. */
async function numbers(page: Page): Promise<Map<number, number>> {
	const shown = await page.locator(".page:not([hidden]) .line-number").evaluateAll((spans) =>
		spans.map((span) => {
			const rect = span.getBoundingClientRect();
			return [Number(span.textContent), rect.top + rect.height / 2] as const;
		}),
	);
	return new Map(shown);
}

/** The middle of the first line of text in `selector`. */
async function firstLineMiddle(page: Page, selector: string): Promise<number> {
	return page
		.locator(selector)
		.first()
		.evaluate((element) => {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			const text = walker.nextNode();
			const range = document.createRange();
			if (text !== null) {
				range.setStart(text, 0);
				range.setEnd(text, 1);
			} else range.selectNodeContents(element);
			const rect = range.getClientRects()[0] ?? element.getBoundingClientRect();
			return rect.top + rect.height / 2;
		});
}

test("numbers a document's lines beside them, below a tall image too", async () => {
	const folder = await tempDir("lines");
	await writeFile(join(folder, "tall.png"), png(60, 400));
	const path = join(folder, "belge.md");
	await writeFile(path, DOC);
	const { app, page, errors } = await launch({ args: [path], settings: { lineNumbers: true } });
	try {
		await expect(page.locator("#editor h1")).toHaveText("Amaç ve Kapsam");
		await page
			.locator("#editor img")
			.evaluate((image) =>
				(image as HTMLImageElement).complete
					? null
					: new Promise((resolve) => image.addEventListener("load", resolve)),
			);
		await expect(page.locator(".page:not([hidden]) .line-number").first()).toBeVisible();
		await expect
			.poll(async () => [...(await numbers(page)).keys()].sort((a, b) => a - b))
			.toEqual([1, 3, 5, 7, 9, 11, 13, 14, 17, 18, 21]);

		const shown = await numbers(page);
		const near = async (line: number, selector: string): Promise<void> => {
			const expected = await firstLineMiddle(page, selector);
			expect(Math.abs((shown.get(line) ?? 0) - expected), `line ${line}`).toBeLessThan(4);
		};
		await near(1, "#editor h1");
		await near(3, "#editor > p:nth-of-type(1)");
		// The paragraph under the 400px image: its number moved down with it.
		await near(7, "#editor > p:nth-of-type(3)");
		await near(11, "#editor td");
		await near(14, "#editor li:nth-of-type(2)");
		await near(21, "#editor > p:last-of-type");
		const imageTop = await page
			.locator("#editor img")
			.evaluate((image) => image.getBoundingClientRect().top);
		expect(Math.abs((shown.get(5) ?? 0) - imageTop)).toBeLessThan(30);
		// The code's two lines, one line apart.
		const lineGap = (shown.get(18) ?? 0) - (shown.get(17) ?? 0);
		expect(lineGap).toBeGreaterThan(10);
		expect(lineGap).toBeLessThan(30);
		await page.screenshot({ path: join("test-results", "line-numbers.png") });

		// An edit adds lines: the numbers below follow.
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Inserted");
		await expect.poll(async () => (await numbers(page)).has(23)).toBe(true);
		await near(5, "#editor > p:nth-of-type(2)");

		// Off from the View tab, and back.
		await page.locator('[data-tab="view"]').click();
		await page.locator('[data-command="line-numbers"]').click();
		await expect(page.locator(".page:not([hidden]) .line-number")).toHaveCount(0);
		await page.locator('[data-command="line-numbers"]').click();
		await expect(page.locator(".page:not([hidden]) .line-number").first()).toBeVisible();
		expect(errors).toEqual([]);
		// Closing does not save the edit.
		await stubMessageBox(app, 1);
	} finally {
		await app.close();
	}
});

test("a document's page has no numbers at first; its source has, and focus mode hides the page's", async () => {
	const folder = await tempDir("lines-default");
	const path = join(folder, "belge.md");
	await writeFile(path, "# Başlık\n\nBir paragraf.\n");
	const { app, page } = await launch({ args: [path] });
	try {
		await expect(page.locator("#editor h1")).toHaveText("Başlık");
		const numbersOnPage = page.locator(".page:not([hidden]) .line-number");
		await expect(page.locator(".page:not([hidden])")).not.toHaveAttribute("data-line-numbers");
		await expect(numbersOnPage).toHaveCount(0);

		// Source mode is a code editor's view: its lines are numbered.
		await page.locator('[data-tab="view"]').click();
		await clickMenu(app, "View", "Markdown Source");
		await expect(numbersOnPage.first()).toBeVisible();
		await expect(page.locator('[data-command="line-numbers"]')).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await clickMenu(app, "View", "Markdown Source");
		await expect(numbersOnPage).toHaveCount(0);
		await expect(page.locator('[data-command="line-numbers"]')).toHaveAttribute(
			"aria-pressed",
			"false",
		);

		// Turned on for the page, they still give way to focus mode.
		await page.locator('[data-command="line-numbers"]').click();
		await expect(numbersOnPage.first()).toBeVisible();
		await clickMenu(app, "View", "Focus Mode");
		await expect(numbersOnPage).toHaveCount(0);
		await clickMenu(app, "View", "Focus Mode");
		await expect(numbersOnPage.first()).toBeVisible();
	} finally {
		await app.close();
	}
});

test("numbers a text file's lines, wrapped ones on their first row", async () => {
	const folder = await tempDir("lines-text");
	const path = join(folder, "notes.txt");
	await writeFile(path, `short\n${"long words ".repeat(60)}\nafter\n`);
	const doc = join(folder, "belge.md");
	await writeFile(doc, "# Belge\n");
	const { app, page } = await launch({ args: [doc] });
	try {
		await page.evaluate(
			(file) =>
				(
					window as unknown as { kalem: { openPath(path: string): Promise<unknown> } }
				).kalem.openPath(file),
			path,
		);
		const gutter = page.locator(".text-view-gutter");
		await expect(gutter).toBeVisible();
		await expect(gutter).toHaveText("1\n2\n3\n4");
		await page.locator(".text-view-wrap input").check();
		// Line 2 wraps over several rows: 3 is pushed down past them.
		await expect
			.poll(async () => (await gutter.textContent())?.split("\n").indexOf("3") ?? -1)
			.toBeGreaterThan(2);
		await page.screenshot({ path: join("test-results", "line-numbers-text.png") });
	} finally {
		await app.close();
	}
});
