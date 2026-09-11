import { expect, test } from "@playwright/test";

/**
 * `examples/nextjs`  (İş listesi: F5-01)
 *
 * Kabul kriterinin öteki yarısı ve asıl zor olanı: App Router uyumu.
 * Burada üç ayrı söz ölçülüyor ve üçü de derleme çıktısına bağlı —
 * kaynaktan çalışan bir geliştirme sunucusu hiçbirini yakalamazdı.
 */

const KOK = "http://localhost:3100/";

test("sunucu bileşeni içeriği önceden üretiliyor", async ({ page }) => {
	// Sayfanın HTML'i, JavaScript çalışmadan da metni taşıyor.
	const yanit = await page.request.get(KOK);
	const html = await yanit.text();
	expect(html).toContain("Kalem — Next.js örneği");
});

test("istemci bileşeni hidrate oluyor, editör bir kez kuruluyor", async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto(KOK);

	await expect(page.locator(".editor > h1")).toHaveText("Işık ve Gölge");
	await expect(page.locator(".editor > [data-kalem-id]")).toHaveCount(3);
	// Hidrasyon uyuşmazlığı burada hata olarak görünürdü.
	expect(hatalar).toEqual([]);
});

test("paket kendi 'use client' yönergesini taşıyor", async ({ page }) => {
	// Sayfa `dynamic(… ssr: false)` sarmalayıcısı kullanmıyor ve
	// `transpilePackages` ayarı yok. Derleme başarılıysa ve editör
	// çalışıyorsa, yönerge yayımlanan çıktıda duruyor demektir.
	await page.goto(KOK);
	await page.locator(".editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator(".editor > p").first()).toContainText("YENİ");
});

test("useKalemValue SSR'de patlamıyor, istemcide gerçek değeri veriyor", async ({ page }) => {
	await page.goto(KOK);
	const sayac = page.locator(".durum").first();
	await expect(sayac).toContainText("karakter");
	const metin = (await sayac.textContent()) ?? "";
	// Sunucu anlık görüntüsü boş dize; istemcide gerçek belge uzunluğu.
	expect(Number.parseInt(metin, 10)).toBeGreaterThan(50);
});
