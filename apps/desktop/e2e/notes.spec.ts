import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, tempDir } from "./launch.js";

const TEXT =
	"# Sipariş İptali\n\nKullanıcı siparişi kargoya verilmeden iptal eder.\n\nİade süreci finans ekibiyle konuşulacak.\n";

test("notes of the user's own: a balloon beside the words, kept on this computer, never in the file", async () => {
	const folder = await tempDir("notes");
	const doc = join(folder, "iptal.md");
	await writeFile(doc, TEXT);
	const first = await launch({ args: [doc] });
	const { app, page } = first;

	// A word is selected; the Review tab's New Note puts a balloon beside it.
	await page.locator("#editor p", { hasText: "kargoya" }).waitFor();
	await page.evaluate(() => {
		const p = [...document.querySelectorAll("#editor p")].find((node) =>
			node.textContent?.includes("kargoya"),
		);
		const text = p?.firstChild as Text;
		const start = text.data.indexOf("kargoya verilmeden");
		const range = document.createRange();
		range.setStart(text, start);
		range.setEnd(text, start + "kargoya verilmeden".length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	});
	await page.locator('.ribbon-tab:has-text("Review")').click();
	await page.locator('[data-command="note-new"]').click();

	const column = page.locator(".notes-column");
	await expect(column).toBeVisible();
	await expect(column).toContainText("Only on this computer");
	const balloon = column.locator(".note-balloon");
	await expect(balloon).toHaveCount(1);
	// A new note is "Unclear" first, and its text is ready to be written.
	await expect(balloon).toHaveClass(/kind-question/);
	await expect(balloon.locator("textarea")).toBeFocused();
	await page.keyboard.type("Kargoda olan sipariş ne olacak?");
	await expect
		.poll(() => page.evaluate(() => CSS.highlights.get("kalem-note-question")?.size ?? 0))
		.toBe(1);

	// The kind is changed to "Careful".
	await balloon.locator(".note-kind-chip.kind-attention").click();
	await expect(balloon).toHaveClass(/kind-attention/);

	// A second note, from the menu, on the word at the cursor.
	await page.locator("#editor p", { hasText: "finans" }).click();
	await clickMenu(app, "Insert", "New Note (only on this computer)");
	await expect(balloon).toHaveCount(2);
	await page.keyboard.type("Finansla görüş");
	await page.keyboard.press("ControlOrMeta+Enter");
	// The second is under the first, as its words are.
	const boxes = await balloon.evaluateAll((items) =>
		items.map(
			(item) =>
				[item.querySelector("textarea")?.value ?? "", item.getBoundingClientRect().top] as const,
		),
	);
	const top = (text: string) => boxes.find(([content]) => content.includes(text))?.[1] ?? 0;
	expect(top("Finansla")).toBeGreaterThan(top("Kargoda"));

	// Nothing went into the document: it is not even unsaved, and the file is as it was.
	await expect(page.locator(".save-status")).toHaveText("Saved");
	expect(await readFile(doc, "utf8")).toBe(TEXT);
	await expect
		.poll(async () =>
			JSON.stringify(
				JSON.parse(
					await readFile(join(first.userData, "local-notes.json"), "utf8").catch(() => "{}"),
				),
			),
		)
		.toContain("Finansla görüş");

	// Resolved: out of the way, still kept.
	const finance = balloon.nth(1);
	await expect(finance.locator("textarea")).toHaveValue("Finansla görüş");
	await finance.click();
	await finance.locator('button[aria-label="Resolve"]').click();
	await expect(balloon).toHaveCount(1);
	await expect(column.locator(".notes-head-button", { hasText: "Resolved (1)" })).toBeVisible();
	await page.waitForTimeout(600);
	await app.close();

	// Opened again: the notes are back beside their words.
	const again = await launch({ args: [doc], userData: first.userData });
	const notes = again.page.locator(".note-balloon");
	await expect(notes).toHaveCount(1);
	await expect(notes.locator("textarea")).toHaveValue("Kargoda olan sipariş ne olacak?");
	await expect(notes).toHaveClass(/kind-attention/);
	// Deleted, and brought back.
	await notes.click();
	await notes.locator('button[aria-label="Delete"]').click();
	await expect(notes).toHaveCount(0);
	await again.page.locator(".notice").getByRole("button", { name: "Undo" }).click();
	await expect(notes).toHaveCount(1);
	// Hidden from the View menu: no margin and no tint.
	await clickMenu(again.app, "View", "Show my notes");
	await expect(again.page.locator(".notes-column")).toHaveCount(0);
	expect(await readFile(doc, "utf8")).toBe(TEXT);
	expect(first.errors).toEqual([]);
	expect(again.errors).toEqual([]);
	await again.app.close();
});

test("adding a note far down a long document keeps the page where it is", async () => {
	const folder = await tempDir("notes-scroll");
	const doc = join(folder, "uzun.md");
	await writeFile(
		doc,
		`# Uzun\n\n${Array.from({ length: 120 }, (_, i) => `Paragraf numara ${i + 1} burada.`).join("\n\n")}\n`,
	);
	const { app, page, errors } = await launch({ args: [doc] });
	const desk = page.locator(".desk:not([hidden])");
	const target = page.locator("#editor p", { hasText: "Paragraf numara 90 burada." });
	await target.scrollIntoViewIfNeeded();
	// At the end of the line, after its full stop: the note takes the last word.
	await target.click();
	const before = await desk.evaluate((element) => element.scrollTop);
	expect(before).toBeGreaterThan(1000);
	await clickMenu(app, "Insert", "New Note (only on this computer)");
	const balloon = page.locator(".note-balloon");
	await expect(balloon.locator("textarea")).toBeFocused();
	await page.keyboard.type("Burada kalmalı");
	await page.waitForTimeout(400);
	const after = await desk.evaluate((element) => element.scrollTop);
	// The page stays where it was (within a line or two), and the balloon is in view by its words.
	expect(Math.abs(after - before)).toBeLessThan(80);
	await expect(balloon).toBeInViewport();
	// Done with the note: back to the text, still in place.
	await page.keyboard.press("ControlOrMeta+Enter");
	await page.waitForTimeout(300);
	expect(Math.abs((await desk.evaluate((element) => element.scrollTop)) - before)).toBeLessThan(80);

	// A full-width page and the margin fit the window: no sideways scroll.
	await clickMenu(app, "View", "Full Width");
	await expect(page.locator(".app")).toHaveAttribute("data-full-width", "");
	await expect
		.poll(() => desk.evaluate((element) => element.scrollWidth - element.clientWidth))
		.toBeLessThanOrEqual(0);
	await expect(balloon).toBeInViewport();
	expect(errors).toEqual([]);
	await app.close();
});

test("switching to the Markdown source and back keeps the place being read", async () => {
	const folder = await tempDir("source-scroll");
	const doc = join(folder, "uzun.md");
	await writeFile(
		doc,
		`# Uzun\n\n${Array.from({ length: 120 }, (_, i) => `Paragraf numara ${i + 1} burada.`).join("\n\n")}\n`,
	);
	const { app, page, errors } = await launch({ args: [doc] });
	const desk = page.locator(".desk:not([hidden])");
	const target = page.locator("#editor p", { hasText: "Paragraf numara 80 burada." });
	await target.scrollIntoViewIfNeeded();
	const top = () =>
		target.evaluate((element) => {
			const deskBox = document.querySelector(".desk:not([hidden])")?.getBoundingClientRect();
			return element.getBoundingClientRect().top - (deskBox?.top ?? 0);
		});
	const before = await desk.evaluate((element) => element.scrollTop);
	expect(before).toBeGreaterThan(1000);
	const shown = await top();

	await clickMenu(app, "View", "Markdown Source");
	const source = page.locator("textarea.kalem-source");
	await expect(source).toBeVisible();
	// The source is shown where the page was: the paragraph's line is in view, the cursor on it.
	expect(await desk.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
	const caretLine = await source.evaluate(
		(box: HTMLTextAreaElement) => box.value.slice(0, box.selectionStart).split("\n").length,
	);
	const sourceText = await source.inputValue();
	const wanted = sourceText.split("\n").findIndex((line) => line.includes("numara 7")) + 1;
	expect(caretLine).toBeGreaterThanOrEqual(wanted);
	expect(caretLine).toBeLessThan(
		sourceText.split("\n").findIndex((line) => line.includes("numara 90")) + 1,
	);

	// And back: the same paragraph near the same place.
	await page.keyboard.press("Escape");
	await expect(source).toBeHidden();
	await expect(target).toBeInViewport();
	expect(Math.abs((await top()) - shown)).toBeLessThan(200);
	expect(errors).toEqual([]);
	await app.close();
});
