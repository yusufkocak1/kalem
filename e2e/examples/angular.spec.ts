import { expect, test } from "@playwright/test";

/**
 * `examples/angular`  (İş listesi: F5-03)
 *
 * Angular için de Kalem paketi yok. Ölçülen şey `CUSTOM_ELEMENTS_SCHEMA`
 * ile kurulan köprünün gerçekten çalıştığı: `[value]` DOM özelliğine
 * yazıyor, `(input)` olayı yakalıyor, `viewChild` örneğe erişiyor.
 *
 * Uygulama **zonesiz** (`provideZonelessChangeDetection`): editörün yaydığı
 * olay bir sinyal yazıyor ve Angular'ın değişiklik algılaması onu görüyor.
 * Zone.js olmadığı için, olayın sinyale bağlanmaması durumunda ekran hiç
 * güncellenmezdi — aşağıdaki testler tam olarak bunu yakalar.
 */

const KOK = "http://localhost:4176/";

test.beforeEach(async ({ page }) => {
	await page.goto(KOK);
	await expect(page.locator(".editor h1")).toHaveText("Işık ve Gölge");
});

test("eleman kayıtlı ve yükselmiş", async ({ page }) => {
	expect(await page.evaluate(() => customElements.get("kalem-editor") !== undefined)).toBe(true);
	await expect(page.locator(".editor > div[role='textbox']")).toHaveCount(1);
});

test("başlangıç metni [value] bağlamasından geliyor", async ({ page }) => {
	// Eleman Angular tarafından oluşturulup **özelliği yazıldıktan sonra**
	// DOM'a giriyor; erken atama kurtarılmasaydı editör boş açılırdı.
	await expect(page.locator(".editor li")).toHaveCount(2);
	await expect(page.locator(".editor strong")).toHaveText("özel eleman");
});

test("(input) olayı sinyale yazıyor", async ({ page }) => {
	await page.locator(".editor p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator("section pre")).toContainText("YENİ");
	// Karakter sayacı da aynı sinyalden besleniyor.
	await expect(page.locator(".durum")).not.toHaveText("0 karakter");
});

test("[value] dışarıdan değişince editöre iniyor", async ({ page }) => {
	await page.locator(".editor p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator("section pre")).toContainText("YENİ");

	await page.getByRole("button", { name: "Örneği geri yükle" }).click();
	await expect(page.locator(".editor p").first()).not.toContainText("YENİ");
});

test("art arda yazılan harfler aynı yere gidiyor", async ({ page }) => {
	/*
	 * Döngü elemanın `value` setter'ında kırılıyor: gelen metin güncel
	 * metinle aynıysa belge yeniden yüklenmiyor. Kırılmasaydı Angular'ın
	 * geri yazdığı her değer imleci başa atardı.
	 */
	await page.locator(".editor p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" abc");
	await expect(page.locator("section pre")).toContainText(" abc");
});

test("[readOnly] özelliği editöre iniyor", async ({ page }) => {
	await page.getByLabel("salt okunur").check();
	await expect(page.locator("kalem-editor > div")).toHaveAttribute("aria-readonly", "true");
	await page.getByLabel("salt okunur").uncheck();
	await expect(page.locator("kalem-editor > div")).toHaveAttribute("aria-readonly", "false");
});

test("viewChild ile imperatif erişim", async ({ page }) => {
	await page.getByRole("button", { name: "Odağı editöre ver" }).click();
	expect(
		await page.evaluate(() =>
			document.querySelector("kalem-editor")?.contains(document.activeElement),
		),
	).toBe(true);
});

test("konsola uyarı düşmüyor", async ({ page }) => {
	// Bilinmeyen bir eleman şemasız kaldığında Angular derleme hatası
	// veriyor; çalışma zamanında da bağlama uyarıları olabiliyor.
	const uyarilar: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") uyarilar.push(m.text());
	});
	await page.reload();
	await expect(page.locator(".editor h1")).toHaveText("Işık ve Gölge");
	expect(uyarilar).toEqual([]);
});
