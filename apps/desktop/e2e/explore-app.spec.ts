/**
 * Exploration of the editor, the files pane, the assistant and the settings
 * window, each scene looked at (`audit.ts`) at three window sizes, light and
 * dark. KALEM_EXPLORE_SHOTS / KALEM_EXPLORE_REPORT as in explore-atlassian.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { SETTING_PAGES } from "../src/shared/settings-pages.js";
import { createExplorer } from "./audit.js";
import { fakeClaude } from "./fake-claude.js";
import { clickMenu, launch, showPane, stubOpenDialog, tempDir } from "./launch.js";

test.setTimeout(900_000);

const DOC = `# Sipariş İptali Analizi

Kullanıcı siparişi **kargoya verilmeden** iptal edebilir; ödeme _aynı gün_ iade edilir. Ayrıntılar için [wiki](https://example.com) sayfasına bakın, \`orderId\` alanı zorunludur.

## Kurallar

1. Sipariş durumu "Hazırlanıyor" ise iptal serbesttir.
2. Kargoya verilmişse iade süreci başlar.
   - İç madde: kargo firması bilgilendirilir
- [ ] Bildirim şablonu hazırlanacak
- [x] Ödeme servisi entegrasyonu

| Alan | Tür | Zorunlu | Açıklama |
| --- | --- | --- | --- |
| orderId | string | evet | Sipariş kimliği, uzun bir açıklama metni burada yer alıyor |
| reason | enum | hayır | İptal nedeni |

> Not: Kısmi iptal bu sürümün kapsamında değildir.

\`\`\`ts
export function cancel(orderId: string): Promise<void> {
  return api.post(\`/orders/\${orderId}/cancel\`);
}
\`\`\`

---

## Açık Sorular

Uzun bir paragraf: ${"Kullanıcı deneyimi açısından iptal akışı en fazla iki adımda tamamlanmalı ve onay ekranı gösterilmelidir. ".repeat(6)}
`;

for (const theme of ["light", "dark"] as const) {
	test(`exploration: editor, files, assistant, settings — ${theme}`, async () => {
		const folder = await tempDir("explore-app");
		await mkdir(join(folder, "docs", "eski"), { recursive: true });
		const doc = join(folder, "analiz.md");
		await writeFile(doc, DOC);
		await writeFile(join(folder, "docs", "kurallar.md"), "# Kurallar\n\nİptal kuralı burada.\n");
		await writeFile(join(folder, "docs", "eski", "not.md"), "Eski iptal notu\n");
		await writeFile(join(folder, "config.json"), '{"iptal": true, "gun": 1}\n');
		await writeFile(join(folder, "Main.java"), "class Main { /* iptal */ }\n");
		const claude = await fakeClaude(folder);
		const { app, page, errors } = await launch({
			args: [doc],
			settings: { theme },
			env: { KALEM_CLAUDE: claude.path },
		});
		await app.evaluate(({ shell }) => {
			shell.openExternal = async () => {};
		});
		const ex = await createExplorer(app, page, `app-${theme}`, errors);

		// ── Editor ──
		await ex.scene("editor, document");
		for (const tab of ["insert", "review", "view"]) {
			const button = page.locator(`.ribbon-tab[data-tab="${tab}"]`);
			if ((await button.count()) === 0) continue;
			await button.click();
			await ex.scene(`ribbon ${tab}`);
		}
		await page.locator('.ribbon-tab[data-tab="home"]').click();
		await page.locator("#editor td", { hasText: "orderId" }).first().click();
		await ex.scene("editor, cursor in table (table tab)");
		await page.locator("#editor pre").first().click();
		await ex.scene("editor, cursor in code block (code tab)");
		await page.locator("#editor p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/");
		await page.waitForTimeout(300);
		await ex.scene("editor, slash menu", { fixed: true });
		await page.keyboard.press("Escape");
		await page.keyboard.press("Backspace");
		await page.keyboard.press("Backspace");
		await clickMenu(app, "Edit", "Replace…");
		await expect(page.locator(".kalem-find-input:visible").first()).toBeFocused();
		await page.keyboard.type("iptal");
		await ex.scene("editor, find & replace");
		await page.keyboard.press("Escape");
		await clickMenu(app, "View", "Command Palette…");
		await page.waitForTimeout(200);
		await ex.scene("command palette", { fixed: true });
		await page.keyboard.press("Escape");
		await clickMenu(app, "View", "Markdown Source");
		await ex.scene("markdown source");
		await clickMenu(app, "View", "Markdown Source");
		await showPane(page, "outline");
		await ex.scene("outline pane");

		// ── Files ──
		await stubOpenDialog(app, [folder]);
		await clickMenu(app, "File", "Open Folder…");
		await showPane(page, "files");
		const row = (name: string) => page.locator(".files-item[data-path]", { hasText: name });
		await expect(row("docs")).toBeVisible();
		await ex.scene("files, tree");
		await row("docs").click();
		await row("eski").click();
		await ex.scene("files, tree expanded");
		await row("kurallar.md").click({ button: "right" });
		await ex.scene("files, context menu", { fixed: true });
		await page.keyboard.press("Escape");
		await row("Main.java").click();
		await ex.scene("files, java file as text");
		await row("config.json").click();
		await ex.scene("files, json file");
		await page.locator(".files-search").fill("iptal");
		await expect(page.locator(".search-hit").first()).toBeVisible();
		await ex.scene("files, search in files");
		await page.locator(".files-search").fill("");
		await clickMenu(app, "File", "Quick Open…");
		await expect(page.locator(".quick-open-input:focus")).toHaveCount(1);
		await page.keyboard.type("kur");
		await ex.scene("quick open", { fixed: true });
		await page.keyboard.press("Escape");
		await page.locator(".doc-tab", { hasText: "analiz" }).click();

		// ── Assistant ──
		await clickMenu(app, "View", "AI Assistant");
		const pane = page.locator(".assistant");
		await expect(pane).toBeVisible();
		await expect(pane.locator(".assistant-subtitle")).toContainText("Claude Code");
		await ex.scene("assistant, empty");
		const input = pane.locator(".assistant-input");
		await input.fill("/");
		await expect(pane.locator(".assistant-commands")).toBeVisible();
		await ex.scene("assistant, slash commands", { fixed: true });
		await input.fill("");
		await input.fill("Onay sürecini çiz");
		await input.press("Enter");
		await expect(pane.locator(".assistant-assistant .assistant-diagram img").last()).toBeVisible({
			timeout: 20_000,
		});
		await ex.scene("assistant, reply with diagram");
		await input.fill("Bu belgeyi özetle, çok uzun bir soru: ".repeat(8));
		await ex.scene("assistant, long question typed");
		await input.fill("");

		// ── Settings ──
		await clickMenu(app, "File", "Settings…");
		const settings = page.locator(".settings-dialog");
		await expect(settings).toBeVisible();
		for (const category of SETTING_PAGES) {
			await settings.locator(`.settings-nav-item[data-category="${category}"]`).click();
			await ex.scene(`settings ${category}`);
		}
		const search = settings.locator('input[type="search"]').first();
		if ((await search.count()) > 0) {
			await search.fill("tema");
			await ex.scene("settings, search 'tema'");
			await search.fill("zzzqqq");
			await ex.scene("settings, search no result");
		}
		await page.keyboard.press("Escape");

		const ok = await ex.finish(errors);
		// Quit without the unsaved-changes question the edits above would ask.
		await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
		if (ok) expect(ex.findings).toEqual([]);
	});
}
