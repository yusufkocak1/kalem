import { expect, test } from "@playwright/test";

/**
 * `apps/notlar` — dogfooding uygulaması  (İş listesi: F5-05)
 *
 * Bu bir örnek değil, **uygulama**: Kalem'i kendi ürünü gibi kullanan bir
 * not defteri. Buradaki testler kütüphanenin API'sini değil, uygulamanın
 * gerçekten çalıştığını ölçüyor — altı eklenti, araç çubuğu, not
 * değiştirme ve yerel kayıt bir arada.
 */

const KOK = "http://localhost:4178/";

test.beforeEach(async ({ page }) => {
	// Her test temiz bir defterle başlıyor; notlar `localStorage`da
	// yaşadığı için önceki testin kalıntısı sonrakini etkilerdi.
	await page.goto(KOK);
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await expect(page.locator(".yazi h1")).toHaveText("Kalem Notlar");
});

test("editör bir kez kuruluyor (Strict Mode dâhil)", async ({ page }) => {
	// React 19'un geliştirme kipi her etkiyi kurup söküp yeniden kuruyor;
	// üretim derlemesinde de tek editör, tek araç çubuğu bekleniyor.
	await expect(page.locator("[role='textbox']")).toHaveCount(1);
	await expect(page.locator(".kalem-toolbar")).toHaveCount(1);
});

test("altı eklenti de çalışıyor", async ({ page }) => {
	// İçindekiler — belgedeki üç başlık.
	await expect(page.locator(".anahat button")).toHaveCount(3);
	// Kelime sayacı.
	await expect(page.locator(".durum")).toContainText("kelime");
	// Kod vurgulama — modele dokunmadan span üretiyor.
	await expect(page.locator(".yazi pre code span").first()).toBeVisible();
});

test("yazınca liste başlığı ve yerel kayıt güncelleniyor", async ({ page }) => {
	await page.locator(".yazi h1").click();
	await page.keyboard.press("End");
	await page.keyboard.type(" düzenlendi");

	// React durumu anında; liste başlığı belgenin kendisinden okunuyor.
	await expect(page.locator(".satir .ad").first()).toHaveText("Kalem Notlar düzenlendi");

	// Otomatik kaydetme 800 ms sessizlikten sonra; gösterge durumu söylüyor.
	await expect(page.locator(".kayit")).toHaveText("Kaydedildi");
	const kayitli = await page.evaluate(() => localStorage.getItem("kalem:notlar:v1") ?? "");
	expect(kayitli).toContain("Kalem Notlar düzenlendi");
});

test("yeni not açınca odak editöre geçiyor", async ({ page }) => {
	/*
	 * Yeni not `key`i değiştiriyor, yani düğmenin tıklama işleyicisi
	 * çalışırken editör **henüz yok**; odak, kurulumu bildiren geri
	 * çağırmada veriliyor. Verilmeseydi kullanıcı fazladan bir tıklama
	 * yapmak zorunda kalırdı — uygulama yazılırken bulunan tek hata buydu.
	 */
	await page.getByRole("button", { name: "Yeni not" }).click();
	await page.keyboard.type("Toplantı notları");
	await expect(page.locator(".satir .ad").first()).toHaveText("Toplantı notları");
	await expect(page.locator(".liste li")).toHaveCount(2);
});

test("not değiştirmek belgeyi değiştiriyor", async ({ page }) => {
	await page.getByRole("button", { name: "Yeni not" }).click();
	await page.keyboard.type("İkinci not");
	await expect(page.locator(".satir.secili .ad")).toHaveText("İkinci not");

	await page.locator(".satir").nth(1).click();
	await expect(page.locator(".satir.secili .ad")).toHaveText("Kalem Notlar");
	await expect(page.locator(".yazi h1")).toHaveText("Kalem Notlar");
	// Editör yeniden kuruldu ama ikiye katlanmadı.
	await expect(page.locator("[role='textbox']")).toHaveCount(1);
	await expect(page.locator(".kalem-toolbar")).toHaveCount(1);
});

test("arama Türkçe kasa ve aksan farkını yok sayıyor", async ({ page }) => {
	await page.getByRole("button", { name: "Yeni not" }).click();
	await page.keyboard.type("Gölgeli Köşe");
	await expect(page.locator(".liste li")).toHaveCount(2);

	// `foldForSearch` hem kasayı hem aksanı katlıyor: `golgeli kose`
	// yazan `Gölgeli Köşe`yi buluyor.
	await page.getByLabel("Notlarda ara").fill("GOLGELI kose");
	await expect(page.locator(".liste li")).toHaveCount(1);
	await expect(page.locator(".satir .ad")).toHaveText("Gölgeli Köşe");

	await page.getByLabel("Notlarda ara").fill("bulunmayan");
	await expect(page.locator(".liste li")).toHaveCount(0);
	await expect(page.locator(".bos")).toContainText("sonuç yok");
});

test("not silinince defter boş kalmıyor", async ({ page }) => {
	// Boş ekran "her şeyi sildim" hissi veriyor ve yapılacak ilk şey
	// belirsiz kalıyor; uygulama yerine örnek notu koyuyor.
	await page.locator(".sil").first().click();
	await expect(page.locator(".liste li")).toHaveCount(1);
	await expect(page.locator(".yazi h1")).toHaveText("Kalem Notlar");
});

test("Markdown kaynağı açılıp kapanıyor", async ({ page }) => {
	const dugme = page.getByRole("button", { name: "Markdown kaynağı" });
	await dugme.click();
	await expect(page.locator("textarea")).toBeVisible();
	await expect(page.locator("textarea")).toHaveValue(/# Kalem Notlar/);
	await expect(dugme).toHaveAttribute("aria-pressed", "true");

	await dugme.click();
	await expect(page.locator("textarea")).toBeHidden();
	await expect(page.locator(".yazi h1")).toBeVisible();
});

test("içindekiler paneli kapatılabiliyor", async ({ page }) => {
	const dugme = page.getByRole("button", { name: "İçindekiler" });
	await expect(page.locator(".anahat")).toBeVisible();
	await dugme.click();
	await expect(page.locator(".anahat")).toBeHidden();
});

test("tema düğmesi hem kabuğu hem editörü çeviriyor", async ({ page }) => {
	/*
	 * Tek öznitelik iki tarafı birden döndürüyor: uygulamanın kendi paleti
	 * ve Kalem'in sözlüğü aynı `data-theme`e bakıyor. (İlk denemede
	 * `dark.css` koşulsuz yüklenmişti ve editör, açık temada bile koyu
	 * kalıyordu.)
	 */
	const zemin = (secici: string) =>
		page.locator(secici).evaluate((el) => getComputedStyle(el).backgroundColor);

	await page.evaluate(() => {
		document.documentElement.dataset["theme"] = "light";
	});
	const kabukAcik = await zemin("body");
	const yaziAcik = await page.locator(".yazi h1").evaluate((el) => getComputedStyle(el).color);

	await page.getByRole("button", { name: /tema/ }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	expect(await zemin("body")).not.toBe(kabukAcik);
	expect(await page.locator(".yazi h1").evaluate((el) => getComputedStyle(el).color)).not.toBe(
		yaziAcik,
	);
});

test("konsola hata düşmüyor", async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (e) => hatalar.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") hatalar.push(m.text());
	});
	await page.reload();
	await expect(page.locator(".yazi h1")).toHaveText("Kalem Notlar");
	await page.locator(".yazi p").first().click();
	await page.keyboard.type("deneme");
	await expect(page.locator(".kayit")).toHaveText("Kaydedildi");
	expect(hatalar).toEqual([]);
});
