import { expect, test } from "@playwright/test";

/**
 * `@kalem/plugin-word-count`  (İş listesi: F4-05)
 *
 * Sayma birim testleriyle sabit (`count.test.ts`); burada ölçülen, durum
 * çubuğunun belgeyle birlikte güncellendiği ve gecikmenin yazmayı
 * engellemediği.
 */

declare global {
	interface Window {
		kalem: {
			editor: { setValue(md: string): void; focus(): void };
			sayacEklentisi: {
				counts(): { words: number; characters: number; minutes: number };
				refresh(): void;
			};
		};
	}
}

const durum = (page: import("@playwright/test").Page) => page.locator(".kalem-wordcount");
const parcalar = (page: import("@playwright/test").Page) =>
	durum(page).locator(".kalem-wordcount-item");

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
});

test("durum çubuğu sayıları gösteriyor", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setValue("bir iki üç\n"));
	await expect(parcalar(page).nth(0)).toHaveText("3 kelime");
	await expect(parcalar(page).nth(1)).toHaveText("10 karakter");
});

test("boş belgede okuma süresi gizli", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setValue(""));
	await expect(parcalar(page).nth(0)).toHaveText("0 kelime");
	await expect(parcalar(page).nth(2)).toBeHidden();
});

test("yazdıkça güncelleniyor", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setValue("bir\n"));
	await expect(parcalar(page).nth(0)).toHaveText("1 kelime");

	await page.locator("#editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" iki üç");
	// Sayaç gecikmeli; `toHaveText` zaten bekliyor.
	await expect(parcalar(page).nth(0)).toHaveText("3 kelime");
});

test("Türkçe metni doğru sayıyor", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setValue("Işık, gölgeyle birlikte gelir.\n"));
	await expect(parcalar(page).nth(0)).toHaveText("4 kelime");
});

test("Markdown işaretleri sayılmıyor", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setValue("# Başlık\n\nbu **kalın** metin\n"));
	// "Başlık", "bu", "kalın", "metin"
	await expect(parcalar(page).nth(0)).toHaveText("4 kelime");
});

test("okuma süresi uzun belgede görünüyor", async ({ page }) => {
	await page.evaluate(() => {
		window.kalem.editor.setValue(`${"kelime ".repeat(500)}\n`);
	});
	await expect(parcalar(page).nth(2)).toHaveText("3 dk okuma");
});

test("durum çubuğu adlandırılmış bir grup", async ({ page }) => {
	await expect(page.getByRole("group", { name: "Belge istatistikleri" })).toBeVisible();
});

test("sayaç canlı bölge değil", async ({ page }) => {
	// Her tuş vuruşunda "247 kelime" duyurmak yazmayı imkânsız kılardı.
	await expect(durum(page)).not.toHaveAttribute("aria-live", /.*/);
});
