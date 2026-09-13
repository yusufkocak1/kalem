import { expect, test } from "@playwright/test";

/**
 * Doküman sitesi — giriş sayfası  (İş listesi: F6-05)
 *
 * Maddenin kabul kriteri "ilk 5 saniyede bu ne anlaşılıyor". Beş saniye
 * ölçülemez ama onu mümkün kılan şey ölçülebilir: ürünün kendisi, ilk
 * ekranda, çalışır hâlde.
 */

const KOK = "http://localhost:4179/";

test.beforeEach(async ({ page }) => {
	await page.goto(KOK);
	await expect(page.locator(".hero-deneme")).toBeVisible();
});

test("editör ilk ekranda, kaydırmadan görünüyor", async ({ page }) => {
	/*
	 * Starlight'ın splash hero'su bir hero resmi için yer ayırıyor; bizde
	 * resim yok. Kısılmadan önce editör 1280×800'de 555 piksel aşağıdan
	 * başlıyordu — yani ziyaretçi ürünü hiç görmeden karar veriyordu.
	 */
	await page.setViewportSize({ width: 1280, height: 800 });
	const kutu = await page.locator(".hero-deneme").boundingBox();
	expect(kutu).not.toBeNull();
	expect(kutu?.y ?? 9999).toBeLessThan(450);
});

test("editör gerçekten çalışıyor", async ({ page }) => {
	await page.locator(".hero-yazi p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator(".hero-cikti")).toContainText("YENİ");
});

test("çıktı Markdown, yazım tercihi korunuyor", async ({ page }) => {
	// Ürünün ayırt edici iddiası: çıktı JSON değil ve `*` listesi `-`
	// olmuyor. İkisi de sayfanın sağ yarısında duruyor.
	const cikti = page.locator(".hero-cikti");
	await expect(cikti).toContainText("# Işık ve Gölge");
	await expect(cikti).toContainText("* yıldız işareti korunuyor");
	await expect(cikti).toContainText("1) parantez ayracı da öyle");
});

test("araç çubuğu kurulu ve biçimlendirme çalışıyor", async ({ page }) => {
	await expect(page.locator(".hero-yazi-sar > .kalem-toolbar")).toHaveCount(1);

	await page.locator(".hero-yazi p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" kalınlaşacak");
	for (let i = 0; i < "kalınlaşacak".length; i++) {
		await page.keyboard.press("Shift+ArrowLeft");
	}
	await page.keyboard.press("Control+b");

	await expect(page.locator(".hero-cikti")).toContainText("**kalınlaşacak**");
});

test("kurulum tek satırda ve boyutlar rozet olarak duruyor", async ({ page }) => {
	await expect(page.locator(".kurulum code")).toHaveText(
		"npm i @kalem/editor @kalem/ui @kalem/themes",
	);
	await expect(page.locator(".rozet")).toHaveCount(4);
	// Rozetteki sayı `size-limit` ölçümü; hedef değil.
	await expect(page.locator(".rozet").first()).toContainText("34,6 kB");
});

test("konsola hata düşmüyor", async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (e) => hatalar.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") hatalar.push(m.text());
	});
	await page.reload();
	await expect(page.locator(".hero-yazi [contenteditable='true']").first()).toBeVisible();
	expect(hatalar).toEqual([]);
});
