import { expect, test } from "@playwright/test";

/**
 * Tarayıcı geçişi  (İş listesi: F6-09)
 *
 * Chrome / Firefox / Safari / Edge — dördünde de **aynı belge yazılıyor**.
 *
 * ## Neden ayrı bir dosya
 *
 * Geri kalan 1.130 test üç motorda koşuyor ve her biri tek bir davranışı
 * sabitliyor. Bu dosya farklı bir soruya cevap veriyor: kullanıcının
 * yaptığı işin **tamamı** baştan sona çalışıyor mu. O yüzden testler
 * küçük değil; her biri bir oturum.
 *
 * Edge için tek koşan dosya da bu (bkz. `playwright.config.ts`): Edge
 * Chrome'la aynı motoru kullanıyor, farklı olan kabuk.
 */

const BLOK = "#editor > [data-kalem-id]";

test.beforeEach(async ({ page }) => {
	await page.goto("/editor.html");
	await expect(page.locator(BLOK).first()).toBeVisible();
});

test("baştan sona bir yazma oturumu", async ({ page }) => {
	/*
	 * Tek testte bütün zincir: yaz → biçimle → geri al → ileri al →
	 * çıktıyı oku. Parçalara bölünse her parça geçip zincir bozuk
	 * kalabilirdi.
	 */
	const ilk = page.locator(BLOK).first();
	await ilk.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" — ışıkla İŞIK");

	await expect(page.locator("#cikti")).toContainText("ışıkla İŞIK");

	// Yeni blok: Enter bölüyor, yazılan yeni bloğa gidiyor.
	await page.keyboard.press("Enter");
	await page.keyboard.type("Yeni paragraf.");
	await expect(page.locator("#cikti")).toContainText("Yeni paragraf.");

	// Geri al iki adımı da geri sarıyor, ileri al geri getiriyor.
	await page.locator("#geri").click();
	await expect(page.locator("#cikti")).not.toContainText("Yeni paragraf.");
	await page.locator("#ileri").click();
	await expect(page.locator("#cikti")).toContainText("Yeni paragraf.");
});

test("kalın biçim uygulanıyor ve Markdown'a iniyor", async ({ page }) => {
	const ilk = page.locator(BLOK).first();
	await ilk.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" vurgulu");

	// Son sözcüğü seç: Shift+Ctrl+Left bir sözcük geri.
	await page.keyboard.press("Shift+Control+ArrowLeft");
	await page.locator('[data-bicim="strong"]').click();

	await expect(page.locator("#cikti")).toContainText("**vurgulu**");
	await expect(page.locator('[data-bicim="strong"]')).toHaveAttribute("aria-pressed", "true");
});

test("Türkçe karakterler bozulmadan gidip geliyor", async ({ page }) => {
	/*
	 * Charset, `contenteditable` normalleştirmesi ve serileştirme —
	 * üçünden biri bozuksa Türkçe karakterler ilk kaybolan şey.
	 */
	const ilk = page.locator(BLOK).first();
	await ilk.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" ığüşöçİĞÜŞÖÇ");

	await expect(page.locator("#cikti")).toContainText("ığüşöçİĞÜŞÖÇ");
});

test("sabit araç çubuğu montajı düzeni bozmuyor", async ({ page }) => {
	/*
	 * Demo varsayılanı balon çubuk; sabit çubuk seçilerek monte ediliyor.
	 * `mountUi` onu editörün **önceki kardeşi** olarak ekliyor ve bu bir
	 * kez ızgara düzenini bozmuştu — editör üçüncü hücreye düşmüştü.
	 */
	const oncekiGenislik = (await page.locator("#editor").boundingBox())?.width ?? 0;

	await page.locator("#aracCubugu").selectOption("fixed");
	await expect(page.locator(".kalem-toolbar")).toBeVisible();

	const sonrakiGenislik = (await page.locator("#editor").boundingBox())?.width ?? 0;
	expect(sonrakiGenislik).toBeGreaterThan(200);
	// Çubuk yukarıya giriyor, yana değil: genişlik değişmemeli.
	expect(Math.abs(sonrakiGenislik - oncekiGenislik)).toBeLessThan(2);
});

test("sayfa yatay kaydırma üretmiyor", async ({ page }) => {
	const tasma = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	expect(tasma).toBe(false);
});

test("konsola hata düşmüyor", async ({ page }) => {
	const hatalar: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error") hatalar.push(m.text());
	});
	page.on("pageerror", (e) => hatalar.push(e.message));

	const ilk = page.locator(BLOK).first();
	await ilk.click();
	await page.keyboard.press("End");
	await page.keyboard.type("deneme");
	await page.locator("#geri").click();

	expect(hatalar).toEqual([]);
});
