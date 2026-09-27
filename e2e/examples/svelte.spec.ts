import { expect, test } from "@playwright/test";

/**
 * `examples/svelte`  (İş listesi: F5-03)
 *
 * Svelte için Kalem paketi **yok**. Burada ölçülen şey bunun bir eksiklik
 * olmadığı: `<kalem-editor>` gerçek bir Vite derlemesinde, gerçek bir
 * Svelte uygulamasında iki yönlü bağlanıyor ve form alanı gibi davranıyor.
 */

const KOK = "http://localhost:4175/";

type Kalem = HTMLElement & { value: string };

test.beforeEach(async ({ page }) => {
	await page.goto(KOK);
	await expect(page.locator(".editor h1").first()).toHaveText("Işık ve Gölge");
});

test("eleman kayıtlı ve yükselmiş", async ({ page }) => {
	expect(await page.evaluate(() => customElements.get("kalem-editor") !== undefined)).toBe(true);
	// Yan etkili giriş (`@kalem-editor/wc/define`) ağaç sarsmada düşseydi etiket
	// boş bir kutu olarak kalırdı.
	await expect(page.locator(".editor > div[role='textbox']").first()).toHaveCount(1);
});

test("class özniteliği elemana iniyor", async ({ page }) => {
	await expect(page.locator("main > kalem-editor.editor")).toHaveCount(1);
});

test("editör → Svelte: input olayı metni taşıyor", async ({ page }) => {
	await page.locator(".editor p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator("main > section pre")).toContainText("YENİ");
});

test("Svelte → editör: value özelliği iniyor", async ({ page }) => {
	await page.locator(".editor p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator("main > section pre")).toContainText("YENİ");

	await page.getByRole("button", { name: "Örneği geri yükle" }).click();
	await expect(page.locator(".editor p").first()).not.toContainText("YENİ");
});

test("art arda yazılan harfler aynı yere gidiyor", async ({ page }) => {
	// Döngü kırılmasaydı her tuştan sonra belge baştan yüklenir, imleç
	// başa kaçardı ve "abc" ters ya da dağınık çıkardı.
	await page.locator(".editor p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" abc");
	await expect(page.locator("main > section pre")).toContainText(" abc");
});

test("readOnly özelliği editöre iniyor", async ({ page }) => {
	await page.getByLabel("salt okunur").check();
	await expect(page.locator("main > kalem-editor > div")).toHaveAttribute("aria-readonly", "true");
	await page.getByLabel("salt okunur").uncheck();
	await expect(page.locator("main > kalem-editor > div")).toHaveAttribute("aria-readonly", "false");
});

test("focus() ilk düzenlenebilir bloğa gidiyor", async ({ page }) => {
	await page.getByRole("button", { name: "Odağı editöre ver" }).click();
	expect(
		await page.evaluate(() =>
			document.querySelector("main > kalem-editor")?.contains(document.activeElement),
		),
	).toBe(true);
});

test.describe("form entegrasyonu", () => {
	test("boş ve required iken gönderim engelleniyor", async ({ page }) => {
		await page.getByRole("button", { name: "Gönder" }).click();
		// Tarayıcı `valueMissing` yüzünden formu göndermiyor; Svelte'nin
		// `onsubmit` işleyicisi hiç çalışmıyor.
		await expect(page.locator("#gonderilen")).toHaveText("—");
	});

	test("metin girilince FormData'ya giriyor", async ({ page }) => {
		await page.locator("kalem-editor[name='ozet']").evaluate((el) => el.focus());
		await page.keyboard.type("Özet metni");
		await page.getByRole("button", { name: "Gönder" }).click();
		await expect(page.locator("#gonderilen")).toHaveText("Özet metni");
	});

	test("sıfırlama başlangıç değerine dönüyor", async ({ page }) => {
		const alan = page.locator("kalem-editor[name='ozet']");
		await alan.evaluate((el) => el.focus());
		await page.keyboard.type("Geçici");
		expect(await alan.evaluate((el) => (el as Kalem).value)).toContain("Geçici");

		await page.getByRole("button", { name: "Sıfırla" }).click();
		await expect.poll(async () => alan.evaluate((el) => (el as Kalem).value)).toBe("");
	});
});
