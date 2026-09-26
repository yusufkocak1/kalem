import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Görsel regresyon  (İş listesi: F3-11)
 *
 * ## Ne yakalıyor
 *
 * İşlevsel testler "düğmeye basınca kalın oluyor mu" diye soruyor; bir CSS
 * değişikliğinin araç çubuğunu ekranın dışına atmasını ya da koyu temada
 * bir metni zemine karıştırmasını göremiyorlar. Ekran görüntüsü tam olarak
 * bunun için: **görünüşün kendisi** sabitleniyor.
 *
 * ## Neden yalnızca Chromium
 *
 * Üç motor aynı CSS'i üç farklı biçimde çiziyor; üç ayrı referans kümesi
 * tutmak, yakalanan her gerçek regresyona karşılık iki gürültü demek.
 * İşlevsel testler zaten üç motorda koşuyor — motorlar arası fark oradan
 * yakalanıyor. Buradaki soru dar: *CSS'te ne değişti.*
 *
 * ## Referanslar platforma bağlı ve bu bir tuzak
 *
 * Yazı tipi çizimi Windows ile Linux arasında birebir aynı değil; aynı
 * CSS iki işletim sisteminde farklı piksel üretiyor. Playwright bu yüzden
 * referansları platform ekiyle saklıyor ve bir platformda üretilen
 * referans diğerinde **her zaman** kırmızı verir.
 *
 * Bu yüzden referansı olmayan platformda test **atlanıyor** ve sebebi
 * yazılıyor. Sessizce yeşile dönmüyor: eksik olan tek şey karşılaştırma
 * ölçütü, davranış değil. O platformda ilk kez koşan kişi
 * `pnpm e2e --update-snapshots` çalıştırıp referansı üretiyor ve commit'e
 * ekliyor.
 *
 * CI için Linux referansları (`*-chromium-linux.png`) Playwright'ın resmi
 * imajında, CI ile aynı yerel ayarla üretildi; CI'daki tarayıcı işi de aynı
 * imajda koşuyor. Yeniden üretme komutu `ci.yml` içinde.
 */

declare global {
	interface Window {
		kalem: { editor: { setValue(md: string): void } };
	}
}

/**
 * Sabit içerik.
 *
 * Demo sayfasının örneğinden bağımsız: örnek değişince bütün referanslar
 * geçersiz olurdu ve o değişiklik görsel bir regresyon değil.
 */
const BELGE = `# Işık ve Gölge

Paragraf, **kalın**, *italik* ve [bağlantı](https://ornek.com).

## Alt başlık

- madde bir
- madde iki

> Alıntı bloğu.

\`\`\`ts
const kok = parse(md);
\`\`\`
`;

const TEMALAR = ["", "dark", "minimal"] as const;
const TEMA_ADI: Record<string, string> = { "": "acik", dark: "koyu", minimal: "yalin" };

/**
 * Bu platform için referans var mı.
 *
 * Yoksa test atlanıyor (yukarıdaki gerekçe). `snapshotPath` referansın
 * gerçek yolunu veriyor — ad şemasını burada tekrar etmemek önemli, aksi
 * hâlde Playwright'ın şeması değişince sessizce hep atlanır hâle gelirdi.
 */
function referansVar(ad: string): boolean {
	return existsSync(test.info().snapshotPath(ad));
}

/**
 * Referans üretme kipinde miyiz.
 *
 * Bu kontrol olmadan atlama kuralı kendi kendini kilitliyor: referans yok
 * diye atlanan test `toHaveScreenshot`a hiç varmıyor ve
 * `--update-snapshots` da referansı üretemiyor.
 */
function uretimKipi(): boolean {
	return test.info().config.updateSnapshots !== "none";
}

test.beforeEach(async ({ page, browserName }) => {
	test.skip(browserName !== "chromium", "Görsel regresyon tek motorda tutuluyor");
	await page.setViewportSize({ width: 1100, height: 800 });
	await page.goto("/editor.html");
	await page.waitForFunction(() => "kalem" in window);
	await page.evaluate((md) => window.kalem.editor.setValue(md), BELGE);
});

/** Temayı uygular ve stilin gerçekten yüklenmesini bekler. */
async function temaUygula(page: import("@playwright/test").Page, tema: string) {
	if (tema === "") return;
	await page.locator("#tema").selectOption(tema);
	// Stil dosyası ağdan geliyor; yüklenmeden alınan görüntü eski temayı
	// gösterir ve test rastgele kırmızıya döner.
	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.querySelector("#editor") as Element)
					.getPropertyValue("--kalem-shadow")
					.trim(),
			),
		)
		.not.toBe("");
	await page.waitForFunction(() => {
		const ek = document.getElementById("temaEk") as HTMLLinkElement;
		return ek.href === "" || (ek.sheet?.cssRules.length ?? 0) > 0;
	});
}

/**
 * Ekran görüntüsünü karşılaştırır.
 *
 * `caret: "hide"` şart: yanıp sönen imleç aynı sayfadan iki farklı
 * görüntü üretiyor ve test rastgele kırmızıya dönüyor.
 */
async function karsilastir(hedef: import("@playwright/test").Locator, ad: string): Promise<void> {
	if (!referansVar(ad) && !uretimKipi()) {
		test.skip(true, `Bu platform için referans yok: ${ad} — 'pnpm e2e --update-snapshots'`);
	}
	await expect(hedef).toHaveScreenshot(ad, { caret: "hide", animations: "disabled" });
}

for (const tema of TEMALAR) {
	const ad = TEMA_ADI[tema] as string;

	test.describe(`tema: ${ad}`, () => {
		test("belge", async ({ page }) => {
			await temaUygula(page, tema);
			await karsilastir(page.locator("#editor"), `belge-${ad}.png`);
		});

		test("sabit araç çubuğu", async ({ page }) => {
			await page.locator("#aracCubugu").selectOption("fixed");
			await temaUygula(page, tema);
			await expect(page.locator(".kalem-toolbar")).toBeVisible();
			await karsilastir(page.locator(".kalem-toolbar"), `cubuk-${ad}.png`);
		});

		test("balon araç çubuğu", async ({ page }) => {
			await temaUygula(page, tema);
			await page.locator("#editor > p").first().click();
			await page.keyboard.press("ControlOrMeta+a");
			await expect(page.locator(".kalem-bubble")).toBeVisible();
			await karsilastir(page.locator(".kalem-bubble"), `balon-${ad}.png`);
		});

		test("slash menü", async ({ page }) => {
			await temaUygula(page, tema);
			await page.locator("#editor > p").first().click();
			await page.keyboard.press("ControlOrMeta+a");
			await page.keyboard.type("/");
			await expect(page.locator(".kalem-slash")).toBeVisible();
			await karsilastir(page.locator(".kalem-slash"), `slash-${ad}.png`);
		});

		test("blok menüsü", async ({ page }) => {
			await temaUygula(page, tema);
			const kutu = await page.locator("#editor > p").first().boundingBox();
			await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
			await expect(page.locator(".kalem-handle")).toBeVisible();
			await page.locator(".kalem-handle-grip").click();
			await expect(page.locator(".kalem-block-menu")).toBeVisible();
			await karsilastir(page.locator(".kalem-block-menu"), `blok-menu-${ad}.png`);
		});

		test("bağlantı popover'ı", async ({ page }) => {
			await temaUygula(page, tema);
			await page.locator("#editor > p").first().click();
			await page.keyboard.press("ControlOrMeta+a");
			await page.keyboard.press("ControlOrMeta+k");
			await expect(page.locator(".kalem-link-popover")).toBeVisible();
			await karsilastir(page.locator(".kalem-link-popover"), `bag-${ad}.png`);
		});
	});
}
