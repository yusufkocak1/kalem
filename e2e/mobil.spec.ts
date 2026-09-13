import { expect, test } from "@playwright/test";

/**
 * Mobil geçişi  (İş listesi: F6-09)
 *
 * Karar gereği mobil **"çalışır ama optimize değil"**. Bu dosyanın işi
 * o cümlenin ilk yarısını kanıtlamak: belge yazılabiliyor ve düzen
 * bozulmuyor. İkinci yarı — neyin optimize olmadığı — bilinen kısıtlar
 * sayfasında yazılı (`apps/docs/.../bilinen-kisitlar.md`).
 *
 * ## Neyin taklidi yapılıyor, neyin yapılamıyor
 *
 * Playwright dokunmatiği, görünüm alanını, cihaz piksel oranını ve
 * kullanıcı aracısını taklit ediyor. Taklit **edemediği** iki şey var ve
 * ikisi de mobil yazma deneyiminin merkezinde:
 *
 * 1. **Sanal klavye.** Gerçek bir yazılım klavyesi `beforeinput`
 *    olaylarını farklı üretiyor (otomatik düzeltme, kelime tamamlama,
 *    bileşim), ekranın altını kaplıyor ve görünüm alanını kaydırıyor.
 *    Buradaki `keyboard.type` fiziksel klavye gibi davranıyor.
 * 2. **Yerel metin seçme jesti.** Mobilde metin seçmek uzun basıp
 *    tutamaçları sürüklemek demek; bu işletim sistemi katmanında oluyor
 *    ve tarayıcı otomasyonunun erişimi yok.
 *
 * Bu yüzden testler "mobilde her şey çalışıyor" demiyor. Diyebildikleri
 * tam olarak şunlar — ve dürüst olan da bu.
 */

const BLOK = "#editor > [data-kalem-id]";

test.beforeEach(async ({ page }) => {
	await page.goto("/editor.html");
	await expect(page.locator(BLOK).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Kabul: belge yazılabiliyor
// ---------------------------------------------------------------------------

test("dokunarak odaklanılıyor ve yazılabiliyor", async ({ page }) => {
	/*
	 * Kabul kriteri bu. `tap()` gerçek bir dokunmatik olay dizisi
	 * üretiyor (`pointerdown` → `touchstart` → … → `click`), fare
	 * tıklaması değil.
	 */
	const ilk = page.locator(BLOK).first();
	await ilk.tap();

	await expect(ilk).toBeFocused();
	await page.keyboard.press("End");
	await page.keyboard.type(" ışıkla İŞIK");

	await expect(page.locator("#cikti")).toContainText("ışıkla İŞIK");
});

test("Enter yeni blok açıyor", async ({ page }) => {
	const ilk = page.locator(BLOK).first();
	await ilk.tap();
	await page.keyboard.press("End");

	const once = await page.locator(BLOK).count();
	await page.keyboard.press("Enter");
	await page.keyboard.type("Mobilde yazılan paragraf.");

	expect(await page.locator(BLOK).count()).toBe(once + 1);
	await expect(page.locator("#cikti")).toContainText("Mobilde yazılan paragraf.");
});

test("Backspace blok başında birleştiriyor", async ({ page }) => {
	/*
	 * Kısıtlar sayfası "Enter ile yeni blok, Backspace ile birleştirme"
	 * diyor; Enter'ı yukarıdaki test tutuyor, bu da ikincisini. Mobilde
	 * ayrıca önemli: blok silmenin tutamaçsız tek yolu bu.
	 */
	/*
	 * Belge burada kurulmuş, örnek belgeden alınmamış.
	 *
	 * İlk yazdığımda örnek belgenin ikinci bloğunu kullanıyordum ve test
	 * iki mobil projede de düştü: o paragraf dar ekranda **iki satıra
	 * sarıyor** ve `Home` bloğun değil, görsel satırın başına gidiyor.
	 * Kısa paragraflarla sarma yok, ölçülen şey de birleştirmenin kendisi.
	 */
	await page.evaluate(() => window.kalem.editor.setValue("abc\n\ndef\n"));
	const bloklar = page.locator(BLOK);
	await expect(bloklar).toHaveCount(2);

	await bloklar.nth(1).tap();
	await page.keyboard.press("Home");
	await page.keyboard.press("Backspace");

	await expect(bloklar).toHaveCount(1);
	await expect(page.locator("#cikti")).toHaveText("abcdef\n");
});

test("başka bir bloğa dokunmak imleci oraya taşıyor", async ({ page }) => {
	const bloklar = page.locator(BLOK);
	await bloklar.first().tap();
	await bloklar.nth(2).tap();

	await expect(bloklar.nth(2)).toBeFocused();
	await page.keyboard.press("End");
	await page.keyboard.type("!!");
	await expect(bloklar.nth(2)).toContainText("!!");
});

test("giriş kuralları dokunmatikte de çalışıyor", async ({ page }) => {
	// Mobilde araç çubuğu dar; başlık yapmanın asıl yolu `# ` yazmak.
	const ilk = page.locator(BLOK).first();
	await ilk.tap();
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await page.keyboard.type("## Mobil başlık");

	await expect(page.locator("#cikti")).toContainText("## Mobil başlık");
	await expect(page.locator("#editor h2")).toHaveText("Mobil başlık");
});

// ---------------------------------------------------------------------------
// Düzen bozulmuyor
// ---------------------------------------------------------------------------

test("sayfa yatay kaydırma üretmiyor", async ({ page }) => {
	/*
	 * Mobilde en sık görülen bozukluk bu: bir eleman görünüm alanından
	 * taşıyor ve sayfa yana kayıyor. Uzun bir kod bloğu ve uzun bir
	 * bağlantı ekleyerek zorlanıyor.
	 */
	await page.evaluate(() => {
		const uzun = "x".repeat(300);
		window.kalem.editor.setValue(
			`Başlangıç\n\n\`\`\`\n${uzun}\n\`\`\`\n\n[${uzun}](https://ornek.com/${uzun})\n`,
		);
	});

	const tasma = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
	expect(tasma).toBe(false);
});

test("sabit araç çubuğu düğmeleri dokunulabilir boyutta", async ({ page }) => {
	/*
	 * WCAG 2.2 "Target Size (Minimum)" 24×24 CSS pikseli istiyor. Ölçüm
	 * gerçek kutulardan alınıyor: CSS'te verilen boyut, dar ekranda
	 * daralan bir kapsayıcı yüzünden küçülebilir.
	 */
	await page.locator("#aracCubugu").selectOption("fixed");
	await expect(page.locator(".kalem-toolbar")).toBeVisible();

	const dugmeler = page.locator(".kalem-toolbar-button");
	const sayi = await dugmeler.count();
	expect(sayi).toBeGreaterThan(3);

	for (let i = 0; i < sayi; i++) {
		const kutu = await dugmeler.nth(i).boundingBox();
		if (kutu === null) continue; // taşan grup gizlenmiş olabilir
		expect(kutu.width, `düğme ${i} genişliği`).toBeGreaterThanOrEqual(24);
		expect(kutu.height, `düğme ${i} yüksekliği`).toBeGreaterThanOrEqual(24);
	}
});

test("araç çubuğu açıkken editör yine de yazılabilir genişlikte", async ({ page }) => {
	await page.locator("#aracCubugu").selectOption("fixed");
	await expect(page.locator(".kalem-toolbar")).toBeVisible();

	const kutu = await page.locator("#editor").boundingBox();
	// 393 px'lik en dar hedefte bile metin için anlamlı bir alan kalmalı.
	expect(kutu?.width ?? 0).toBeGreaterThan(250);
});

// ---------------------------------------------------------------------------
// Bilinen kısıtlar — burada da sabitleniyor
// ---------------------------------------------------------------------------

test("blok tutamacı ya solda duruyor ya hiç çıkmıyor", async ({ page }) => {
	/*
	 * Tutamaç bloğun **soluna**, kenar boşluğuna konumlanıyor. Boşluk
	 * yetmiyorsa kütüphane onu hiç göstermiyor: metnin üstüne binmek
	 * dokunmaları ve sürükleyerek seçimi yutardı.
	 *
	 * ## İlk yazdığım test yanlış varsayıyordu
	 *
	 * "Mobilde tutamaç çıkmaz" diye yazmıştım. Ölçüm aksini gösterdi:
	 * 393 px'lik iPhone'da çıkmıyor ama 412 px'lik Pixel'de **çıkıyor** —
	 * çünkü kural ekranın mobil olması değil, solda yer kalıp kalmaması.
	 * Test artık kuralın kendisini tutuyor.
	 */
	const blok = page.locator(BLOK).first();
	await blok.tap();
	await blok.hover();

	const tutamac = page.locator(".kalem-handle");
	if (!(await tutamac.isVisible())) return; // yer yok: geçerli sonuç

	const t = await tutamac.boundingBox();
	const b = await blok.boundingBox();
	expect(t, "tutamaç görünür ama kutusu yok").not.toBeNull();
	expect(b).not.toBeNull();
	// Metnin üstüne binmiyor.
	expect((t?.x ?? 0) + (t?.width ?? 0)).toBeLessThanOrEqual((b?.x ?? 0) + 1);
	expect(t?.x ?? -1).toBeGreaterThanOrEqual(0);
});

test("slash menüsü klavyeden açılıyor", async ({ page }) => {
	/*
	 * Blok tutamacı dar ekranda yok, ama blok türü değiştirmenin başka
	 * yolu var: slash menüsü ve giriş kuralları. Kısıtlar sayfası bunu
	 * "yedek yol" olarak söz veriyor, test de onu tutuyor.
	 */
	const ilk = page.locator(BLOK).first();
	await ilk.tap();
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await page.keyboard.type("/");

	await expect(page.locator(".kalem-slash")).toBeVisible();
	await page.keyboard.press("Escape");
});

test("konsola hata düşmüyor", async ({ page }) => {
	const hatalar: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error") hatalar.push(m.text());
	});
	page.on("pageerror", (e) => hatalar.push(e.message));

	const ilk = page.locator(BLOK).first();
	await ilk.tap();
	await page.keyboard.press("End");
	await page.keyboard.type("deneme");
	await page.locator("#aracCubugu").selectOption("fixed");

	expect(hatalar).toEqual([]);
});
