import { expect, test } from "@playwright/test";

/**
 * `apps/playground`  (İş listesi: F6-06)
 *
 * Kabul kriteri "kütüphanenin gücü 30 saniyede anlaşılıyor". Otuz saniye
 * ölçülemez; onu mümkün kılan beş iddia ölçülebilir — Word deneyimi,
 * Markdown çıktısı, kayıpsız gidiş-dönüş, Word'den yapıştırma ve büyük
 * belge. Testler bunları tek tek sınıyor.
 */

const KOK = "http://localhost:4180/";

test.beforeEach(async ({ page }) => {
	await page.goto(KOK);
	await expect(page.locator(".yazi h1")).toHaveText("Işık ve Gölge");
});

test("editör ve Word deneyimi kurulu", async ({ page }) => {
	await expect(page.locator("[role='textbox']")).toHaveCount(1);
	await expect(page.locator(".sol > .kalem-toolbar")).toHaveCount(1);
});

test("çıktı Markdown ve yazım tercihi korunuyor", async ({ page }) => {
	const cikti = page.locator("#cikti");
	await expect(cikti).toContainText("* yıldız işareti korunuyor");
	await expect(cikti).toContainText("1) parantez ayracı da öyle");
	// Setext başlık da olduğu gibi duruyor.
	await expect(cikti).toContainText("Alt başlık\n----------");
});

test("gidiş-dönüş rozeti byte-birebir diyor", async ({ page }) => {
	const rozet = page.locator("#gidisDonus");
	await expect(rozet).toHaveAttribute("data-durum", "iyi");
	await expect(rozet).toContainText("byte-birebir");

	// Yazdıktan sonra da bozulmuyor.
	await page.locator(".yazi p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" ve hâlâ birebir");
	await expect(rozet).toHaveAttribute("data-durum", "iyi");
});

test("Word'den yapıştırma Markdown üretiyor", async ({ page }) => {
	/*
	 * Ürünün en zor iddiası bu: Word'ün `mso-list` ile sahte liste yapan,
	 * iç içe boş `<span>` döşeyen HTML çorbasından başlık, liste ve
	 * bağlantı çıkarmak.
	 */
	await page.locator("#word").click();

	const cikti = page.locator("#cikti");
	await expect(cikti).toContainText("# Çeyrek Raporu");
	await expect(cikti).toContainText("## Sonraki adımlar");
	await expect(cikti).toContainText("- Gelir beklentinin üstünde");
	await expect(cikti).toContainText("[detaylı rapor](https://ornek.com/rapor)");
	await expect(cikti).toContainText("1. Bütçe gözden geçirilecek");
	// `<b>` ve `<i>` kalın ve italik oldu, `<span>` çorbası düştü.
	await expect(cikti).toContainText("**üç**");
	await expect(cikti).toContainText("*ölçüldü*");
	await expect(cikti).not.toContainText("<span");
});

test("bin bloklu belge açılıyor ve yazılabiliyor", async ({ page }) => {
	await page.selectOption("#ornek", { label: "Bin blok" });
	await expect(page.locator(".yazi h1")).toHaveText("Bin bloklu belge");

	await expect
		.poll(async () => (await page.locator("#bilgi").textContent()) ?? "")
		.toContain("blok");

	await page.locator(".yazi p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" YAZILDI");
	await expect(page.locator("#cikti")).toContainText("YAZILDI");
});

test("tema seçici hem kabuğu hem editörü çeviriyor", async ({ page }) => {
	const zemin = () => page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
	const yazi = () => page.locator(".yazi h1").evaluate((el) => getComputedStyle(el).color);

	const kabukAcik = await zemin();
	const yaziAcik = await yazi();

	await page.selectOption("#tema", "koyu");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	expect(await zemin()).not.toBe(kabukAcik);
	expect(await yazi()).not.toBe(yaziAcik);
});

test("yalın tema ek stil dosyasıyla geliyor", async ({ page }) => {
	// Açık/koyu `data-theme` ile; yalın ayrı bir katman olduğu için ayrı
	// yükleniyor (bkz. temalar rehberi).
	await expect(page.locator("#kalem-yalin-tema")).toHaveCount(0);
	await page.selectOption("#tema", "yalin");
	await expect(page.locator("#kalem-yalin-tema")).toHaveCount(1);
	await page.selectOption("#tema", "acik");
	await expect(page.locator("#kalem-yalin-tema")).toHaveCount(0);
});

test("araç çubuğu kipi değiştirilebiliyor", async ({ page }) => {
	await page.selectOption("#cubuk", "false");
	await expect(page.locator(".kalem-toolbar")).toHaveCount(0);
	// Belge kaybolmuyor: arayüz yeniden kuruluyor, metin değil.
	await expect(page.locator(".yazi h1")).toHaveText("Işık ve Gölge");

	await page.selectOption("#cubuk", "fixed");
	await expect(page.locator(".sol > .kalem-toolbar")).toHaveCount(1);
});

test("salt okunur ve Markdown kaynağı çalışıyor", async ({ page }) => {
	await page.getByLabel("salt okunur").check();
	await expect(page.locator(".yazi")).toHaveAttribute("aria-readonly", "true");
	await page.getByLabel("salt okunur").uncheck();

	const dugme = page.getByRole("button", { name: "Markdown kaynağı" });
	await dugme.click();
	await expect(page.locator("textarea")).toBeVisible();
	await expect(dugme).toHaveAttribute("aria-pressed", "true");
	await dugme.click();
	await expect(page.locator("textarea")).toBeHidden();
});

test("içindekiler paneli açılıyor", async ({ page }) => {
	await expect(page.locator("#icindekiler")).toBeHidden();
	await page.getByLabel("içindekiler").check();
	await expect(page.locator("#icindekiler")).toBeVisible();
	await expect(page.locator("#icindekiler button")).not.toHaveCount(0);
});

test("konsola hata düşmüyor", async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (e) => hatalar.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") hatalar.push(m.text());
	});
	await page.reload();
	await expect(page.locator(".yazi h1")).toHaveText("Işık ve Gölge");
	await page.locator("#word").click();
	await expect(page.locator("#cikti")).toContainText("# Çeyrek Raporu");
	expect(hatalar).toEqual([]);
});

test.describe("paylaşılabilir bağlantı", () => {
	test.use({ permissions: ["clipboard-read", "clipboard-write"] });

	test("paylaşılan bağlantı aynı içeriği açıyor", async ({ page, context }) => {
		// Kabul kriteri bu: bağlantı başka bir sekmede aynı belgeyi açmalı.
		await page.locator(".yazi p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.type(" — PAYLAŞILAN İÇERİK");

		await page.getByRole("button", { name: "Bağlantıyı kopyala" }).click();
		await expect(page.locator("#paylasim")).toContainText("Bağlantı kopyalandı");

		const adres = await page.evaluate(() => navigator.clipboard.readText());
		expect(adres).toContain("#1");

		const yeni = await context.newPage();
		await yeni.goto(adres);
		await expect(yeni.locator(".yazi p").first()).toContainText("PAYLAŞILAN İÇERİK");
		await expect(yeni.locator("#ipucu")).toContainText("paylaşılan bir bağlantıdan");
		await yeni.close();
	});

	test("belge sunucuya gitmiyor — karma parçasında", async ({ page }) => {
		/*
		 * Karma parçası istekte yok: paylaşılan bir belgenin metni, sayfayı
		 * barındıran sunucunun günlüklerine düşmüyor.
		 */
		const istekler: string[] = [];
		page.on("request", (r) => istekler.push(r.url()));

		await page.getByRole("button", { name: "Bağlantıyı kopyala" }).click();
		await expect(page.locator("#paylasim")).toBeVisible();

		expect(page.url()).toContain("#");
		expect(istekler.some((u) => u.includes("#"))).toBe(false);
	});

	test("bozuk bağlantı uygulamayı açmaya engel olmuyor", async ({ page }) => {
		// Kullanıcının eline kırpılmış bir bağlantı geçmiş olabilir.
		await page.goto(`${KOK}#1bozuk___veri`);
		await expect(page.locator("[role='textbox']")).toHaveCount(1);
		await expect(page.locator(".yazi h1")).toHaveText("Işık ve Gölge");
	});

	test("bağlantı geçmişe kayıt eklemiyor", async ({ page }) => {
		/*
		 * `location.hash = …` geçmişe kayıt ekliyor ve geri tuşu kullanıcıyı
		 * belgesinden çıkarıyordu; `replaceState` bunu önlüyor.
		 */
		const oncekiAdres = page.url();
		await page.getByRole("button", { name: "Bağlantıyı kopyala" }).click();
		await expect(page.locator("#paylasim")).toBeVisible();
		expect(page.url()).not.toBe(oncekiAdres);

		await page.goBack();
		// Geri gitmek playground'dan çıkarmalı, karmayı geri almamalı.
		expect(page.url()).not.toContain("#1");
	});
});
