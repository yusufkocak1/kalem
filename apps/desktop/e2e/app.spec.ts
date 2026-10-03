import { mkdir, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { createSampleDocx, PNG_1X1 } from "../src/main/sample-docx.test-helper.js";
import type { KalemBridge } from "../src/shared/bridge.js";
import type { Launched } from "./launch.js";
import {
	clickMenu,
	lastSaveDialog,
	launch,
	stubMessageBox,
	stubOpenDialog,
	stubSaveDialog,
	tempDir,
} from "./launch.js";

const status = (page: Page) => page.locator(".save-status");
const save = (page: Page) => page.locator('[data-command="save"]').click();

/** Closes the app, answering "Don't Save" if it asks about unsaved changes. */
async function discardAndClose(app: ElectronApplication): Promise<void> {
	await stubMessageBox(app, 1);
	await app.close();
}

/** The single-instance lock of a killed process is released a moment after it exits. */
async function relaunch(userData: string): Promise<Launched> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await launch({ userData });
		} catch (error) {
			if (attempt >= 20) throw error;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
}

async function windowTitle(app: ElectronApplication): Promise<string> {
	return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? "");
}

test("writes a new document and saves it as Markdown", async () => {
	const target = join(await tempDir("save"), "rapor.md");
	const { app, page, errors } = await launch();

	await expect(status(page)).toHaveText("New document");
	await page.keyboard.type("# Çeyrek Raporu");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Bir paragraf.");
	await expect(page.locator("#editor h1")).toHaveText("Çeyrek Raporu");
	await expect(status(page)).toHaveText("Unsaved");
	expect(await windowTitle(app)).toBe("● Untitled – Kalem");

	await stubSaveDialog(app, target);
	await save(page);
	await expect(status(page)).toHaveText("Saved");

	expect(await readFile(target, "utf8")).toBe("# Çeyrek Raporu\n\nBir paragraf.\n");
	expect(await windowTitle(app)).toBe("rapor – Kalem");
	expect(errors).toEqual([]);
	await app.close();
});

test("applies formatting from the ribbon", async () => {
	const target = join(await tempDir("format"), "a.md");
	const { app, page, errors } = await launch();

	await page.keyboard.type("kalın");
	await page.keyboard.press("Control+A");
	await page.locator('[data-command="bold"]').click();
	await expect(page.locator("#editor strong")).toHaveText("kalın");
	await expect(page.locator('[data-command="bold"]')).toHaveAttribute("aria-pressed", "true");

	await page.locator('[data-command="style-heading-2"]').click();
	await expect(page.locator("#editor h2")).toHaveText("kalın");
	await expect(page.locator('[data-command="style-heading-2"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await stubSaveDialog(app, target);
	await save(page);
	await expect(status(page)).toHaveText("Saved");
	expect(await readFile(target, "utf8")).toBe("## **kalın**\n");
	expect(errors).toEqual([]);
	await app.close();
});

test("opens a file from the command line and keeps its BOM and CRLF", async () => {
	const path = join(await tempDir("open"), "notlar.md");
	const original = Buffer.concat([
		Buffer.from([0xef, 0xbb, 0xbf]),
		Buffer.from("# Notlar\r\n\r\nİlk satır.\r\n", "utf8"),
	]);
	await writeFile(path, original);

	const { app, page, errors } = await launch({ args: [path] });
	await expect(page.locator("#editor h1")).toHaveText("Notlar");
	await expect(page.locator(".status-format")).toHaveText("UTF-8 BOM · CRLF");
	await expect(status(page)).toHaveText("Saved");
	expect(await windowTitle(app)).toBe("notlar – Kalem");

	await page.locator("#editor p").click();
	await page.keyboard.press("End");
	await page.keyboard.type(" Eklendi.");
	await expect(status(page)).toHaveText("Unsaved");
	await save(page);
	await expect(status(page)).toHaveText("Saved");

	const written = await readFile(path);
	expect(written.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
	expect(written.subarray(3).toString("utf8")).toBe("# Notlar\r\n\r\nİlk satır. Eklendi.\r\n");
	expect(errors).toEqual([]);
	await app.close();
});

test("imports a Word document and writes its images next to the Markdown file", async () => {
	const folder = await tempDir("word");
	const docx = join(folder, "Çeyrek Raporu.docx");
	const target = join(folder, "rapor.md");
	await writeFile(docx, await createSampleDocx());

	const { app, page, errors } = await launch();
	await page.evaluate(
		(path) => (window as unknown as { kalem: KalemBridge }).kalem.openPath(path),
		docx,
	);

	await expect(page.locator("#editor h1").first()).toHaveText("Çeyrek Raporu");
	await expect(page.locator(".notice")).toContainText("1 image(s) in an unsupported format");
	await expect(status(page)).toHaveText("Unsaved");
	expect(await windowTitle(app)).toBe("● Çeyrek Raporu – Kalem");

	await stubSaveDialog(app, target);
	await save(page);
	await expect(status(page)).toHaveText("Saved");

	const markdown = await readFile(target, "utf8");
	expect(markdown).toContain("# Çeyrek Raporu\n");
	expect(markdown).toContain("**üç**");
	expect(markdown).toContain("~~iptal~~");
	expect(markdown).toContain("[detaylı rapor](https://ornek.com/rapor)");
	expect(markdown).toContain("- Maliyet sabit kaldı\n  - Kira\n  - Personel\n");
	expect(markdown).toContain("1. Bütçe gözden geçirilecek\n2. Ekip bilgilendirilecek\n");
	expect(markdown).toContain("> Ölçmediğin şeyi yönetemezsin.");
	expect(markdown).toContain("| Kalem | Tutar |\n| --- | --- |\n| Gelir | 120 (tahmini) |");
	expect(markdown).toContain("Son paragraf: a < b & c.");
	expect(markdown).not.toContain("data:image");

	const assets = await readdir(join(folder, "rapor.assets"));
	expect(assets).toEqual(["Kırmızı-nokta.png"]);
	expect(markdown).toContain("![Kırmızı nokta](rapor.assets/K%C4%B1rm%C4%B1z%C4%B1-nokta.png)");

	// The relinked image must still display: relative URL → <base> → kalem-doc://.
	const image = page.locator("#editor img");
	await expect(image).toHaveAttribute("src", "rapor.assets/K%C4%B1rm%C4%B1z%C4%B1-nokta.png");
	await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

	expect(errors).toEqual([]);
	await app.close();
});

test("inserts a table and changes its structure from the Table tab", async () => {
	const target = join(await tempDir("table"), "tablo.md");
	const { app, page, errors } = await launch();

	await expect(page.locator('[data-tab="table"]')).toBeHidden();
	await page.locator('[data-tab="insert"]').click();
	await page.locator('#panel-insert [data-command="table"]').click();
	await page.locator('.table-picker-cell[data-rows="2"][data-columns="3"]').click();

	await expect(page.locator("#editor table tr")).toHaveCount(2);
	await page.keyboard.type("Ad");
	await expect(page.locator('[data-tab="table"]')).toBeVisible();

	await page.locator('[data-tab="table"]').click();
	await page.locator('[data-command="table-row-below"]').click();
	await page.keyboard.type("Ayşe");
	await page.locator('[data-command="table-column-right"]').click();
	await page.locator('[data-command="table-align-right"]').click();
	await expect(page.locator("#editor table tr")).toHaveCount(3);
	await expect(page.locator("#editor table tr").first().locator("th")).toHaveCount(4);

	await stubSaveDialog(app, target);
	await save(page);
	await expect(status(page)).toHaveText("Saved");
	// The empty paragraph kept below the table serializes as a blank line.
	expect(await readFile(target, "utf8")).toBe(
		"| Ad |  |  |  |\n| --- | ---: | --- | --- |\n| Ayşe |  |  |  |\n|  |  |  |  |\n\n",
	);

	await page.locator('[data-command="table-delete"]').click();
	await expect(page.locator("#editor table")).toHaveCount(0);
	await expect(page.locator('[data-tab="table"]')).toBeHidden();
	expect(errors).toEqual([]);
	await discardAndClose(app);
});

test("recovers unsaved text after a crash", async () => {
	const first = await launch();
	await first.page.keyboard.type("Kaydedilmemiş cümle.");
	const drafts = join(first.userData, "drafts");
	await expect.poll(async () => (await readdir(drafts).catch(() => [])).length).toBe(1);

	// Hard-kill the real main process: `app.process()` is only Playwright's launcher.
	const mainPid = await first.app.evaluate(() => process.pid);
	process.kill(mainPid);

	const second = await relaunch(first.userData);
	await expect(second.page.locator("#editor p")).toHaveText("Kaydedilmemiş cümle.");
	await expect(second.page.locator(".notice")).toContainText("recovered");
	await expect(status(second.page)).toHaveText("Unsaved");

	// Discarding the recovered document removes its draft for good.
	await discardAndClose(second.app);
	expect(await readdir(drafts)).toEqual([]);
});

test("asks before closing a modified document", async () => {
	const { app, page } = await launch();
	await page.keyboard.type("değişiklik");
	await expect(status(page)).toHaveText("Unsaved");

	const close = () =>
		app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
	const windowCount = () =>
		app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

	await stubMessageBox(app, 2);
	await close();
	await page.waitForTimeout(300);
	expect(await windowCount()).toBe(1);

	const exited = new Promise((resolve) => app.process().once("exit", resolve));
	await stubMessageBox(app, 1);
	await close();
	await exited;
});

test("saves before closing when asked to", async () => {
	const target = join(await tempDir("close"), "son.md");
	const { app, page } = await launch();
	await page.keyboard.type("son söz");

	const exited = new Promise((resolve) => app.process().once("exit", resolve));
	await stubSaveDialog(app, target);
	await stubMessageBox(app, 0);
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
	await exited;

	expect(await readFile(target, "utf8")).toBe("son söz\n");
});

test("reloads an unmodified document when the file changes on disk", async () => {
	const path = join(await tempDir("external"), "a.md");
	await writeFile(path, "eski\n");
	const { app, page, errors } = await launch({ args: [path] });
	await expect(page.locator("#editor p")).toHaveText("eski");

	await writeFile(path, "yeni\n");
	const future = new Date((await stat(path)).mtimeMs + 5000);
	await utimes(path, future, future);
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit("focus"));

	await expect(page.locator("#editor p")).toHaveText("yeni");
	await expect(status(page)).toHaveText("Saved");
	expect(errors).toEqual([]);
	await app.close();
});

test("toggles source mode and keeps the text", async () => {
	const { app, page, errors } = await launch();
	await page.keyboard.type("# Başlık");
	await page.locator('[data-tab="view"]').click();
	await page.locator('[data-command="source"]').click();

	const source = page.locator("textarea.kalem-source");
	await expect(source).toBeVisible();
	await expect(source).toHaveValue("# Başlık");
	await source.fill("# Başlık\n\nKaynaktan eklendi.\n");
	await page.locator('[data-command="source"]').click();

	await expect(source).toBeHidden();
	await expect(page.locator("#editor p")).toHaveText("Kaynaktan eklendi.");
	expect(errors).toEqual([]);
	await discardAndClose(app);
});

test("stores a pasted image next to a saved document", async () => {
	const folder = await tempDir("paste");
	const path = join(folder, "notlar.md");
	await writeFile(path, "Görsel:\n");
	const { app, page, errors } = await launch({ args: [path] });

	await page.locator("#editor p").click();
	await page.evaluate((base64) => {
		const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], "Ekran Görüntüsü.png", { type: "image/png" }));
		document.activeElement?.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
		);
	}, PNG_1X1.toString("base64"));

	const image = page.locator("#editor img");
	await expect(image).toHaveAttribute(
		"src",
		"notlar.assets/Ekran-G%C3%B6r%C3%BCnt%C3%BCs%C3%BC.png",
	);
	await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
	expect(await readdir(join(folder, "notlar.assets"))).toEqual(["Ekran-Görüntüsü.png"]);

	await save(page);
	await expect(status(page)).toHaveText("Saved");
	expect(await readFile(path, "utf8")).toContain(
		"![Ekran Görüntüsü](notlar.assets/Ekran-G%C3%B6r%C3%BCnt%C3%BCs%C3%BC.png)",
	);
	expect(errors).toEqual([]);
	await app.close();
});

test("pastes into a code block as plain code", async () => {
	const path = join(await tempDir("paste-code"), "kod.md");
	await writeFile(path, "```json\n{}\n```\n");
	const { app, page, errors } = await launch({ args: [path] });

	await page.locator("#editor pre").click();
	await page.keyboard.press("End");
	await page.keyboard.press("ArrowLeft");
	await page.evaluate(() => {
		const data = new DataTransfer();
		data.setData("text/html", "<p><b>ad</b></p>");
		data.setData("text/plain", '\r\n  "ad": "# Ayşe",\r\n  "yaş": 30\r\n');
		document.activeElement?.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
		);
	});

	await save(page);
	await expect(status(page)).toHaveText("Saved");
	expect(await readFile(path, "utf8")).toBe('```json\n{\n  "ad": "# Ayşe",\n  "yaş": 30\n}\n```\n');
	expect(errors).toEqual([]);
	await app.close();
});

test("colors selected text and keeps the color in the file", async () => {
	const path = join(await tempDir("text-color"), "renk.md");
	await writeFile(path, "önemli not\n\n[bağlantı](https://example.com)\n");
	const { app, page, errors } = await launch({ args: [path] });
	const menu = page.locator('[data-command="text-color"]');
	const red = page.locator('[data-command="text-color-e03131"]');

	// Without a selection nothing is colored and the user is told why.
	await page.locator("#editor p").first().click();
	await menu.click();
	await red.click();
	await expect(page.locator(".notice")).toContainText("Select the text");
	await expect(page.locator("#editor [data-kalem-color]")).toHaveCount(0);

	await page.keyboard.press("End");
	for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
	await menu.click();
	await expect(red).toBeVisible();
	await red.click();
	await expect(red).toBeHidden();
	const colored = page.locator("#editor [data-kalem-color]");
	await expect(colored).toHaveText("not");
	await expect(colored).toHaveCSS("color", "rgb(224, 49, 49)");
	await menu.click();
	await expect(red).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.press("Escape");

	// A colored link takes the color too.
	await page.locator("#editor p").nth(1).click();
	await page.keyboard.press("End");
	await page.keyboard.press("Shift+Home");
	await menu.click();
	await red.click();
	await expect(page.locator("#editor [data-kalem-color] a")).toHaveCSS("color", "rgb(224, 49, 49)");

	await save(page);
	await expect(status(page)).toHaveText("Saved");
	expect(await readFile(path, "utf8")).toBe(
		[
			'önemli <span style="color:#e03131">not</span>',
			"",
			'<span style="color:#e03131">[bağlantı](https://example.com)</span>',
			"",
		].join("\n"),
	);
	await app.close();

	const reopened = await launch({ args: [path] });
	await expect(reopened.page.locator("#editor [data-kalem-color]").first()).toHaveText("not");
	await reopened.page.locator("#editor p").first().click();
	await reopened.page.keyboard.press("End");
	for (let i = 0; i < 3; i++) await reopened.page.keyboard.press("Shift+ArrowLeft");
	await reopened.page.locator('[data-command="text-color"]').click();
	await reopened.page.locator('[data-command="text-color-none"]').click();
	await expect(
		reopened.page.locator("#editor p").first().locator("[data-kalem-color]"),
	).toHaveCount(0);
	await save(reopened.page);
	await expect(status(reopened.page)).toHaveText("Saved");
	expect(await readFile(path, "utf8")).toContain("önemli not\n");
	expect([...errors, ...reopened.errors]).toEqual([]);
	await reopened.app.close();
});

test("merges selected blocks into one and turns them into a code block", async () => {
	const path = join(await tempDir("merge"), "birlestir.md");
	await writeFile(path, "satır bir\n\nsatır iki\n\nsatır üç\n\nson\n\nek\n");
	const { app, page, errors } = await launch({ args: [path] });
	const blocks = page.locator("#editor > [data-kalem-id]");
	const merge = page.locator('[data-command="merge-blocks"]');

	// Nothing above the first block to merge into.
	await blocks.first().click();
	await expect(merge).toBeDisabled();

	const first = await blocks.nth(0).boundingBox();
	const third = await blocks.nth(2).boundingBox();
	if (first === null || third === null) throw new Error("blocks are not laid out");
	await page.mouse.move(first.x + 6, first.y + first.height / 2);
	await page.mouse.down();
	await page.mouse.move(third.x + third.width - 6, third.y + third.height / 2, { steps: 12 });
	await page.mouse.up();
	await expect(page.locator("#editor .kalem-selected")).toHaveCount(3);

	await expect(merge).toBeEnabled();
	await merge.click();
	await expect(blocks).toHaveCount(3);
	await expect(blocks.first().locator("br")).toHaveCount(2);

	await page.locator('[data-command="style-code"]').click();
	await expect(page.locator("#editor > pre")).toHaveText("satır bir\nsatır iki\nsatır üç\n");

	// With only a caret, the block joins the one above it.
	await blocks.nth(2).click();
	await clickMenu(app, "Format", "Merge Blocks");
	await expect(blocks).toHaveCount(2);

	await save(page);
	await expect(status(page)).toHaveText("Saved");
	expect(await readFile(path, "utf8")).toBe(
		"```\nsatır bir\nsatır iki\nsatır üç\n```\n\nson\\\nek\n",
	);
	expect(errors).toEqual([]);
	await app.close();
});

for (const language of ["en", "tr"]) {
	test(`keeps every ribbon tab on one row (${language})`, async () => {
		const { app, page } = await launch({ settings: { language } });
		for (const tab of ["home", "insert", "view"]) {
			await page.locator(`[data-tab="${tab}"]`).click();
			const tops = await page
				.locator(".ribbon-group:visible")
				.evaluateAll((groups) =>
					groups.map((group) => Math.round(group.getBoundingClientRect().top)),
				);
			expect(new Set(tops).size, tab).toBe(1);
		}
		await app.close();
	});
}

test("removes the loading screen once the editor is ready", async () => {
	const { app, page, errors } = await launch();
	await expect(page.locator("#editor")).toBeVisible();
	await expect(page.locator("#boot")).toHaveCount(0);
	expect(errors).toEqual([]);
	await app.close();
});

async function zipEntries(path: string): Promise<Record<string, Buffer>> {
	const zip = await JSZip.loadAsync(await readFile(path));
	const out: Record<string, Buffer> = {};
	for (const entry of Object.values(zip.files)) {
		if (!entry.dir) out[entry.name] = await entry.async("nodebuffer");
	}
	return out;
}

const imageWidth = (page: Page) =>
	page
		.locator("#editor img")
		.first()
		.evaluate((img: HTMLImageElement) => img.naturalWidth);

test("proposes Markdown when saving and a package only when asked", async () => {
	const folder = await tempDir("save-kind");
	const { app, page } = await launch();
	await page.locator("#editor p").first().click();
	await page.keyboard.type("Not");

	await stubSaveDialog(app, join(folder, "not.md"));
	await save(page);
	await expect(status(page)).toHaveText("Saved");
	const asked = await lastSaveDialog(app);
	expect(asked.defaultPath?.endsWith(".md")).toBe(true);
	expect(asked.filters?.[0]?.extensions).toEqual(["md", "markdown"]);
	expect(asked.filters?.map((filter) => filter.extensions[0])).toContain("kmd");

	await stubSaveDialog(app, join(folder, "not.kmd"));
	await clickMenu(app, "File", "Save as Package…");
	await expect(page.locator(".doc-tab").first()).toContainText("not");
	await expect.poll(async () => (await lastSaveDialog(app)).defaultPath).toMatch(/not\.kmd$/);
	expect((await lastSaveDialog(app)).filters?.[0]?.extensions).toEqual(["kmd", "textpack"]);
	await expect
		.poll(async () => Object.keys(await zipEntries(join(folder, "not.kmd"))).sort())
		.toEqual(["info.json", "text.md"]);
	await app.close();
});

test("packs a document with its images and files and opens the package again", async () => {
	const folder = await tempDir("package");
	await mkdir(join(folder, "notlar.assets"));
	await writeFile(join(folder, "notlar.assets", "logo.png"), PNG_1X1);
	await writeFile(join(folder, "notlar.assets", "rapor.pdf"), "%PDF-1.4");
	const source =
		"# Notlar\n\n![logo](notlar.assets/logo.png)\n\n[rapor](notlar.assets/rapor.pdf)\n";
	await writeFile(join(folder, "notlar.md"), source);
	await mkdir(join(folder, "paylas"));
	const packagePath = join(folder, "paylas", "Notlar.kmd");

	const first = await launch({ args: [join(folder, "notlar.md")] });
	await stubSaveDialog(first.app, packagePath);
	await clickMenu(first.app, "File", "Save as Package…");
	await expect(status(first.page)).toHaveText("Saved");
	await expect.poll(() => windowTitle(first.app)).toBe("Notlar – Kalem");
	// The image now comes from inside the package.
	await expect.poll(() => imageWidth(first.page)).toBe(1);

	let files = await zipEntries(packagePath);
	expect(Object.keys(files).sort()).toEqual([
		"assets/logo.png",
		"assets/rapor.pdf",
		"info.json",
		"text.md",
	]);
	expect(files["text.md"]?.toString("utf8")).toBe(
		"# Notlar\n\n![logo](assets/logo.png)\n\n[rapor](assets/rapor.pdf)\n",
	);
	expect(files["assets/logo.png"]).toEqual(Buffer.from(PNG_1X1));
	// The Markdown file it came from is left as it was.
	expect(await readFile(join(folder, "notlar.md"), "utf8")).toBe(source);

	// An image pasted into the package goes into it on the next save.
	await first.page.locator("#editor h1").click();
	await first.page.keyboard.press("End");
	await first.page.keyboard.press("Enter");
	await first.page.evaluate((base64) => {
		const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], "ekran.png", { type: "image/png" }));
		document.activeElement?.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
		);
	}, PNG_1X1.toString("base64"));
	await expect(first.page.locator("#editor img")).toHaveCount(2);
	await save(first.page);
	await expect(status(first.page)).toHaveText("Saved");
	files = await zipEntries(packagePath);
	expect(Object.keys(files)).toContain("assets/ekran.png");
	expect(files["text.md"]?.toString("utf8")).toContain("![ekran](assets/ekran.png)");
	expect(first.errors).toEqual([]);
	await first.app.close();

	// Elsewhere, with the original files gone, the package carries everything.
	const moved = await tempDir("package-moved");
	await writeFile(join(moved, "Notlar.kmd"), await readFile(packagePath));
	const second = await launch({ args: [join(moved, "Notlar.kmd")] });
	await expect(second.page.locator("#editor h1")).toHaveText("Notlar");
	await expect.poll(() => imageWidth(second.page)).toBe(1);
	await expect(second.page.locator("#editor img")).toHaveCount(2);
	expect(second.errors).toEqual([]);
	await second.app.close();
});

test("brings images along when a document is saved into another folder", async () => {
	const folder = await tempDir("save-elsewhere");
	await mkdir(join(folder, "a", "rapor.assets"), { recursive: true });
	await writeFile(join(folder, "a", "rapor.assets", "grafik.png"), PNG_1X1);
	await writeFile(join(folder, "a", "rapor.md"), "![grafik](rapor.assets/grafik.png)\n");
	await mkdir(join(folder, "b"));

	const { app, page, errors } = await launch({ args: [join(folder, "a", "rapor.md")] });
	await stubSaveDialog(app, join(folder, "b", "kopya.md"));
	await clickMenu(app, "File", "Save As…");
	await expect(status(page)).toHaveText("Saved");
	expect(await readFile(join(folder, "b", "kopya.md"), "utf8")).toBe(
		"![grafik](kopya.assets/grafik.png)\n",
	);
	expect(await readdir(join(folder, "b", "kopya.assets"))).toEqual(["grafik.png"]);
	await expect.poll(() => imageWidth(page)).toBe(1);
	expect(errors).toEqual([]);
	await app.close();
});

test("recovers unsaved changes to a package with its images", async () => {
	const folder = await tempDir("package-crash");
	const zip = new JSZip();
	zip.file("text.md", "# Albüm\n\n![foto](assets/foto.png)\n");
	zip.file("assets/foto.png", PNG_1X1);
	const path = join(folder, "Albüm.kmd");
	await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));

	const first = await launch({ args: [path] });
	await first.page.locator("#editor h1").click();
	await first.page.keyboard.press("End");
	await first.page.keyboard.type(" 2026");
	const drafts = join(first.userData, "drafts");
	await expect.poll(async () => (await readdir(drafts).catch(() => [])).length).toBe(1);
	process.kill(await first.app.evaluate(() => process.pid));

	const second = await relaunch(first.userData);
	await expect(second.page.locator("#editor h1")).toHaveText("Albüm 2026");
	await expect.poll(() => imageWidth(second.page)).toBe(1);
	await save(second.page);
	await expect(status(second.page)).toHaveText("Saved");
	expect((await zipEntries(path))["text.md"]?.toString("utf8")).toBe(
		"# Albüm 2026\n\n![foto](assets/foto.png)\n",
	);
	expect(second.errors).toEqual([]);
	await second.app.close();
});

test("opens a TextBundle package made by another app", async () => {
	const folder = await tempDir("textpack");
	const zip = new JSZip();
	zip.file("Gezi.textbundle/text.markdown", "# Gezi\n\n![foto](assets/foto.png)\n");
	zip.file("Gezi.textbundle/assets/foto.png", PNG_1X1);
	zip.file("Gezi.textbundle/info.json", '{"version":2}');
	const path = join(folder, "Gezi.textpack");
	await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));

	const { app, page, errors } = await launch({ args: [path] });
	await expect(page.locator("#editor h1")).toHaveText("Gezi");
	await expect.poll(() => imageWidth(page)).toBe(1);
	expect(errors).toEqual([]);
	await app.close();
});

test("switches the theme and remembers it", async () => {
	const { app, page, userData } = await launch();
	const isDark = () => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
	expect(await isDark()).toBe(false);

	await page.locator('[data-tab="view"]').click();
	await page.locator('[data-command="theme-dark"]').click();
	await expect.poll(isDark).toBe(true);
	await expect(page.locator('[data-command="theme-dark"]')).toHaveAttribute("aria-pressed", "true");

	await app.close();
	const stored = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"));
	expect(stored.settings.theme).toBe("dark");
});

test("exports the document as HTML and PDF", async () => {
	const folder = await tempDir("export");
	const html = join(folder, "rapor.html");
	const pdf = join(folder, "rapor.pdf");
	const { app, page, errors } = await launch();
	await page.keyboard.type("# Dışa Aktarım");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Türkçe karakterler: ğüşiöç.");

	await stubSaveDialog(app, html);
	await clickMenu(app, "File", "Export", "HTML…");
	await expect
		.poll(() => readFile(html, "utf8").catch(() => ""))
		.toContain("<h1>Dışa Aktarım</h1>");
	const exported = await readFile(html, "utf8");
	expect(exported).toContain("<p>Türkçe karakterler: ğüşiöç.</p>");
	expect(exported).toContain(".kalem-doc");

	await stubSaveDialog(app, pdf);
	await clickMenu(app, "File", "Export", "PDF…");
	await expect
		.poll(async () => (await stat(pdf).catch(() => null))?.size ?? 0)
		.toBeGreaterThan(1000);
	expect((await readFile(pdf)).subarray(0, 5).toString("latin1")).toBe("%PDF-");

	expect(errors).toEqual([]);
	await discardAndClose(app);
});

test("opens a plain text file, shows its lines as written and saves it in place", async () => {
	const path = join(await tempDir("txt"), "notlar.txt");
	await writeFile(path, "Alışveriş listesi\r\nsüt, ekmek\r\n\r\n2 * 3 * 4 = 24\r\n");

	const { app, page, errors } = await launch({ args: [path] });
	const first = page.locator("#editor p").first();
	await expect(first).toHaveText("Alışveriş listesi\nsüt, ekmek");
	await expect(first).toHaveCSS("white-space", "pre-wrap");
	await expect(status(page)).toHaveText("Saved");
	expect(await windowTitle(app)).toBe("notlar – Kalem");

	await first.click();
	await page.keyboard.press("Control+End");
	await page.keyboard.type(", yumurta");
	await save(page);
	await expect(status(page)).toHaveText("Saved");

	expect(await readFile(path, "utf8")).toBe(
		"Alışveriş listesi\r\nsüt, ekmek, yumurta\r\n\r\n2 * 3 * 4 = 24\r\n",
	);
	expect(errors).toEqual([]);
	await app.close();
});

test("formats JSON and XML code blocks", async () => {
	const path = join(await tempDir("format-code"), "veri.md");
	await writeFile(
		path,
		[
			"# Veri",
			"",
			"```json",
			'{"ad":"Ayşe","etiketler":["a","b"]}',
			"```",
			"",
			"```xml",
			'<not><kime>Can</kime><ek tür="pdf"/></not>',
			"```",
			"",
			"```json",
			"{bozuk}",
			"```",
			"",
		].join("\n"),
	);
	const { app, page, errors } = await launch({ args: [path] });
	const blocks = page.locator("#editor pre");
	await expect(page.locator('[data-tab="code"]')).toBeHidden();

	// One block, from the contextual Code tab.
	await blocks.nth(0).click();
	await page.locator('[data-tab="code"]').click();
	await page.locator('[data-command="format-code"]').click();
	await expect(blocks.nth(0)).toHaveText(
		'{\n  "ad": "Ayşe",\n  "etiketler": [\n    "a",\n    "b"\n  ]\n}\n',
	);
	await expect(blocks.nth(1)).toContainText("<not><kime>");
	// The caret stays in the re-rendered block, so the contextual tab does too.
	await expect(page.locator('[data-tab="code"]')).toBeVisible();

	// Invalid content is reported and left alone.
	await blocks.nth(2).click();
	await page.locator('[data-command="format-code"]').click();
	await expect(page.locator(".notice")).toContainText("not valid JSON");
	await expect(blocks.nth(2)).toHaveText("{bozuk}\n");

	// The rest, from the menu.
	await clickMenu(app, "Format", "Format All Code Blocks");
	await expect(blocks.nth(1)).toHaveText('<not>\n  <kime>Can</kime>\n  <ek tür="pdf"/>\n</not>\n');
	await expect(page.locator(".notice")).toContainText(
		"1 code block(s) formatted; 1 left unchanged",
	);

	await save(page);
	await expect(status(page)).toHaveText("Saved");
	expect(await readFile(path, "utf8")).toBe(
		[
			"# Veri",
			"",
			"```json",
			"{",
			'  "ad": "Ayşe",',
			'  "etiketler": [',
			'    "a",',
			'    "b"',
			"  ]",
			"}",
			"```",
			"",
			"```xml",
			"<not>",
			"  <kime>Can</kime>",
			'  <ek tür="pdf"/>',
			"</not>",
			"```",
			"",
			"```json",
			"{bozuk}",
			"```",
			"",
		].join("\n"),
	);
	expect(errors).toEqual([]);
	await app.close();
});

test("resizes, colors and sorts a table and keeps the styling in the file", async () => {
	const path = join(await tempDir("table-style"), "tablo.md");
	await writeFile(
		path,
		[
			"# Liste",
			"",
			"| Ad | Yaş | Şehir |",
			"| --- | ---: | --- |",
			"| Zeynep | 9 | İzmir |",
			"| Çağla | 30 | Ankara |",
			"| Ali | 100 | Bursa |",
			"",
		].join("\n"),
	);
	const { app, page, errors } = await launch({ args: [path] });
	const table = page.locator("#editor table");
	const header = (index: number) => table.locator("th").nth(index);
	const firstColumn = () => table.locator("tr td:first-child").allTextContents();
	const width = async (index: number) =>
		Math.round((await header(index).boundingBox())?.width ?? 0);

	await table.locator("td").first().click();
	await page.locator('[data-tab="table"]').click();

	// Sorting rewrites the rows; it is ordinary Markdown.
	await page.locator('[data-command="table-sort-ascending"]').click();
	expect(await firstColumn()).toEqual(["Ali", "Çağla", "Zeynep"]);
	await table.locator("tr").nth(1).locator("td").nth(1).click();
	await page.locator('[data-command="table-sort-descending"]').click();
	expect(await firstColumn()).toEqual(["Ali", "Çağla", "Zeynep"]);

	// Color.
	await page.locator('[data-command="color-blue"]').click();
	await expect(table).toHaveAttribute("data-table-color", "blue");
	await expect(page.locator('[data-command="color-blue"]')).toHaveAttribute("aria-pressed", "true");
	await expect(status(page)).toHaveText("Unsaved");

	// Width from the ribbon: the caret is in the second column.
	const before = await width(1);
	await page.locator('[data-command="table-column-widen"]').click();
	await page.locator('[data-command="table-column-widen"]').click();
	expect(await width(1)).toBe(before + 48);

	// Width by dragging the right border of the first column.
	const box = await header(0).boundingBox();
	if (box === null) throw new Error("header cell is not visible");
	await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
	await expect(page.locator("#editor")).toHaveAttribute("data-column-grip", "");
	await page.mouse.down();
	await page.mouse.move(box.x + box.width + 98, box.y + box.height / 2, { steps: 4 });
	await page.mouse.up();
	expect(await width(0)).toBe(Math.round(box.width) + 100);
	await expect(page.locator("#editor")).not.toHaveAttribute("data-column-grip", "");

	await save(page);
	await expect(status(page)).toHaveText("Saved");
	const saved = await readFile(path, "utf8");
	expect(saved).toBe(
		[
			"# Liste",
			"",
			`<!-- kalem:table color=blue widths=${Math.round(box.width) + 100},${before + 48} -->`,
			"",
			"| Ad | Yaş | Şehir |",
			"| --- | ---: | --- |",
			"| Ali | 100 | Bursa |",
			"| Çağla | 30 | Ankara |",
			"| Zeynep | 9 | İzmir |",
			"",
		].join("\n"),
	);
	expect(errors).toEqual([]);
	await page.screenshot({ path: "test-results/table-style.png" });
	await app.close();

	// Reopening restores the look and shows no comment block.
	const reopened = await launch({ args: [path] });
	const again = reopened.page.locator("#editor table");
	await expect(again).toHaveAttribute("data-table-color", "blue");
	await expect(reopened.page.locator("#editor pre")).toHaveCount(0);
	await expect(status(reopened.page)).toHaveText("Saved");
	const reopenedWidth = (await again.locator("th").first().boundingBox())?.width ?? 0;
	expect(Math.round(reopenedWidth)).toBe(Math.round(box.width) + 100);
	await reopened.app.close();
});

test("keeps several documents open in tabs", async () => {
	const folder = await tempDir("tabs");
	const first = join(folder, "birinci.md");
	const second = join(folder, "ikinci.md");
	await writeFile(first, "Birinci belge.\n");
	await writeFile(second, "İkinci belge.\n");

	const { app, page, errors } = await launch({ args: [first, second] });
	const tabs = page.locator(".doc-tab");
	const tab = (name: string) => page.locator(".doc-tab", { hasText: name });
	const paragraph = page.locator("#editor p");

	// Both files open as tabs; the last one is active.
	await expect(tabs).toHaveCount(2);
	await expect(tab("ikinci")).toHaveAttribute("aria-selected", "true");
	await expect(paragraph).toHaveText("İkinci belge.");
	expect(await windowTitle(app)).toBe("ikinci – Kalem");

	// Each tab keeps its own text and save state.
	await tab("birinci").click();
	await expect(paragraph).toHaveText("Birinci belge.");
	expect(await windowTitle(app)).toBe("birinci – Kalem");
	await paragraph.click();
	await page.keyboard.press("Control+End");
	await page.keyboard.type(" Değişti.");
	await expect(tab("birinci")).toHaveAttribute("data-dirty", "");
	await expect(status(page)).toHaveText("Unsaved");

	await tab("ikinci").click();
	await expect(status(page)).toHaveText("Saved");
	await expect(paragraph).toHaveText("İkinci belge.");
	await tab("birinci").click();
	await expect(paragraph).toHaveText("Birinci belge. Değişti.");

	// Saving writes the active tab's file only.
	await save(page);
	await expect(status(page)).toHaveText("Saved");
	await expect(tab("birinci")).not.toHaveAttribute("data-dirty", "");
	expect(await readFile(first, "utf8")).toBe("Birinci belge. Değişti.\n");
	expect(await readFile(second, "utf8")).toBe("İkinci belge.\n");

	// A document that is already open is brought forward instead of opened twice.
	await page.evaluate(
		(path) => (window as unknown as { kalem: KalemBridge }).kalem.openPath(path),
		second,
	);
	await expect(tabs).toHaveCount(2);
	await expect(tab("ikinci")).toHaveAttribute("aria-selected", "true");

	// New tab, then close it again.
	await page.locator('[data-command="new-tab"]').click();
	await expect(tabs).toHaveCount(3);
	await expect(tab("Untitled")).toHaveAttribute("aria-selected", "true");
	await expect(status(page)).toHaveText("New document");
	await page.keyboard.type("taslak");
	await stubMessageBox(app, 2);
	await tab("Untitled").locator(".doc-tab-close").click();
	await expect(tabs).toHaveCount(3);
	await stubMessageBox(app, 1);
	await tab("Untitled").locator(".doc-tab-close").click();
	await expect(tabs).toHaveCount(2);

	// Closing the last tab closes the window.
	const exited = new Promise((resolve) => app.process().once("exit", resolve));
	await tab("ikinci").locator(".doc-tab-close").click();
	await expect(tabs).toHaveCount(1);
	expect(errors).toEqual([]);
	await tab("birinci").locator(".doc-tab-close").click();
	await exited;
});

test("asks about every unsaved tab when the window closes", async () => {
	const folder = await tempDir("tabs-close");
	const first = join(folder, "a.md");
	const second = join(folder, "b.md");
	await writeFile(first, "a\n");
	await writeFile(second, "b\n");

	const { app, page } = await launch({ args: [first, second] });
	for (const name of ["a", "b"]) {
		await page.locator(".doc-tab", { hasText: name }).click();
		await page.locator("#editor p").click();
		await page.keyboard.press("Control+End");
		await page.keyboard.type("!");
	}
	await expect(page.locator(".doc-tab[data-dirty]")).toHaveCount(2);

	// "Save" for both: each tab is written to its own file before the window goes.
	const exited = new Promise((resolve) => app.process().once("exit", resolve));
	await stubMessageBox(app, 0);
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
	await exited;

	expect(await readFile(first, "utf8")).toBe("a!\n");
	expect(await readFile(second, "utf8")).toBe("b!\n");
});

test("attaches a file by copying it next to the document", async () => {
	const folder = await tempDir("attach");
	const document = join(folder, "rapor.md");
	const source = join(await tempDir("attach-source"), "Sözleşme (son).pdf");
	await writeFile(document, "Ek:\n");
	await writeFile(source, "%PDF-1.4 sahte içerik");

	const { app, page, errors } = await launch({ args: [document] });
	await page.locator("#editor p").click();
	await page.keyboard.press("Control+End");
	await page.keyboard.type(" ");

	await stubOpenDialog(app, [source]);
	await page.locator('[data-tab="insert"]').click();
	await page.locator('[data-command="attach-file"]').click();

	const link = page.locator("#editor a");
	await expect(link).toHaveText("Sözleşme (son).pdf");
	await expect(link).toHaveAttribute("href", "rapor.assets/S%C3%B6zle%C5%9Fme-son.pdf");
	expect(await readFile(join(folder, "rapor.assets", "Sözleşme-son.pdf"), "utf8")).toBe(
		"%PDF-1.4 sahte içerik",
	);
	// The original stays where it was.
	expect(await readFile(source, "utf8")).toBe("%PDF-1.4 sahte içerik");

	await save(page);
	await expect(status(page)).toHaveText("Saved");
	expect(await readFile(document, "utf8")).toContain(
		"[Sözleşme (son).pdf](rapor.assets/S%C3%B6zle%C5%9Fme-son.pdf)",
	);
	expect(errors).toEqual([]);
	await app.close();
});

test("saves an untitled document before attaching a file to it", async () => {
	const folder = await tempDir("attach-new");
	const document = join(folder, "yeni.md");
	const source = join(folder, "veri.csv");
	await writeFile(source, "a;b\n1;2\n");

	const { app, page } = await launch();
	await page.keyboard.type("Veri: ");
	await stubSaveDialog(app, document);
	await stubOpenDialog(app, [source]);
	await page.locator('[data-tab="insert"]').click();
	await page.locator('[data-command="attach-file"]').click();

	await expect(page.locator("#editor a")).toHaveAttribute("href", "yeni.assets/veri.csv");
	expect(await readdir(join(folder, "yeni.assets"))).toEqual(["veri.csv"]);
	expect(await windowTitle(app)).toContain("yeni");
	await discardAndClose(app);
});
