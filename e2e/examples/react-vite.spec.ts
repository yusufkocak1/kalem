import { expect, test } from "@playwright/test";

/**
 * `examples/react-vite`  (İş listesi: F5-01)
 *
 * Kabul kriterinin yarısı: örnek uygulama çalışıyor. Ölçülen şey
 * sarmalayıcının sözleri — kontrollü akış, imleç kararlılığı, Strict Mode
 * ve kancalar — gerçek bir Vite derlemesinde tutuyor mu.
 */

const KOK = "http://localhost:4173/";

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto(KOK);
	await expect(page.locator(".editor > h1")).toHaveText("Işık ve Gölge");
	expect(hatalar, "sayfa hatası").toEqual([]);
});

test("Strict Mode editörü ikiye katlamıyor", async ({ page }) => {
	// React 19'un geliştirme kipi etkiyi kurup söküp yeniden kuruyor.
	// Sökülen editör DOM içeriğini bırakıyor; ikinci kurulum onu
	// temizlemeseydi belge iki kez görünürdü.
	await expect(page.locator(".editor > [data-kalem-id]")).toHaveCount(3);
	await expect(page.locator(".editor > h1")).toHaveCount(1);
});

test("yazmak React durumunu güncelliyor", async ({ page }) => {
	await page.locator(".editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator("main > section pre")).toContainText("YENİ");
});

test("kontrollü kipte imleç kaçmıyor", async ({ page }) => {
	// Klasik tuzak: onChange → setState → value → setValue → imleç başa.
	// Art arda yazılan harfler aynı yere gitmezse bu test kırılıyor.
	await page.locator(".editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" abc");
	await expect(page.locator("main > section pre")).toContainText(" abc");
});

test("dışarıdan gelen değer editöre iniyor", async ({ page }) => {
	await page.locator(".editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" GEÇİCİ");
	await expect(page.locator("main > section pre")).toContainText("GEÇİCİ");

	await page.getByRole("button", { name: "Örneği geri yükle" }).click();
	await expect(page.locator(".editor > p").first()).not.toContainText("GEÇİCİ");
	await expect(page.locator("main > section pre")).not.toContainText("GEÇİCİ");
});

test("readOnly prop'u editöre geçiyor", async ({ page }) => {
	await page.getByLabel("salt okunur").check();
	await expect(page.locator(".editor")).toHaveAttribute("aria-readonly", "true");
	await page.getByLabel("salt okunur").uncheck();
	await expect(page.locator(".editor")).toHaveAttribute("aria-readonly", "false");
});

test("useKalemValue metni izliyor", async ({ page }) => {
	const once = await page.locator(".durum span").textContent();
	await page.locator(".editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type("xyz");
	await expect(page.locator(".durum span")).not.toHaveText(once ?? "");
});

test("useKalem editör örneğini veriyor", async ({ page }) => {
	const dugme = page.getByRole("button", { name: "Odağı editöre ver" });
	await expect(dugme).toBeEnabled();
	await dugme.click();
	expect(
		await page.evaluate(() => document.querySelector(".editor")?.contains(document.activeElement)),
	).toBe(true);
});
