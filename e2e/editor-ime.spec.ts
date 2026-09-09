import { expect, test } from "@playwright/test";

/**
 * IME — bileşimli yazım  (İş listesi: F2-13)
 *
 * ## Neden ayrı dosya, neden yalnızca Chromium
 *
 * Bileşim (composition) Playwright'ın klavye API'siyle taklit edilemiyor;
 * gerçek bir IME durumu gerekiyor. Chrome DevTools Protocol'ün
 * `Input.imeSetComposition` komutu tam olarak bunu kuruyor — tarayıcıya
 * "şu anda yarım kalmış bir hece var" dedirtiyor. CDP yalnızca Chromium'da
 * var, o yüzden diğer motorlarda atlanıyor.
 *
 * ## Ne ölçülüyor
 *
 * Mimarinin en kırılgan varsayımı: **bileşim sırasında DOM'a
 * karışmıyoruz.** Karışırsak tarayıcı bileşim durumunu düşürür ve yarım
 * kalan hece kaybolur. F2-05'te satır içi içeriğin DOM'dan okunmasının
 * gerekçesi buydu; burası o gerekçenin sınandığı yer.
 *
 * Bu, F1.5-02 matrisindeki *"IME ile Japonca/Çince yazım"* satırı. Matris
 * doldurulmadı; ölçüm buraya, gerçek koda düştü.
 */

declare global {
	interface Window {
		kalem: { editor: { getValue(): string; setValue(markdown: string): void } };
	}
}

test.describe("IME bileşimi", () => {
	test.skip(({ browserName }) => browserName !== "chromium", "CDP yalnızca Chromium'da");

	test.beforeEach(async ({ page }) => {
		await page.goto("/editor.html");
		await page.waitForFunction(() => "kalem" in window);
		await page.evaluate(() => window.kalem.editor.setValue(""));
		await page.locator("#editor > p").first().click();
	});

	test("bileşim sırasında ara metin görünüyor", async ({ page, context }) => {
		const cdp = await context.newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "にほんご",
			selectionStart: 4,
			selectionEnd: 4,
		});
		await expect(page.locator("#editor > p").first()).toHaveText("にほんご");
	});

	/** Asıl iddia: yarım kalan hece kaybolmuyor. */
	test("bileşim tamamlanınca model doğru", async ({ page, context }) => {
		const cdp = await context.newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "にほんご",
			selectionStart: 4,
			selectionEnd: 4,
		});
		await cdp.send("Input.insertText", { text: "日本語" });

		await expect(page.locator("#cikti")).toHaveText("日本語");
		// Boş metinden başlayan belgede sonda satır sonu yok: `parse("")`
		// `finalNewline` görmemiştir ve serileştirici uydurmuyor.
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("日本語");
	});

	test("bileşim var olan metnin ortasına ekleniyor", async ({ page, context }) => {
		await page.keyboard.type("ab");
		await page.keyboard.press("ArrowLeft");

		const cdp = await context.newCDPSession(page);
		await cdp.send("Input.imeSetComposition", { text: "ん", selectionStart: 1, selectionEnd: 1 });
		await cdp.send("Input.insertText", { text: "ん" });

		await expect(page.locator("#cikti")).toHaveText("aんb\n");
	});

	/**
	 * Giriş kuralları bileşim sırasında çalışmamalı: dönüşüm bloğu yeniden
	 * basar ve bileşim durumunu düşürür.
	 */
	test("bileşim sırasında giriş kuralı bloğu yeniden basmıyor", async ({ page, context }) => {
		const cdp = await context.newCDPSession(page);
		// `# ` kalıbı bileşim metninin içinde: kural tetiklenirse blok
		// başlığa döner ve bileşim kaybolur.
		await cdp.send("Input.imeSetComposition", { text: "# ", selectionStart: 2, selectionEnd: 2 });
		await expect(page.locator("#editor > h1")).toHaveCount(0);
		await expect(page.locator("#editor > p")).toHaveCount(1);
	});

	test("bileşimden sonra yazmaya devam edilebiliyor", async ({ page, context }) => {
		const cdp = await context.newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "にほん",
			selectionStart: 3,
			selectionEnd: 3,
		});
		await cdp.send("Input.insertText", { text: "日本" });
		await page.keyboard.type("語");
		await expect(page.locator("#cikti")).toHaveText("日本語\n");
	});

	test("bileşim bloğun DOM elemanını yeniden kurmuyor", async ({ page, context }) => {
		const cdp = await context.newCDPSession(page);
		await page.evaluate(() => {
			(window as unknown as { ilk: Element | null }).ilk = document.querySelector("#editor > p");
		});
		await cdp.send("Input.imeSetComposition", {
			text: "にほんご",
			selectionStart: 4,
			selectionEnd: 4,
		});
		const ayni = await page.evaluate(
			() =>
				(window as unknown as { ilk: Element | null }).ilk ===
				document.querySelector("#editor > p"),
		);
		expect(ayni).toBe(true);
	});
});
