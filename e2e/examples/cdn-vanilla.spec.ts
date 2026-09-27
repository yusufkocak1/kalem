import { expect, test } from "@playwright/test";

declare global {
	interface Window {
		Kalem?: Record<string, unknown>;
	}
}

/**
 * `examples/cdn-vanilla`  (İş listesi: F5-04)
 *
 * Maddenin kabul kriteri: **tek `<script>` ile çalışıyor**. Burada
 * ölçülen tam olarak o — üstelik sayfanın kendi yazdığı JavaScript de
 * yok, yani editörün tamamı bildirimsel bir etiketten ibaret.
 */

const KOK = "http://localhost:4177/";

test.beforeEach(async ({ page }) => {
	await page.goto(KOK);
	await expect(page.locator("kalem-editor h1")).toHaveText("Işık ve Gölge");
});

test("sayfada tek bir script etiketi var", async ({ page }) => {
	const betikler = await page.evaluate(() =>
		[...document.querySelectorAll("script")].map((s) => s.getAttribute("src") ?? "satır içi"),
	);
	expect(betikler).toEqual(["./kalem-editor.iife.js"]);
});

test("script çıplak import bırakmıyor", async ({ page }) => {
	/*
	 * ESM çıktısı `@kalem-editor/editor`i dışarıda bırakıyor; CDN kullanıcısının
	 * paketleyicisi yok ve çıplak bir tanımlayıcı tarayıcıda çözülmez.
	 * Bu derlemede hepsi içeride — dosyada `@kalem-editor/` geçmemeli.
	 */
	const kod = await (await page.request.get(`${KOK}kalem-editor.iife.js`)).text();
	expect(kod).not.toContain('from"@kalem-editor/');
	expect(kod).not.toContain('require("@kalem-editor/');
});

test("eleman kendiliğinden kaydoluyor", async ({ page }) => {
	expect(await page.evaluate(() => customElements.get("kalem-editor") !== undefined)).toBe(true);
	// İmperatif API de duruyor.
	expect(await page.evaluate(() => Object.keys(window.Kalem ?? {}).sort())).toEqual([
		"defineKalemEditor",
		"kalemEditorElement",
	]);
});

test("başlangıç metni elemanın içinden okunuyor", async ({ page }) => {
	// HTML girintisi sökülmeseydi belgenin tamamı tek bir kod bloğu olurdu.
	await expect(page.locator("kalem-editor pre")).toHaveCount(0);
	await expect(page.locator("kalem-editor li")).toHaveCount(2);
	await expect(page.locator("kalem-editor strong")).toHaveText("özel eleman");
});

test("düzenleme çalışıyor", async ({ page }) => {
	await page.locator("kalem-editor p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator("kalem-editor p").first()).toContainText("YENİ");
});

test("form değeri gönderimde adres çubuğuna geçiyor", async ({ page }) => {
	// Arada JavaScript yok: `ElementInternals` alanı forma bağlıyor ve
	// gönderimi tarayıcının kendisi yapıyor.
	await page.locator("kalem-editor[name='ozet']").evaluate((el) => el.focus());
	await page.keyboard.press("End");
	await page.keyboard.type(" EK");
	await page.getByRole("button", { name: "Gönder" }).click();
	await page.waitForURL(/ozet=/);
	expect(decodeURIComponent(page.url())).toContain("ozet=Kısa+bir+özet.+EK");
});

test("boş ve required alan gönderimi engelliyor", async ({ page }) => {
	await page.locator("kalem-editor[name='ozet']").evaluate((el) => {
		(el as HTMLElement & { value: string }).value = "";
	});
	await page.getByRole("button", { name: "Gönder" }).click();
	// Tarayıcı `valueMissing` yüzünden göndermiyor; adres değişmiyor.
	await expect(page).toHaveURL(KOK);
});
