import { expect, test } from "@playwright/test";

/**
 * `@kalem/ui` — balon araç çubuğu  (İş listesi: F3-01, F3-11)
 *
 * Araç çubuğunun tamamı seçim ve geometri davranışı; ikisi de gerçek
 * tarayıcı gerektiriyor. Konumlandırma hesabının saf kısmı birim
 * testinde (`floating.test.ts`), buradaki testler zincirin uçtan uca
 * kapandığını ölçüyor.
 */

declare global {
	interface Window {
		kalem: {
			editor: {
				setValue(markdown: string): void;
				getValue(): string;
				setReadOnly(v: boolean): void;
			};
			ui: { destroy(): void; labels: Record<string, string> };
		};
	}
}

const BALON = ".kalem-bubble";

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (hata) => hatalar.push(String(hata)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
});

/** Bir paragrafın tamamını seçer. */
async function secimYap(page: import("@playwright/test").Page, metin = "seçili metin") {
	await page.evaluate((m) => window.kalem.editor.setValue(`${m}\n`), metin);
	await page.locator("#editor > p").first().click();
	await page.keyboard.press("ControlOrMeta+a");
}

test.describe("görünürlük", () => {
	test("başlangıçta gizli", async ({ page }) => {
		await expect(page.locator(BALON)).toBeHidden();
	});

	test("metin seçilince beliriyor", async ({ page }) => {
		await secimYap(page);
		await expect(page.locator(BALON)).toBeVisible();
	});

	test("seçim kalkınca kayboluyor", async ({ page }) => {
		await secimYap(page);
		await expect(page.locator(BALON)).toBeVisible();
		await page.keyboard.press("ArrowRight");
		await expect(page.locator(BALON)).toBeHidden();
	});

	/** Bloklar arası seçimde biçimlendirilecek metin yok. */
	test("bloklar arası seçimde gizli", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir\n\niki\n\nüç\n"));
		const bloklar = page.locator("#editor > [data-kalem-id]");
		const bas = await bloklar.nth(0).boundingBox();
		const bit = await bloklar.nth(2).boundingBox();
		if (bas === null || bit === null) throw new Error("blok kutusu ölçülemedi");
		await page.mouse.move(bas.x + 6, bas.y + bas.height / 2);
		await page.mouse.down();
		await page.mouse.move(bit.x + bit.width - 6, bit.y + bit.height / 2, { steps: 12 });
		await page.mouse.up();

		await expect(page.locator("#editor .kalem-selected")).toHaveCount(3);
		await expect(page.locator(BALON)).toBeHidden();
	});

	test("salt okunur modda gizli", async ({ page }) => {
		await page.locator("#saltOkunur").check();
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+a");
		await expect(page.locator(BALON)).toBeHidden();
	});
});

test.describe("konumlandırma", () => {
	test("seçimin üstünde beliriyor", async ({ page }) => {
		await secimYap(page);
		const balon = await page.locator(BALON).boundingBox();
		const secim = await page.evaluate(() => {
			const r = window.getSelection()?.getRangeAt(0).getClientRects().item(0);
			return r === null || r === undefined ? null : { top: r.top, bottom: r.bottom };
		});
		if (balon === null || secim === null) throw new Error("ölçülemedi");
		expect(balon.y + balon.height).toBeLessThanOrEqual(secim.top);
		await expect(page.locator(BALON)).toHaveAttribute("data-placement", "top");
	});

	test("görünür alanın dışına taşmıyor", async ({ page }) => {
		await secimYap(page);
		const balon = await page.locator(BALON).boundingBox();
		const genislik = await page.evaluate(() => window.innerWidth);
		if (balon === null) throw new Error("ölçülemedi");
		expect(balon.x).toBeGreaterThanOrEqual(0);
		expect(balon.x + balon.width).toBeLessThanOrEqual(genislik);
	});
});

test.describe("biçimlendirme", () => {
	test("kalın düğmesi biçim uyguluyor", async ({ page }) => {
		await secimYap(page, "kalın olacak");
		await page.locator(`${BALON} button`).first().click();
		await expect(page.locator("#cikti")).toHaveText("**kalın olacak**\n");
	});

	test("basılı durum seçime göre yansıyor", async ({ page }) => {
		await secimYap(page, "abc");
		const kalinDugme = page.locator(`${BALON} button`).first();
		await expect(kalinDugme).toHaveAttribute("aria-pressed", "false");
		await kalinDugme.click();
		await expect(kalinDugme).toHaveAttribute("aria-pressed", "true");
	});

	/** Düğmeye basmak seçimi düşürürse uygulanacak biçim için seçim kalmaz. */
	test("düğmeye basmak seçimi düşürmüyor", async ({ page }) => {
		await secimYap(page, "abc");
		await page.locator(`${BALON} button`).first().click();
		const secili = await page.evaluate(() => window.getSelection()?.toString() ?? "");
		expect(secili).toBe("abc");
	});

	test("tekrar basınca biçim kalkıyor", async ({ page }) => {
		await secimYap(page, "abc");
		const kalinDugme = page.locator(`${BALON} button`).first();
		await kalinDugme.click();
		await kalinDugme.click();
		await expect(page.locator("#cikti")).toHaveText("abc\n");
	});

	test("blok türü listesi başlığa çeviriyor", async ({ page }) => {
		await secimYap(page, "başlık olacak");
		await page.locator(`${BALON} select`).selectOption("heading-2");
		await expect(page.locator("#editor > h2")).toHaveText("başlık olacak");
	});

	test("blok türü listesi mevcut türü gösteriyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("## Başlık\n"));
		await page.locator("#editor > h2").click();
		await page.keyboard.press("ControlOrMeta+a");
		await expect(page.locator(`${BALON} select`)).toHaveValue("heading-2");
	});
});

test.describe("erişilebilirlik", () => {
	test("araç çubuğu olarak duyuruluyor", async ({ page }) => {
		await secimYap(page);
		await expect(page.locator(BALON)).toHaveAttribute("role", "toolbar");
		await expect(page.locator(BALON)).toHaveAttribute("aria-label", /.+/);
	});

	test("her düğmenin erişilebilir adı var", async ({ page }) => {
		await secimYap(page);
		const adlar = await page.evaluate(() =>
			Array.from(document.querySelectorAll(".kalem-bubble button")).map((b) =>
				b.getAttribute("aria-label"),
			),
		);
		expect(adlar.length).toBeGreaterThan(0);
		for (const ad of adlar) expect(ad).toBeTruthy();
	});

	test("ok tuşlarıyla düğmeler arasında geziniliyor", async ({ page }) => {
		await secimYap(page);
		await page.locator(`${BALON} button`).first().focus();
		await page.keyboard.press("ArrowRight");
		const odakEtiketi = await page.evaluate(
			() => document.activeElement?.getAttribute("aria-label") ?? "",
		);
		const ikinciEtiket = await page.locator(`${BALON} button`).nth(1).getAttribute("aria-label");
		expect(odakEtiketi).toBe(ikinciEtiket);
	});

	/** Belge `lang="tr"`; metinler Türkçe gelmeli. */
	test("metinler belge diline göre seçiliyor", async ({ page }) => {
		const etiket = await page.evaluate(() => window.kalem.ui.labels.bold);
		expect(etiket).toBe("Kalın");
	});
});

test.describe("yaşam döngüsü", () => {
	test("destroy araç çubuğunu kaldırıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.ui.destroy());
		await expect(page.locator(BALON)).toHaveCount(0);
	});
});

/**
 * Bağlantı düzenleme akışı  (İş listesi: F3-02)
 *
 * Üç giriş yolu var (araç çubuğu düğmesi, Ctrl+K, bağlantıya tıklamak) ve
 * üçü de aynı popover'ı açıyor; testler üçünü de ayrı ayrı ölçüyor.
 */
const POPOVER = ".kalem-link-popover";

test.describe("bağlantı akışı", () => {
	test("Ctrl+K popover'ı açıyor", async ({ page }) => {
		await secimYap(page, "bağlanacak");
		await page.keyboard.press("ControlOrMeta+k");
		await expect(page.locator(POPOVER)).toBeVisible();
	});

	test("araç çubuğu düğmesi de açıyor", async ({ page }) => {
		await secimYap(page, "bağlanacak");
		await page.locator(`${BALON} button`).nth(4).click();
		await expect(page.locator(POPOVER)).toBeVisible();
	});

	test("adres girip Enter'a basmak bağlantı kuruyor", async ({ page }) => {
		await secimYap(page, "bağlanacak");
		await page.keyboard.press("ControlOrMeta+k");
		await page.locator(".kalem-link-input").fill("ornek.com");
		await page.keyboard.press("Enter");
		await expect(page.locator("#cikti")).toHaveText("[bağlanacak](https://ornek.com)\n");
		await expect(page.locator(POPOVER)).toBeHidden();
	});

	test("şemasız adrese https ekleniyor", async ({ page }) => {
		await secimYap(page, "abc");
		await page.keyboard.press("ControlOrMeta+k");
		await page.locator(".kalem-link-input").fill("ornek.com/yol");
		await page.keyboard.press("Enter");
		await expect(page.locator("#cikti")).toContainText("https://ornek.com/yol");
	});

	/** Güvenlik kararı çekirdeğin beyaz listesinden geliyor. */
	test("javascript: adresi reddediliyor ve uyarı gösteriliyor", async ({ page }) => {
		await secimYap(page, "abc");
		await page.keyboard.press("ControlOrMeta+k");
		await page.locator(".kalem-link-input").fill("javascript:alert(1)");
		await page.keyboard.press("Enter");
		await expect(page.locator(".kalem-link-error")).toBeVisible();
		await expect(page.locator(".kalem-link-input")).toHaveAttribute("aria-invalid", "true");
		// Bağlantı kurulmamalı — sessizce `#`e çevirmek kullanıcıya
		// çalıştığını düşündürürdü.
		await expect(page.locator("#cikti")).toHaveText("abc\n");
	});

	test("Escape kapatıyor, bağlantı kurulmuyor", async ({ page }) => {
		await secimYap(page, "abc");
		await page.keyboard.press("ControlOrMeta+k");
		await page.locator(".kalem-link-input").fill("ornek.com");
		await page.keyboard.press("Escape");
		await expect(page.locator(POPOVER)).toBeHidden();
		await expect(page.locator("#cikti")).toHaveText("abc\n");
	});

	test("var olan bağlantıya tıklamak düzenleme açıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("[bağ](https://eski.com)\n"));
		await page.locator("#editor a").click();
		await expect(page.locator(POPOVER)).toBeVisible();
		await expect(page.locator(".kalem-link-input")).toHaveValue("https://eski.com");
	});

	test("var olan bağlantı seçim yapmadan düzenlenebiliyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("[bağ](https://eski.com)\n"));
		await page.locator("#editor a").click();
		await page.locator(".kalem-link-input").fill("https://yeni.com");
		await page.keyboard.press("Enter");
		await expect(page.locator("#cikti")).toHaveText("[bağ](https://yeni.com)\n");
	});

	test("kaldır düğmesi bağlantıyı söküyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("[bağ](https://eski.com)\n"));
		await page.locator("#editor a").click();
		await page.locator(".kalem-link-button").last().click();
		await expect(page.locator("#cikti")).toHaveText("bağ\n");
	});

	/**
	 * F3-02'nin kabul kriteri.
	 *
	 * Firefox sentetik (güvenilmeyen) bir `paste` olayında
	 * `clipboardData.getData`'yı boş döndürüyor — kopyalama tarafında da aynı
	 * kısıtla karşılaşmıştık (F2-11). Gerçek pano izin gerektiriyor ve o izin
	 * yalnızca Chromium'da veriliyor. Ölçülemeyen şey davranış değil,
	 * Firefox'ta sentetik olayın okunabilirliği.
	 */
	test("URL yapıştırınca seçili metin bağlantılanıyor", async ({ page, browserName }) => {
		test.skip(browserName === "firefox", "Firefox sentetik paste verisini okutmuyor");
		await secimYap(page, "seçili metin");
		await page.evaluate(() => {
			const veri = new DataTransfer();
			veri.setData("text/plain", "https://ornek.com");
			document
				.getElementById("editor")
				?.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: veri, bubbles: true, cancelable: true }),
				);
		});
		await expect(page.locator("#cikti")).toHaveText("[seçili metin](https://ornek.com)\n");
	});

	test("düz metin yapıştırmak bağlantı kurmuyor", async ({ page }) => {
		await secimYap(page, "abc");
		await page.evaluate(() => {
			const veri = new DataTransfer();
			veri.setData("text/plain", "sadece metin");
			document
				.getElementById("editor")
				?.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: veri, bubbles: true, cancelable: true }),
				);
		});
		await expect(page.locator("#cikti")).not.toContainText("](");
	});

	test("popover dialog olarak duyuruluyor", async ({ page }) => {
		await secimYap(page, "abc");
		await page.keyboard.press("ControlOrMeta+k");
		await expect(page.locator(POPOVER)).toHaveAttribute("role", "dialog");
		await expect(page.locator(".kalem-link-input")).toHaveAttribute("aria-label", /.+/);
	});
});
