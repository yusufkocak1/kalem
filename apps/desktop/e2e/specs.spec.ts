import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launch, tempDir } from "./launch.js";

const DOCUMENT = "# İade\n\n### FR-01: Tutar\n\nKabul kriterleri: tutar ödemeyi aşamaz.\n";

/** A spec made from the document as it is: its source line keeps the document's hash. */
async function specFor(folder: string, text: string): Promise<string> {
	const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
	const tasks = join(folder, "specs", "001-iade", "tasks.md");
	await mkdir(join(folder, "specs", "001-iade"), { recursive: true });
	await writeFile(
		tasks,
		`<!-- kalem-source: "iade.md" hash=${hash} -->\n\n# Tasks\n\n- [x] T1 (FR-01) Doğrula\n- [ ] T2 (FR-01) Test\n`,
	);
	return tasks;
}

test("says how far a document's spec is, and that it is out of date once the document is saved changed", async () => {
	const folder = await tempDir("spec");
	const path = join(folder, "iade.md");
	await writeFile(path, DOCUMENT);
	await specFor(folder, DOCUMENT);

	const { app, page, errors } = await launch({ args: [path] });
	const notice = page.locator(".notice", { hasText: "specs/001-iade" });
	await expect(notice).toContainText("Spec specs/001-iade: 1 of 2 tasks done.");

	await page.locator("#editor p").click();
	await page.keyboard.press("End");
	await page.keyboard.type(" Yeni kural.");
	await page.locator('[data-command="save"]').click();
	await expect.poll(() => readFile(path, "utf8")).toContain("Yeni kural.");
	await expect(notice).toContainText("is out of date");

	await notice.getByRole("button", { name: "Open the tasks" }).click();
	await expect(page.locator("#editor")).toContainText("Doğrula");
	expect(errors).toEqual([]);
	await app.close();
});
