import { expect, test } from "@playwright/test";

/**
 * `@kalem-editor/plugin-autosave`  (İş listesi: F4-07)
 *
 * Durum makinesinin tamamı birim testleriyle sabit (`plugin.test.ts`);
 * burada ölçülen, gerçek editörde yazmanın kaydı tetiklediği, göstergenin
 * güncellendiği ve kurtarma kaydının gerçekten `localStorage`a düştüğü.
 */

declare global {
	interface Window {
		kalem: {
			editor: { getValue(): string; setValue(md: string): void };
			kayitEklentisi: {
				state(): string;
				saveNow(): Promise<void>;
				recovered(): string | null;
				clearRecovered(): void;
			};
		};
		kalemKayit: { gecikme: number; hata: boolean; sonMetin: string | null };
	}
}

const gosterge = (page: import("@playwright/test").Page) => page.locator(".kalem-autosave");

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
	await page.evaluate(() => {
		window.kalem.kayitEklentisi.clearRecovered();
		window.kalemKayit.hata = false;
		window.kalemKayit.sonMetin = null;
	});
});

test("açılışta kaydetmiyor", async ({ page }) => {
	// Açılan her editörün sunucuya gereksiz bir yazma yapması.
	expect(await page.evaluate(() => window.kalemKayit.sonMetin)).toBeNull();
	expect(await page.evaluate(() => window.kalem.kayitEklentisi.state())).toBe("idle");
});

test("yazınca kaydediyor ve gösterge güncelleniyor", async ({ page }) => {
	// Sahte sunucu yavaşlatılıyor: "kaydediliyor" **geçici** bir durum ve
	// hızlı bir kayıtta iki yoklama arasında kaçırılabiliyor. Ölçülmek
	// istenen şey durumun görünmesi, ne kadar sürdüğü değil.
	await page.evaluate(() => {
		window.kalemKayit.gecikme = 600;
	});

	await page.locator("#editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" değişiklik");

	await expect(gosterge(page)).toHaveText("Kaydediliyor…");
	await expect(gosterge(page)).toHaveText("Kaydedildi");
	expect(await page.evaluate(() => window.kalemKayit.sonMetin)).toContain("değişiklik");
});

test("yazarken önce kaydedilmemiş durumu görünüyor", async ({ page }) => {
	await page.evaluate(() => {
		window.kalemKayit.gecikme = 500;
	});
	await page.locator("#editor > p").first().click();
	await page.keyboard.type("x");
	await expect(gosterge(page)).toHaveText("Kaydedilmemiş değişiklik");
});

test("hata durumunda kurtarma kaydı yazılıyor", async ({ page }) => {
	await page.evaluate(() => {
		window.kalemKayit.hata = true;
	});
	await page.locator("#editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" kurtarılacak");

	await expect(gosterge(page)).toHaveText("Kaydedilemedi");
	const taslak = await page.evaluate(() => window.kalem.kayitEklentisi.recovered());
	expect(taslak).toContain("kurtarılacak");
	// Gerçekten `localStorage`da: sayfa kapanıp açılsa da orada olacak.
	const depoda = await page.evaluate(() => localStorage.getItem("kalem:demo:taslak"));
	expect(depoda).toContain("kurtarılacak");
});

test("başarılı kayıt kurtarma kaydını siliyor", async ({ page }) => {
	await page.evaluate(() => {
		window.kalemKayit.hata = true;
	});
	await page.locator("#editor > p").first().click();
	await page.keyboard.type("a");
	await expect(gosterge(page)).toHaveText("Kaydedilemedi");

	await page.evaluate(() => {
		window.kalemKayit.hata = false;
	});
	await page.keyboard.type("b");
	await expect(gosterge(page)).toHaveText("Kaydedildi");
	expect(await page.evaluate(() => window.kalem.kayitEklentisi.recovered())).toBeNull();
});

test("kurtarma kaydı sayfa yenilenince duruyor", async ({ page }) => {
	await page.evaluate(() => {
		window.kalemKayit.hata = true;
	});
	await page.locator("#editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(" kalıcı");
	await expect(gosterge(page)).toHaveText("Kaydedilemedi");

	await page.reload();
	await page.waitForFunction(() => "kalem" in window);
	// Otomatik uygulanmıyor: belge açılıştaki hâlinde, taslak duruyor.
	expect(await page.evaluate(() => window.kalem.editor.getValue())).not.toContain("kalıcı");
	expect(await page.evaluate(() => window.kalem.kayitEklentisi.recovered())).toContain("kalıcı");
	await page.evaluate(() => window.kalem.kayitEklentisi.clearRecovered());
});

test("art arda yazmak tek kayda düşüyor", async ({ page }) => {
	const istekler: number[] = [];
	await page.exposeFunction("kalemKayitSayaci", () => {
		istekler.push(Date.now());
	});
	await page.evaluate(() => {
		const ayar = window.kalemKayit;
		Object.defineProperty(ayar, "sonMetin", {
			set(v: string) {
				(window as unknown as { kalemKayitSayaci: () => void }).kalemKayitSayaci();
				(this as { _v?: string })._v = v;
			},
			get() {
				return (this as { _v?: string })._v ?? null;
			},
			configurable: true,
		});
	});

	await page.locator("#editor > p").first().click();
	await page.keyboard.type("bir");
	await page.keyboard.type("iki");
	await page.keyboard.type("üç");
	await expect(gosterge(page)).toHaveText("Kaydedildi");
	// Gecikme (400 ms) hızlı yazmayı tek kayda topluyor.
	expect(istekler.length).toBe(1);
});

test("gösterge canlı bölge", async ({ page }) => {
	// Kaydetme durumu seyrek değişiyor ve kullanıcının bilmesi gereken
	// bir şey — kelime sayacının tersine (F4-05).
	await expect(gosterge(page)).toHaveAttribute("role", "status");
});
