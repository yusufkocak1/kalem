import { expect, test } from "@playwright/test";

/**
 * `examples/vue-vite`  (İş listesi: F5-02)
 *
 * Sarmalayıcının Vue tarafındaki sözleri: `v-model`, `useKalem()` ve
 * öznitelik aktarımı gerçek bir Vite derlemesinde tutuyor mu.
 */

const KOK = "http://localhost:4174/";

test.beforeEach(async ({ page }) => {
	await page.goto(KOK);
	await expect(page.locator(".editor > h1")).toHaveText("Işık ve Gölge");
});

test("editör bir kez kuruluyor", async ({ page }) => {
	await expect(page.locator(".editor > [data-kalem-id]")).toHaveCount(3);
	await expect(page.locator(".editor > h1")).toHaveCount(1);
});

test("class özniteliği kutuya iniyor", async ({ page }) => {
	// Kök tek eleman olmadığı için Vue bunu kendiliğinden aktarmıyor;
	// bileşen `inheritAttrs: false` ile elle geçiriyor. Aktarılmasaydı
	// `.editor` seçicisi hiç eşleşmezdi.
	await expect(page.locator("main > div.editor")).toHaveCount(1);
});

test("v-model iki yönlü çalışıyor", async ({ page }) => {
	// Editör → Vue
	await page.locator(".editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator("main > section pre")).toContainText("YENİ");

	// Vue → editör
	await page.getByRole("button", { name: "Örneği geri yükle" }).click();
	await expect(page.locator(".editor > p").first()).not.toContainText("YENİ");
	await expect(page.locator("main > section pre")).not.toContainText("YENİ");
});

test("art arda yazılan harfler aynı yere gidiyor", async ({ page }) => {
	// `v-model` döngüsü kırılmasaydı her tuştan sonra imleç başa kaçardı.
	await page.locator(".editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" abc");
	await expect(page.locator("main > section pre")).toContainText(" abc");
});

test("readOnly prop'u editöre geçiyor", async ({ page }) => {
	await page.getByLabel("salt okunur").check();
	await expect(page.locator(".editor")).toHaveAttribute("aria-readonly", "true");
	await page.getByLabel("salt okunur").uncheck();
	await expect(page.locator(".editor")).toHaveAttribute("aria-readonly", "false");
});

test("useKalem editör örneğini veriyor", async ({ page }) => {
	const dugme = page.getByRole("button", { name: "Odağı editöre ver" });
	await expect(dugme).toBeEnabled();
	await dugme.click();
	expect(
		await page.evaluate(() => document.querySelector(".editor")?.contains(document.activeElement)),
	).toBe(true);
});

test("yuva içeriği düzenlenebilir alanın dışında", async ({ page }) => {
	// İçine konsaydı editörün ilk çiziminde silinirdi.
	await expect(page.locator(".editor .durum")).toHaveCount(0);
	await expect(page.locator("main > .durum")).toHaveCount(1);
});
