import { copyFile, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { extractTableStyles } from "../src/shared/table-style.js";
import { clickMenu, launch, stubSaveDialog, tempDir } from "./launch.js";

/**
 * Regression set: a file opened in the app and saved comes back byte for byte.
 *
 * The core's round-trip test proves `serialize(parse(md)) === md`; the app
 * puts more between the disk and the editor — encoding and line endings,
 * table styles lifted out of the text, previews of diagrams and math, the
 * editor's DOM read back on save, source mode. Each file here goes through
 * all of it: opened from the command line, sent to source mode and back,
 * saved, and compared with what was on disk.
 *
 * The corpus is the core's (`packages/core/fixtures`) plus the files in
 * `e2e/regresyon`, which hold what real documents have and the core's set
 * did not: Obsidian notes, deep lists, tables, READMEs with badges and HTML,
 * changelogs, escapes, fences, TOML front matter, BOM + CRLF, tabs and the
 * app's own blocks.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sets = [
	join(here, "regresyon"),
	join(here, "..", "..", "..", "packages", "core", "fixtures"),
];

/**
 * Files the app does not yet keep, and why. Each is a known bug, not a
 * choice: the test is expected to fail, and turns red the day the bug is
 * fixed so that the entry is removed.
 */
const KNOWN: Record<string, string> = {
	"14-kacis-ve-varliklar.md":
		"Escapes that are not needed are dropped (`\\*` → `*`, `\\#` → `#`), `[a]()` is written `[a](<>)` and emphasis in an image's alt text is lost",
	"15-kod-bloklari.md":
		"A fenced code block indented by two spaces loses its indent, and its lines are moved two columns left",
	"18-bosluk-sekme.md":
		"A tab after a list marker eats the item's first characters (`-\\tsekmeli` → `- meli`); a tab-indented code block loses columns on every save; a paragraph's leading spaces and an empty `> ` line are dropped",
	"21-masaustu-ozel.md": "A `$$` math block is read as Markdown, so `\\,` loses its backslash",
};
const KNOWN_SAVE = KNOWN;
const KNOWN_EDIT = KNOWN;

const corpus = (
	await Promise.all(
		sets.map(async (dir) =>
			(
				await readdir(dir)
			)
				.filter((name) => name.endsWith(".md"))
				.sort()
				.map((name) => ({ name, path: join(dir, name) })),
		),
	)
).flat();

const status = (page: Page) => page.locator(".save-status");

/** A picture a document names but the test folder does not have is not a failure. */
const realErrors = (errors: readonly string[]) =>
	errors.filter((error) => !error.startsWith("Failed to load resource"));

/** The file's text as the source view shows it: no BOM, LF line endings. */
const asSource = (bytes: Buffer) =>
	bytes
		.toString("utf8")
		.replace(/^\uFEFF/, "")
		.replace(/\r\n/g, "\n");

async function opened(name: string, from: string) {
	const file = join(await tempDir("regression"), name);
	await copyFile(from, file);
	const original = await readFile(file);
	const launched = await launch({ args: [file] });
	// A file that round-trips must not open as modified.
	await expect(status(launched.page)).toHaveText("Saved");
	return { ...launched, file, original };
}

async function sourceMode(page: Page, on: boolean): Promise<void> {
	await page.locator('[data-tab="view"]').click();
	await page.locator('[data-command="source"]').click();
	const source = page.locator("textarea.kalem-source");
	await (on ? expect(source).toBeVisible() : expect(source).toBeHidden());
}

/** Saves the modified document in place. */
async function saved(page: Page, file: string): Promise<Buffer> {
	await expect(status(page)).toHaveText("Unsaved");
	await page.locator('[data-command="save"]').click();
	await expect(status(page)).toHaveText("Saved");
	return readFile(file);
}

/**
 * Saves the document under a new name. A document that has not changed is
 * not written in place, so this is how its text is made to go through the
 * editor and onto the disk.
 */
async function savedAs(launched: { app: ElectronApplication; page: Page }, name: string) {
	const target = join(await tempDir("regression-as"), name);
	await stubSaveDialog(launched.app, target);
	await clickMenu(launched.app, "File", "Save As…");
	await expect.poll(async () => (await stat(target).catch(() => null)) !== null).toBe(true);
	await expect(status(launched.page)).toHaveText("Saved");
	return readFile(target);
}

test("the regression set is not empty", () => {
	expect(corpus.length).toBeGreaterThan(30);
});

for (const { name, path } of corpus) {
	test.describe(name, () => {
		test("is saved byte for byte after source mode and back", async () => {
			test.fail(KNOWN_SAVE[name] !== undefined, KNOWN_SAVE[name]);
			const launched = await opened(name, path);
			const { app, page, errors, original } = launched;

			await sourceMode(page, true);
			// The source view shows the file as it is, but for the table styles kept beside it.
			await expect(page.locator("textarea.kalem-source")).toHaveValue(
				extractTableStyles(asSource(original)).markdown,
			);
			await sourceMode(page, false);

			const written = await savedAs(launched, name);
			expect(written.toString("utf8")).toBe(original.toString("utf8"));
			expect(written.equals(original)).toBe(true);
			expect(realErrors(errors)).toEqual([]);
			await app.close();
		});

		test("keeps the rest of the file when a paragraph is added in source mode", async () => {
			test.fail(KNOWN_EDIT[name] !== undefined, KNOWN_EDIT[name]);
			const { app, page, errors, file, original } = await opened(name, path);

			await sourceMode(page, true);
			const source = page.locator("textarea.kalem-source");
			const added = (text: string) =>
				`${text}${text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n"}Regresyon sonu.\n`;
			await source.fill(added(await source.inputValue()));
			await sourceMode(page, false);
			await expect(page.locator("#editor p").last()).toHaveText("Regresyon sonu.");

			const written = await saved(page, file);
			// Encoding and line endings are the file's own.
			const bom = original.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
			expect(written.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(bom);
			if (original.includes("\r\n")) expect(written.toString("utf8")).not.toMatch(/[^\r]\n/);
			// The rest is the file as it was on disk, not as the source view showed it.
			expect(asSource(written)).toBe(added(asSource(original)));
			expect(realErrors(errors)).toEqual([]);
			await app.close();
		});
	});
}
