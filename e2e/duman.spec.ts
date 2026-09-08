import { expect, test } from "@playwright/test";

/**
 * Faz 0 duman testi — mimari prototipi üzerinde çalışır.
 * Amacı prototipi doğrulamak değil, Playwright hattının uçtan uca
 * çalıştığını kanıtlamak. Gerçek editör testleri Faz 2'de gelir.
 */
test.describe("demo prototipi", () => {
	test("sayfa UTF-8 olarak yükleniyor", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("html")).toHaveAttribute("lang", "tr");
		// Türkçe karakter bozulmadan render ediliyor mu (charset regresyon testi).
		// Sunucu charset yollamazsa tarayıcı Windows-1252'ye düşer ve
		// "doğrulama" → "doÄŸrulama" olur; bu iddia tam olarak onu yakalar.
		await expect(page).toHaveTitle("Kalem Editör Prototipi");
		await expect(page.locator("body")).toContainText("mimari doğrulama prototipidir");
	});

	test("bloğa yazı yazılabiliyor", async ({ page }) => {
		await page.goto("/");
		const ilkBlok = page.locator(".row > .content[contenteditable='true']").first();
		await ilkBlok.click();
		await ilkBlok.pressSequentially("Işık ışıldıyor");
		await expect(ilkBlok).toContainText("Işık ışıldıyor");
	});
});
