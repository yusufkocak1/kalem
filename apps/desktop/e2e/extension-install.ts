import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication, FrameLocator, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { clickMenu, stubOpenDialog, tempDir } from "./launch.js";

const PACK = join(import.meta.dirname, "..", "scripts", "pack-extension.mjs");

const WORDS = {
	en: {
		menu: "Extensions",
		manage: "Manage Extensions…",
		file: "Install from File…",
		any: "Connect to any address, from this computer",
		install: "Install",
		running: "Running",
	},
	tr: {
		menu: "Eklentiler",
		manage: "Eklentileri Yönet…",
		file: "Dosyadan Kur…",
		any: "Bu bilgisayardan her adrese bağlanır",
		install: "Kur",
		running: "Çalışıyor",
	},
};

/** Packs an extension folder, installs it from the file, lets `configure` fill its settings, and shows its pane. */
export async function installFolder(
	app: ElectronApplication,
	page: Page,
	folder: string,
	pane: string,
	title: string,
	options: { language?: "en" | "tr"; configure?: (card: Locator) => Promise<void> } = {},
): Promise<FrameLocator> {
	const words = WORDS[options.language ?? "en"];
	const { id } = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")) as {
		id: string;
	};
	const packagePath = join(await tempDir("ext"), `${id}.kalem-ext`);
	execFileSync(process.execPath, [PACK, folder, packagePath]);
	await stubOpenDialog(app, [packagePath]);
	await clickMenu(app, words.menu, words.manage);
	const settings = page.locator('[data-block="extensions"]');
	await settings.locator(".ext-intro").getByRole("button", { name: words.file }).click();
	await settings
		.locator(".ext-preview")
		.getByRole("button", { name: words.install, exact: true })
		.click();
	const card = settings.locator(`.ext-card[data-extension="${id}"]`);
	await expect(card.locator(".ext-badge")).toHaveText(words.running);
	await options.configure?.(card);
	await page.locator(`.stripe-bottom [data-pane="ext:${id}/${pane}"]`).click();
	await page.evaluate(() => {
		(document.querySelector(".tool-dock.dock-bottom") as HTMLElement).style.height = "560px";
	});
	return page.frameLocator(`iframe.ext-pane-frame[title="${title}"]`);
}
