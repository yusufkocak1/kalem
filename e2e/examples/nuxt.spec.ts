import { expect, test } from "@playwright/test";

/**
 * `examples/nuxt`  (İş listesi: F5-02)
 *
 * Kabul kriterinin ayırt edici maddesi: **`<ClientOnly>` gereksiz olmalı.**
 * Vue dünyasında editör sarmalayıcılarının neredeyse hepsi onu istiyor ve
 * bedeli görünür — sunucu boş kutu gönderiyor, içerik sonradan beliriyor,
 * arama motoru metni hiç görmüyor.
 */

const KOK = "http://localhost:3200/";

test("belge sunucuda çiziliyor", async ({ page }) => {
	// JavaScript hiç çalışmadan: ham HTML yanıtında başlık ve liste var.
	const yanit = await page.request.get(KOK);
	const html = await yanit.text();
	expect(html).toContain("<h1>Işık ve Gölge</h1>");
	expect(html).toContain("<li>yıldız işareti korunuyor</li>");
	// `<ClientOnly>` kullanılsaydı burada yalnızca boş bir kutu olurdu.
	expect(html).not.toContain("client-only");
});

test("hidrasyon uyuşmazlığı yok", async ({ page }) => {
	const hatalar: string[] = [];
	const uyarilar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	page.on("console", (m) => {
		if (m.type() === "warning" || m.type() === "error") uyarilar.push(m.text());
	});

	await page.goto(KOK);
	await expect(page.locator(".editor > h1")).toHaveText("Işık ve Gölge");
	// Vue uyuşmazlığı konsola yazar; sunucu ve istemci aynı HTML'i
	// üretmeseydi bu liste dolu olurdu.
	expect({ hatalar, uyarilar }).toEqual({ hatalar: [], uyarilar: [] });
});

test("editör sunucudan gelen elemanı devralıyor", async ({ page }) => {
	await page.goto(KOK);
	// Görüntüleyici çıktısı editörün blok yapısına dönüşmüş olmalı.
	await expect(page.locator(".editor > [data-kalem-id]")).toHaveCount(3);
	await expect(page.locator(".editor")).toHaveAttribute("role", "textbox");
});

test("düzenleme çalışıyor ve v-model güncelleniyor", async ({ page }) => {
	await page.goto(KOK);
	await page.locator(".editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YENİ");
	await expect(page.locator("main > section pre")).toContainText("YENİ");
});
