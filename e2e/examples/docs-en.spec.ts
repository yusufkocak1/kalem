import { expect, test } from "@playwright/test";

/**
 * Doküman sitesi — İngilizce bölüm  (Faz 6 sonu)
 *
 * Duyuru İngilizce; okuyucunun geldiği sayfa `/en/`. Starlight çevrilmemiş
 * bir sayfayı sessizce Türkçe'ye düşürüyor, yani "sayfa açılıyor" yetmez:
 * sınanan şey sayfanın **İngilizce konuşması** — metin, canlı editörün
 * belgesi ve editörün kendi arayüzü (`lang: "en"` → İngilizce sözlük).
 */

const KOK = "http://localhost:4179/en/";

test("giriş sayfası İngilizce ve canlı editör İngilizce belgeyle açılıyor", async ({ page }) => {
	await page.goto(KOK);
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(page.locator(".hero-ipucu")).toContainText("This is a real editor");
	await expect(page.locator(".hero-cikti")).toContainText("# Light and Shadow");
	await expect(page.locator(".hero-yazi")).toHaveAttribute("lang", "en");
	// Editörün arayüzü de İngilizce: sabit çubuğun düğme adları sözlükten.
	await expect(page.locator('.hero-yazi-sar .kalem-toolbar button[aria-label="Bold"]')).toHaveCount(
		1,
	);
});

test("boyut rozetleri İngilizce ondalık ayırıcıyla", async ({ page }) => {
	await page.goto(KOK);
	// Sayının doğruluğu `guard:sizes`te; burada yalnızca biçim.
	await expect(page.locator(".rozet").first()).toContainText(/^editor \+ UI\s*\d+\.\d kB$/);
});

test("canlı sayfadaki üç editör İngilizce", async ({ page }) => {
	await page.goto(`${KOK}canli/`);
	for (const tab of ["Vanilla", "React", "Vue"]) {
		await page.getByRole("tab", { name: tab }).click();
		const panel = page.getByRole("tabpanel");
		await expect(
			panel.locator("[lang='en'] h1, h1[lang='en'], [lang='en'] :is(h1)").first(),
		).toContainText("Light and Shadow");
	}
});

test("İngilizce sayfalar birbirine /en/ ile bağlanıyor", async ({ page }) => {
	await page.goto(`${KOK}baslangic/`);
	await expect(page.locator("h1")).toHaveText("Getting started");
	const hrefs = await page
		.locator("main a[href^='/']")
		.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
	const turkceye = hrefs.filter((h) => !h.startsWith("/en/") && !h.startsWith("/_astro/"));
	expect(turkceye).toEqual([]);
});

test("konsola hata düşmüyor", async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (e) => hatalar.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") hatalar.push(m.text());
	});
	await page.goto(KOK);
	await page.goto(`${KOK}canli/`);
	await expect(page.getByRole("tabpanel")).toBeVisible();
	expect(hatalar).toEqual([]);
});
