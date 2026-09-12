import { expect, test } from "@playwright/test";

declare global {
	interface Window {
		kalemKayit?: { ilk: boolean; ikinci: boolean };
	}
}

/** Elemanın `value` özelliğini okuyan yardımcı — `HTMLElement`te yok. */
type Kalem = HTMLElement & { value: string };

/**
 * `<kalem-editor>` — Custom Element  (İş listesi: F5-03)
 *
 * Üç motorda birden koşuyor: sarmalayıcının aksine burada ölçülen şey
 * **platform davranışı** — özel eleman yükselmesi, gölge kök, form
 * entegrasyonu. Bunların motorlar arası farkları gerçek.
 */

test.beforeEach(async ({ page }) => {
	await page.goto("/wc.html");
	await expect(page.locator("#isik h1")).toHaveText("Işık ve Gölge");
});

test("başlangıç metni elemanın içinden okunuyor, girinti sökülüyor", async ({ page }) => {
	// HTML'deki sekmeler sökülmeseydi Markdown bunu kod bloğu sayardı ve
	// belgenin tamamı tek bir <pre> olurdu.
	await expect(page.locator("#isik pre")).toHaveCount(0);
	await expect(page.locator("#isik li")).toHaveCount(2);
	await expect(page.locator("#isik strong")).toHaveText("özel eleman");
});

test("kayıt tekrarlanabilir", async ({ page }) => {
	// İkinci çağrının atması, aynı sayfada iki sürümü bulunan bir
	// uygulamayı açılışta düşürürdü.
	expect(await page.evaluate(() => window.kalemKayit)).toEqual({ ilk: true, ikinci: false });
});

test("değişiklik başına tek bir input olayı", async ({ page }) => {
	/*
	 * `contenteditable`ın kendi `input` olayı da elemanın dışına kabarıyor.
	 * Kesilmeseydi dinleyici her tuşta iki olay görürdü — ve ikisinden
	 * birinde `event.target` içerideki blok olurdu.
	 */
	await page.locator("#isik p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type("X");
	await expect(page.locator("#sayacInput")).toHaveText("1");
	await page.keyboard.type("Y");
	await expect(page.locator("#sayacInput")).toHaveText("2");
});

test("olay elemanın kendisinden geliyor", async ({ page }) => {
	// `event.target.value` — içerideki blok hedef olsaydı `undefined`.
	await page.locator("#isik p").first().click();
	await page.keyboard.type("Z");
	await expect(page.locator("#hedefDeger")).toContainText("karakter");
	await expect(page.locator("#cikti")).toContainText("Işık ve Gölge");
});

test("change yalnızca odak editörden çıkınca", async ({ page }) => {
	await page.locator("#isik p").first().click();
	await page.keyboard.type("A");
	// Bloklar arasında gezinmek odak değiştiriyor ama editörden çıkmıyor.
	await page.locator("#isik li").first().click();
	await page.keyboard.type("B");
	await expect(page.locator("#sayacChange")).toHaveText("0");

	await page.locator("#odak").focus();
	await expect(page.locator("#sayacChange")).toHaveText("1");
});

test("programla yazmak olay yaymıyor", async ({ page }) => {
	// Platform kuralı: `el.value = …` sessiz, yalnızca kullanıcı olay yayar.
	await page.evaluate(() => {
		(document.querySelector("kalem-editor") as HTMLElement & { value: string }).value =
			"# Başka belge";
	});
	await expect(page.locator("#isik h1")).toHaveText("Başka belge");
	await expect(page.locator("#sayacInput")).toHaveText("0");
});

test("readOnly özelliği editöre iniyor", async ({ page }) => {
	await page.getByLabel("salt okunur").check();
	await expect(page.locator("#isik > div")).toHaveAttribute("aria-readonly", "true");
	await page.getByLabel("salt okunur").uncheck();
	await expect(page.locator("#isik > div")).toHaveAttribute("aria-readonly", "false");
});

test("label özniteliği erişilebilir ada dönüşüyor", async ({ page }) => {
	// `exact` şart: varsayılan eşleşme alt dize ve sayfadaki üç editörün
	// adı da "…belge" ile bitiyor.
	await expect(page.getByRole("textbox", { name: "Belge", exact: true })).toHaveCount(1);
	await expect(page.getByRole("textbox", { name: "Gölgeli belge", exact: true })).toHaveCount(1);
});

test("elemanı taşımak içeriği ve editörü koruyor", async ({ page }) => {
	await page.locator("#isik p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" TAŞIMADAN ÖNCE");

	await page.locator("#tasi").click();
	await expect(page.locator("#liman > #isik")).toHaveCount(1);
	// Söküm hemen yapılsaydı editör yıkılır ve `kalem-ready` bir kez daha
	// yayılırdı; geçmiş ve imleç de giderdi.
	await expect(page.locator("#sayacReady")).toHaveText("1");
	await expect(page.locator("#isik p").first()).toContainText("TAŞIMADAN ÖNCE");

	// Taşındıktan sonra da yazılabiliyor.
	await page.locator("#isik p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" SONRA");
	await expect(page.locator("#cikti")).toContainText("SONRA");
});

test.describe("gölge kök", () => {
	test("açık kök kuruluyor", async ({ page }) => {
		await expect(page.locator("#golgeDurum")).toHaveText("açık");
		await expect(page.locator("#golge h2")).toHaveText("Gölge kök");
	});

	test("sayfa CSS'i gölgeye girmiyor", async ({ page }) => {
		const renk = () =>
			page
				.locator("#golge p")
				.first()
				.evaluate((el) => getComputedStyle(el).color);
		const once = await renk();
		await page.locator("#sayfaKurali").click();
		expect(await renk()).toBe(once);
		// Aynı kural ışık DOM'daki editöre **giriyor** — karşılaştırma
		// olmadan test, kuralın hiç uygulanmadığını da kanıtlamış olurdu.
		expect(
			await page
				.locator("#isik p")
				.first()
				.evaluate((el) => getComputedStyle(el).color),
		).toBe("rgb(255, 0, 0)");
	});

	test("gölgedeki editör de yazılabiliyor", async ({ page }) => {
		await page.locator("#golge p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.type(" EK");
		expect(await page.locator("#golge").evaluate((el) => (el as Kalem).value)).toContain(" EK");
	});
});

test.describe("form entegrasyonu", () => {
	test("eleman forma bağlanıyor", async ({ page }) => {
		await expect(page.locator("#formAdi")).toHaveText("bağlı");
	});

	test("boş ve required ise geçersiz, mesaj belge dilinde", async ({ page }) => {
		await expect(page.locator("#gecerlilik")).toHaveText("Bu alan boş bırakılamaz.");
	});

	test("metin girilince geçerli oluyor ve FormData'ya giriyor", async ({ page }) => {
		// `focus()` elemanda ezilmiş: odağı ilk düzenlenebilir bloğa veriyor.
		await page.locator("#alan").evaluate((el) => el.focus());
		await page.keyboard.type("Merhaba");
		await expect(page.locator("#gecerlilik")).toHaveText("geçerli");

		await page.getByRole("button", { name: "Gönder" }).click();
		await expect(page.locator("#gonderilen")).toHaveText('"Merhaba"');
	});

	test("form sıfırlaması başlangıç değerine dönüyor", async ({ page }) => {
		await page.locator("#alan").evaluate((el) => el.focus());
		await page.keyboard.type("Geçici");
		await expect(page.locator("#gecerlilik")).toHaveText("geçerli");

		await page.getByRole("button", { name: "Sıfırla" }).click();
		// `defaultValue` boştu; sıfırlama sonrası yeniden geçersiz.
		await expect(page.locator("#gecerlilik")).toHaveText("Bu alan boş bırakılamaz.");
		expect(await page.locator("#alan").evaluate((el) => (el as Kalem).value)).toBe("");
	});
});
