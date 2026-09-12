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
			mountUi: (el: unknown, options?: unknown) => { destroy(): void };
			ui: {
				destroy(): void;
				labels: Record<string, string>;
				slashMenu: { register(item: unknown): void } | null;
			};
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
	/*
	 * Ölçmeden önce görünürlük bekleniyor.
	 *
	 * `boundingBox()` gizli elemanda `null` dönüyor ve balon seçimden bir
	 * kare sonra beliriyor. Paralel yük altında bu fark testi rastgele
	 * kırmızıya çeviriyordu — suite büyüdükçe daha sık.
	 */
	test("seçimin üstünde beliriyor", async ({ page }) => {
		await secimYap(page);
		await expect(page.locator(BALON)).toBeVisible();
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
		await expect(page.locator(BALON)).toBeVisible();
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

/**
 * Yer tutucu  (İş listesi: F3-08)
 *
 * F3-08'in açık şartı: "ipucu odaklanınca kaybolmuyor, yazınca kayboluyor".
 * Odakta gizlemek, kullanıcı tıklar tıklamaz ipucunu kaybettiriyor — oysa
 * okumaya en çok o an ihtiyacı var.
 */
test.describe("yer tutucu", () => {
	/** `::before` içeriği DOM'da yok; hesaplanmış stilden okunuyor. */
	async function ipucu(page: import("@playwright/test").Page) {
		return page.evaluate(() => {
			const p = document.querySelector("#editor > p");
			if (p === null) return "";
			return getComputedStyle(p, "::before").content;
		});
	}

	test("boş belgede görünüyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue(""));
		await expect(page.locator("#editor")).toHaveClass(/kalem-empty/);
		expect(await ipucu(page)).toContain("komut");
	});

	test("odaklanınca kaybolmuyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue(""));
		await page.locator("#editor > p").click();
		await expect(page.locator("#editor")).toHaveClass(/kalem-empty/);
		expect(await ipucu(page)).toContain("komut");
	});

	test("yazınca kayboluyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue(""));
		await page.locator("#editor > p").click();
		await page.keyboard.type("a");
		await expect(page.locator("#editor")).not.toHaveClass(/kalem-empty/);
	});

	test("silince geri geliyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue(""));
		await page.locator("#editor > p").click();
		await page.keyboard.type("a");
		await page.keyboard.press("Backspace");
		await expect(page.locator("#editor")).toHaveClass(/kalem-empty/);
	});

	/** İki boş paragraf varsa kullanıcı Enter'a basmıştır; ipucu oraya ait değil. */
	test("dolu belgede görünmüyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("metin\n"));
		await expect(page.locator("#editor")).not.toHaveClass(/kalem-empty/);
	});

	/** İpucu metni DOM'da olmadığı için modele de giremez. */
	test("ipucu içeriğe karışmıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue(""));
		await page.locator("#editor > p").click();
		await page.keyboard.type("x");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("x");
	});
});

/**
 * Slash menü  (İş listesi: F3-03)
 *
 * Arama katlamasının saf kısmı birim testinde (`search.test.ts`);
 * buradaki testler `/` yazmaktan bloğun dönüşmesine kadar olan zinciri
 * ölçüyor.
 */
const SLASH = ".kalem-slash";

test.describe("slash menü", () => {
	async function bosBlok(page: import("@playwright/test").Page) {
		await page.evaluate(() => window.kalem.editor.setValue(""));
		await page.locator("#editor > p").first().click();
	}

	test("`/` yazınca açılıyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/");
		await expect(page.locator(SLASH)).toBeVisible();
		await expect(page.locator(".kalem-slash-item")).not.toHaveCount(0);
	});

	/** `and/or` yazan kullanıcının karşısına menü çıkmamalı. */
	test("kelime ortasındaki `/` açmıyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("and/");
		await expect(page.locator(SLASH)).toBeHidden();
	});

	/** F3-03'ün kabul kriteri. */
	test("`/bas` yazınca Başlık 1 filtreleniyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/bas");
		await expect(page.locator(".kalem-slash-item").first()).toContainText("Başlık 1");
	});

	/** F3-03 locale kriteri: `/baş` ve `/BAŞ` aynı sonucu veriyor. */
	test("büyük ve küçük sorgu aynı sonucu veriyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/baş");
		const kucuk = await page.locator(".kalem-slash-item").allTextContents();
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.type("/BAŞ");
		const buyuk = await page.locator(".kalem-slash-item").allTextContents();
		expect(buyuk).toEqual(kucuk);
	});

	test("Enter ile öğe ekleniyor ve `/sorgu` metni siliniyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/bas");
		await page.keyboard.press("Enter");
		await expect(page.locator("#editor > h1")).toHaveCount(1);
		// `/bas` metni belgede kalmamalı.
		expect(await page.evaluate(() => window.kalem.editor.getValue())).not.toContain("/bas");
	});

	test("seçilen öğeden sonra yazmaya devam edilebiliyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/bas");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Işık");
		await expect(page.locator("#editor > h1")).toHaveText("Işık");
	});

	/** Tek Ctrl+Z hem metni hem dönüşümü geri almalı. */
	test("tek Ctrl+Z ekleme işlemini geri alıyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/bas");
		await page.keyboard.press("Enter");
		await expect(page.locator("#editor > h1")).toHaveCount(1);
		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#editor > h1")).toHaveCount(0);
	});

	test("ok tuşlarıyla seçim değişiyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/");
		const ilk = await page.locator('.kalem-slash-item[aria-selected="true"]').textContent();
		await page.keyboard.press("ArrowDown");
		const ikinci = await page.locator('.kalem-slash-item[aria-selected="true"]').textContent();
		expect(ikinci).not.toBe(ilk);
	});

	test("Escape kapatıyor, metin kalıyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/bas");
		await page.keyboard.press("Escape");
		await expect(page.locator(SLASH)).toBeHidden();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toContain("/bas");
	});

	test("boşluk yazınca kapanıyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/bas ");
		await expect(page.locator(SLASH)).toBeHidden();
	});

	test("eşleşme yoksa boş durum gösteriliyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/zzzz");
		await expect(page.locator(".kalem-slash-empty")).toBeVisible();
	});

	test("liste öğesi de eklenebiliyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/madde");
		await page.keyboard.press("Enter");
		await page.keyboard.type("bir");
		await expect(page.locator("#cikti")).toHaveText("- bir");
	});

	test("listbox olarak duyuruluyor", async ({ page }) => {
		await bosBlok(page);
		await page.keyboard.type("/");
		await expect(page.locator(".kalem-slash-list")).toHaveAttribute("role", "listbox");
		// Odak editörde kalıyor; seçili öğe `aria-activedescendant` ile bildiriliyor.
		await expect(page.locator("#editor")).toHaveAttribute("aria-activedescendant", /kalem-slash-/);
	});

	test("eklentiler menüye öğe ekleyebiliyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalem.ui.slashMenu?.register({
				id: "test-oge",
				label: "İstatistik",
				group: "Test",
				glyph: "Σ",
				apply: (doc: unknown, caret: unknown) => ({ doc, caret }),
			});
		});
		await bosBlok(page);
		// F3-03 locale kriteri: `/ıst` ile "İstatistik" eşleşiyor.
		await page.keyboard.type("/ıst");
		await expect(page.locator(".kalem-slash-item").first()).toContainText("İstatistik");
	});
});

/**
 * Blok tutamacı ve sürükle-bırak  (İş listesi: F3-04)
 *
 * Sürüklemenin tamamı geometri: hangi bloğun ortasını geçtiğimiz, çizginin
 * nereye düştüğü, bırakınca ne olduğu. Hiçbiri birim testinde ölçülemiyor —
 * model katmanı (`block-edit.test.ts`) neyin taşındığını sabitliyor, burası
 * kullanıcının o taşımayı gerçekten tetikleyebildiğini.
 */

const TUTAMAC = ".kalem-handle";
const CIZGI = ".kalem-drop-line";

/** Beş paragraflık belge — F3-04'ün kabul senaryosunun sahnesi. */
async function besParagraf(page: import("@playwright/test").Page) {
	await page.evaluate(() => window.kalem.editor.setValue("bir\n\niki\n\nüç\n\ndört\n\nbeş\n"));
	return page.locator("#editor > [data-kalem-id]");
}

/**
 * Tutamacı `from` bloğundan tutup `to` bloğunun üst yarısına bırakır.
 *
 * `steps` şart: tek sıçrayışlı `mouse.move` bazı tarayıcılarda tek bir
 * `pointermove` üretiyor ve otomatik kaydırma yolu hiç çalışmıyor.
 */
async function surukle(
	page: import("@playwright/test").Page,
	kaynak: import("@playwright/test").Locator,
	hedefY: number,
) {
	const kutu = await kaynak.boundingBox();
	if (kutu === null) throw new Error("Kaynak bloğun kutusu yok");
	await page.mouse.move(kutu.x + 10, kutu.y + kutu.height / 2);
	await expect(page.locator(TUTAMAC)).toBeVisible();

	const tutamac = await page.locator(".kalem-handle-grip").boundingBox();
	if (tutamac === null) throw new Error("Tutamacın kutusu yok");
	await page.mouse.move(tutamac.x + tutamac.width / 2, tutamac.y + tutamac.height / 2);
	await page.mouse.down();
	await page.mouse.move(tutamac.x + tutamac.width / 2, hedefY, { steps: 8 });
	await page.mouse.up();
}

test.describe("blok tutamacı", () => {
	test("başlangıçta gizli", async ({ page }) => {
		await expect(page.locator(TUTAMAC)).toBeHidden();
	});

	test("blok üzerine gelince beliriyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		const kutu = await bloklar.nth(1).boundingBox();
		await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
		await expect(page.locator(TUTAMAC)).toBeVisible();
	});

	/** Tutamaç bloğun **solunda** durmalı; metnin üstünü kapatamaz. */
	test("bloğun soluna hizalanıyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		const blok = await bloklar.nth(1).boundingBox();
		await page.mouse.move(blok!.x + 10, blok!.y + blok!.height / 2);
		await expect(page.locator(TUTAMAC)).toBeVisible();
		const tutamac = await page.locator(TUTAMAC).boundingBox();
		expect(tutamac!.x + tutamac!.width).toBeLessThanOrEqual(blok!.x + 1);
	});

	test("salt okunur modda çıkmıyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		await page.evaluate(() => window.kalem.editor.setReadOnly(true));
		const kutu = await bloklar.nth(1).boundingBox();
		await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
		await expect(page.locator(TUTAMAC)).toBeHidden();
	});

	test("artı düğmesi altına paragraf ekliyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		const kutu = await bloklar.nth(0).boundingBox();
		await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
		await page.locator(".kalem-handle-add").click();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"bir\n\n\n\niki\n\nüç\n\ndört\n\nbeş\n",
		);
	});
});

test.describe("sürükle-bırak", () => {
	/**
	 * F3-04'ün kabul kriteri.
	 *
	 * "5 paragraflık dokümanda 3. paragraf 1. sıraya sürüklenebiliyor,
	 * undo ile geri alınıyor."
	 */
	test("3. paragraf 1. sıraya sürükleniyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		const ilk = await bloklar.nth(0).boundingBox();
		await surukle(page, bloklar.nth(2), ilk!.y + 2);

		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"üç\n\nbir\n\niki\n\ndört\n\nbeş\n",
		);
	});

	test("sürükleme tek Ctrl+Z ile geri alınıyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		const ilk = await bloklar.nth(0).boundingBox();
		await surukle(page, bloklar.nth(2), ilk!.y + 2);

		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.keyboard.press("ControlOrMeta+z");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"bir\n\niki\n\nüç\n\ndört\n\nbeş\n",
		);
	});

	test("sürükleme sırasında bırakma çizgisi görünüyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		const kutu = await bloklar.nth(2).boundingBox();
		await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
		await expect(page.locator(TUTAMAC)).toBeVisible();

		const tutamac = await page.locator(".kalem-handle-grip").boundingBox();
		await page.mouse.move(tutamac!.x + tutamac!.width / 2, tutamac!.y + tutamac!.height / 2);
		await page.mouse.down();
		const ilk = await bloklar.nth(0).boundingBox();
		await page.mouse.move(tutamac!.x + tutamac!.width / 2, ilk!.y + 2, { steps: 6 });

		await expect(page.locator(CIZGI)).toBeVisible();
		// Çizgi ilk bloğun üstünde: "buraya düşecek" demek.
		const cizgi = await page.locator(CIZGI).boundingBox();
		expect(Math.abs(cizgi!.y - ilk!.y)).toBeLessThan(4);

		await page.mouse.up();
		await expect(page.locator(CIZGI)).toBeHidden();
	});

	/** Bloğu bulunduğu yere bırakmak belgeyi değiştirmemeli. */
	test("yerinde bırakmak işlemsiz", async ({ page }) => {
		const bloklar = await besParagraf(page);
		const kendi = await bloklar.nth(2).boundingBox();
		await surukle(page, bloklar.nth(2), kendi!.y + 2);
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"bir\n\niki\n\nüç\n\ndört\n\nbeş\n",
		);
	});
});

test.describe("klavyeyle blok taşıma", () => {
	/**
	 * F3-10'un gereği: sürükle-bırak tek yol olamaz.
	 *
	 * Fare kullanamayan kullanıcı da aynı işi yapabilmeli.
	 */
	test("Ctrl+Shift+Yukarı bloğu yukarı taşıyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		await bloklar.nth(2).click();
		await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"bir\n\nüç\n\niki\n\ndört\n\nbeş\n",
		);
	});

	test("Ctrl+Shift+Aşağı bloğu aşağı taşıyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		await bloklar.nth(0).click();
		await page.keyboard.press("ControlOrMeta+Shift+ArrowDown");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"iki\n\nbir\n\nüç\n\ndört\n\nbeş\n",
		);
	});

	test("ilk blok yukarı gitmiyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		await bloklar.nth(0).click();
		await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"bir\n\niki\n\nüç\n\ndört\n\nbeş\n",
		);
	});

	/** Taşıma ekran okuyucuya duyuruluyor; ekranda görülen tek geri bildirim değil. */
	test("taşıma canlı bölgeye duyuruluyor", async ({ page }) => {
		const bloklar = await besParagraf(page);
		await bloklar.nth(2).click();
		await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
		await expect(page.locator(".kalem-live")).toHaveText("Blok yukarı taşındı");
	});
});

/**
 * Blok bağlam menüsü  (İş listesi: F3-05)
 *
 * Kabul kriteri tek cümle: *menü klavyeyle de kullanılabiliyor.* Bu yüzden
 * testlerin yarısı fareyle değil klavyeyle sürüyor — odağın nereye gittiği
 * burada davranışın kendisi.
 */

const MENU = ".kalem-block-menu";

/** Tutamacı açıp menüyü getirir. */
async function menuAc(page: import("@playwright/test").Page, index: number) {
	const bloklar = page.locator("#editor > [data-kalem-id]");
	const kutu = await bloklar.nth(index).boundingBox();
	if (kutu === null) throw new Error("blok kutusu ölçülemedi");
	await page.mouse.move(kutu.x + 10, kutu.y + kutu.height / 2);
	await expect(page.locator(TUTAMAC)).toBeVisible();
	await page.locator(".kalem-handle-grip").click();
	await expect(page.locator(MENU)).toBeVisible();
}

test.describe("blok menüsü", () => {
	test.beforeEach(async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir\n\niki\n\nüç\n"));
	});

	test("tutamaca tıklayınca açılıyor", async ({ page }) => {
		await menuAc(page, 1);
		await expect(page.locator(MENU)).toHaveAttribute("role", "menu");
	});

	test("çoğalt bloğun kopyasını ekliyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.locator(`${MENU} .kalem-menu-item`, { hasText: "Çoğalt" }).click();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"bir\n\niki\n\niki\n\nüç\n",
		);
	});

	test("sil bloğu kaldırıyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.locator(`${MENU} .kalem-menu-item`, { hasText: "Sil" }).click();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bir\n\nüç\n");
	});

	test("yukarı taşı bloğu bir sıra çıkarıyor", async ({ page }) => {
		await menuAc(page, 2);
		await page.locator(`${MENU} .kalem-menu-item`, { hasText: "Yukarı taşı" }).click();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bir\n\nüç\n\niki\n");
	});

	test("blok türü başlığa çeviriyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.locator(`${MENU} .kalem-menu-item`, { hasText: "Başlık 2" }).click();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bir\n\n## iki\n\nüç\n");
	});

	/** Menüden yapılan her işlem tek bir geçmiş adımı olmalı. */
	test("menü işlemi tek Ctrl+Z ile geri alınıyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.locator(`${MENU} .kalem-menu-item`, { hasText: "Çoğalt" }).click();
		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.keyboard.press("ControlOrMeta+z");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bir\n\niki\n\nüç\n");
	});

	test("dışarı tıklamak kapatıyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.locator("#cikti").click();
		await expect(page.locator(MENU)).toBeHidden();
	});

	test("salt okunur modda açılmıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setReadOnly(true));
		const kutu = await page.locator("#editor > [data-kalem-id]").nth(1).boundingBox();
		await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
		await expect(page.locator(TUTAMAC)).toBeHidden();
		await expect(page.locator(MENU)).toBeHidden();
	});

	/** Sürükleme de bir tıklamayla bitiyor; menü o tıklamada açılmamalı. */
	test("sürükledikten sonra menü açılmıyor", async ({ page }) => {
		const bloklar = page.locator("#editor > [data-kalem-id]");
		const ilk = await bloklar.nth(0).boundingBox();
		await surukle(page, bloklar.nth(2), ilk!.y + 2);
		await expect(page.locator(MENU)).toBeHidden();
	});
});

test.describe("blok menüsü — klavye", () => {
	test.beforeEach(async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir\n\niki\n\nüç\n"));
	});

	/** F3-05'in kabul kriteri: menü klavyeyle de kullanılabiliyor. */
	test("açılınca odak ilk öğede", async ({ page }) => {
		await menuAc(page, 1);
		await expect(page.locator(`${MENU} .kalem-menu-item`).first()).toBeFocused();
	});

	test("ok tuşlarıyla geziliyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.keyboard.press("ArrowDown");
		await expect(page.locator(`${MENU} .kalem-menu-item`).nth(1)).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(page.locator(`${MENU} .kalem-menu-item`).first()).toBeFocused();
	});

	/** Liste sarmalı: son öğeden aşağı ilk öğeye dönüyor. */
	test("gezinme başa sarıyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.keyboard.press("ArrowUp");
		await expect(page.locator(`${MENU} .kalem-menu-item`).last()).toBeFocused();
	});

	test("End son öğeye, Home ilk öğeye gidiyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.keyboard.press("End");
		await expect(page.locator(`${MENU} .kalem-menu-item`).last()).toBeFocused();
		await page.keyboard.press("Home");
		await expect(page.locator(`${MENU} .kalem-menu-item`).first()).toBeFocused();
	});

	test("Enter odaklı öğeyi çalıştırıyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		// Sırayla: Çoğalt, Kopyala, Yukarı taşı, Aşağı taşı.
		await page.keyboard.press("Enter");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bir\n\nüç\n\niki\n");
	});

	/** Escape odağı geldiği düğmeye geri vermeli; odak boşlukta kalamaz. */
	test("Escape kapatıyor ve odağı tutamaca döndürüyor", async ({ page }) => {
		await menuAc(page, 1);
		await page.keyboard.press("Escape");
		await expect(page.locator(MENU)).toBeHidden();
		await expect(page.locator(".kalem-handle-grip")).toBeFocused();
	});

	/** Roving tabindex: menüde tek odaklanabilir öğe var, Tab dışarı çıkıyor. */
	test("menüde tek odaklanabilir öğe var", async ({ page }) => {
		await menuAc(page, 1);
		const sayi = await page.evaluate(
			() => document.querySelectorAll('.kalem-block-menu [tabindex="0"]').length,
		);
		expect(sayi).toBe(1);
	});

	test("her öğe menuitem olarak duyuruluyor", async ({ page }) => {
		await menuAc(page, 1);
		const roller = await page.evaluate(() =>
			Array.from(document.querySelectorAll(".kalem-block-menu .kalem-menu-item")).map((n) =>
				n.getAttribute("role"),
			),
		);
		expect(new Set(roller)).toEqual(new Set(["menuitem"]));
	});
});

/**
 * Sabit üst araç çubuğu  (İş listesi: F3-06)
 *
 * Kabul kriteri seçeneğin kendisi: `toolbar: 'fixed' | 'bubble' | 'both' |
 * false`. Dördü de burada ölçülüyor — demo sayfası kipi değiştirince
 * arayüzü baştan kuruyor, yani test gerçek montaj yolundan geçiyor.
 */

const CUBUK = ".kalem-toolbar";

/** Araç çubuğu kipini değiştirir ve yeniden montajı bekler. */
async function kip(page: import("@playwright/test").Page, deger: string) {
	await page.locator("#aracCubugu").selectOption(deger);
}

test.describe("araç çubuğu kipi", () => {
	test("varsayılan yalnızca balon", async ({ page }) => {
		await expect(page.locator(CUBUK)).toHaveCount(0);
	});

	test("fixed sabit çubuğu getiriyor, balonu kaldırıyor", async ({ page }) => {
		await kip(page, "fixed");
		await expect(page.locator(CUBUK)).toBeVisible();
		await secimYap(page);
		await expect(page.locator(BALON)).toHaveCount(0);
	});

	test("both ikisini birden veriyor", async ({ page }) => {
		await kip(page, "both");
		await expect(page.locator(CUBUK)).toBeVisible();
		await secimYap(page);
		await expect(page.locator(BALON)).toBeVisible();
	});

	test("false hiçbirini vermiyor", async ({ page }) => {
		await kip(page, "false");
		await expect(page.locator(CUBUK)).toHaveCount(0);
		await secimYap(page);
		await expect(page.locator(BALON)).toHaveCount(0);
	});
});

test.describe("sabit araç çubuğu", () => {
	test.beforeEach(async ({ page }) => {
		await kip(page, "fixed");
		await expect(page.locator(CUBUK)).toBeVisible();
	});

	/** Çubuk editörün akışında, kardeşi olarak duruyor. */
	test("editörün hemen üstünde", async ({ page }) => {
		const once = await page.evaluate(
			() => document.querySelector("#editor")?.previousElementSibling?.className,
		);
		expect(once).toContain("kalem-toolbar");
	});

	test("toolbar olarak duyuruluyor", async ({ page }) => {
		await expect(page.locator(CUBUK)).toHaveAttribute("role", "toolbar");
		await expect(page.locator(CUBUK)).toHaveAttribute("aria-label", "Araç çubuğu");
	});

	test("kalın düğmesi biçim uyguluyor", async ({ page }) => {
		await secimYap(page, "metin");
		await page.locator(`${CUBUK} button[aria-label="Kalın"]`).click();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("**metin**\n");
	});

	test("basılı durum seçime göre yansıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("**kalın** düz\n"));
		await page.locator("#editor > p strong").click();
		await expect(page.locator(`${CUBUK} button[aria-label="Kalın"]`)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("liste düğmesi listeye çeviriyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("madde\n"));
		await page.locator("#editor > p").first().click();
		await page.locator(`${CUBUK} button[aria-label="Madde imli liste"]`).click();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("- madde\n");
	});

	/** Geçmiş boşken geri al düğmesi kullanılamaz olmalı — ama kaybolmamalı. */
	test("geri al düğmesi geçmiş boşken kapalı", async ({ page }) => {
		await expect(page.locator(`${CUBUK} button[aria-label="Geri al"]`)).toBeDisabled();
		await expect(page.locator(`${CUBUK} button[aria-label="Geri al"]`)).toBeVisible();
	});

	test("yazdıktan sonra geri al açılıyor ve çalışıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir\n"));
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.type(" iki");
		await expect(page.locator(`${CUBUK} button[aria-label="Geri al"]`)).toBeEnabled();
		await page.locator(`${CUBUK} button[aria-label="Geri al"]`).click();
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bir\n");
	});

	test("blok türü listesi başlığa çeviriyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("metin\n"));
		await page.locator("#editor > p").first().click();
		await page.locator(`${CUBUK} .kalem-block-select`).selectOption("heading-2");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("## metin\n");
	});

	test("salt okunur modda düğmeler kapanıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setReadOnly(true));
		await expect(page.locator(`${CUBUK} button[aria-label="Kalın"]`)).toBeDisabled();
		await expect(page.locator(`${CUBUK} .kalem-block-select`)).toBeDisabled();
	});

	/** Gezgin sekme sırası: çubuğa tek Tab ile giriliyor, içinde oklarla geziliyor. */
	test("çubukta tek odaklanabilir düğme var", async ({ page }) => {
		const sayi = await page.evaluate(
			() => document.querySelectorAll('.kalem-toolbar [tabindex="0"]').length,
		);
		expect(sayi).toBe(1);
	});

	test("ok tuşlarıyla düğmeler arasında geziliyor", async ({ page }) => {
		const dugmeler = page.locator(`${CUBUK} button:not(:disabled), ${CUBUK} select`);
		await dugmeler.first().focus();
		await page.keyboard.press("ArrowRight");
		await expect(dugmeler.nth(1)).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(dugmeler.first()).toBeFocused();
	});

	/**
	 * Geçmiş boşken geri al/yinele kapalı ve odak alamıyor; listede
	 * bırakılsalardı ok tuşu klavye kullanıcısını hiçbir yere götürmüyor
	 * gibi görünürdü.
	 */
	test("kapalı düğmeler gezinmede atlanıyor", async ({ page }) => {
		await expect(page.locator(`${CUBUK} button[aria-label="Geri al"]`)).toBeDisabled();
		// Tab ile giriş noktası kapalı bir düğme olamaz.
		const girisKapali = await page.evaluate(() =>
			document.querySelector('.kalem-toolbar [tabindex="0"]')?.hasAttribute("disabled"),
		);
		expect(girisKapali).toBe(false);
	});

	/** Gruplar yapılandırılabilir; `mountUi` seçeneği doğrudan sınanıyor. */
	test("gruplar yapılandırılabiliyor", async ({ page }) => {
		const sayi = await page.evaluate(() => {
			window.kalem.ui.destroy();
			const ui = window.kalem.mountUi(window.kalem.editor, {
				toolbar: "fixed",
				toolbarGroups: ["format"],
			});
			const n = document.querySelectorAll(".kalem-toolbar .kalem-toolbar-group").length;
			ui.destroy();
			return n;
		});
		expect(sayi).toBe(1);
	});
});

/**
 * Tema sistemi  (İş listesi: F3-09)
 *
 * Kabul kriteri tek cümle: *tek CSS bloğuyla marka rengi
 * değiştirilebiliyor.* Bu, ölçülebilir bir iddia — ve önceki hâlde
 * **yanlıştı**: görüntüleyici `--kalem-accent`, arayüz `--kalem-ui-accent`
 * kullanıyordu, biri unutulunca araç çubuğu belgeden farklı renk kalıyordu.
 */
test.describe("tema", () => {
	/** Bir elemanın hesaplanmış vurgu rengi. */
	const vurgu = (page: import("@playwright/test").Page, secici: string) =>
		page.evaluate(
			(s) =>
				getComputedStyle(document.querySelector(s) as Element)
					.getPropertyValue("--kalem-accent")
					.trim(),
			secici,
		);

	/** F3-09'un kabul kriteri. */
	test("tek blok bütün yüzeylerin marka rengini değiştiriyor", async ({ page }) => {
		// `both`: iki çubuk da aynı anda ekranda olsun ki tek blokla
		// ikisinin birden değiştiği görülebilsin.
		await kip(page, "both");
		await expect(page.locator(CUBUK)).toBeVisible();
		await secimYap(page, "metin");
		await expect(page.locator(BALON)).toBeVisible();

		await page.addStyleTag({ content: ".kalem-theme { --kalem-accent: rgb(124, 58, 237); }" });

		// Editör, sabit çubuk ve balon — üçü de aynı sözlükten okumalı.
		expect(await vurgu(page, "#editor")).toBe("rgb(124, 58, 237)");
		expect(await vurgu(page, ".kalem-toolbar")).toBe("rgb(124, 58, 237)");
		expect(await vurgu(page, ".kalem-bubble")).toBe("rgb(124, 58, 237)");
	});

	/**
	 * Yüzen parçalar `<body>` altında; gömen sayfanın sarmalayıcısından
	 * miras alamıyorlar, bu yüzden sınıfı kendileri taşıyor.
	 */
	test("yüzen parçalar tema sınıfını taşıyor", async ({ page }) => {
		await kip(page, "both");
		await secimYap(page, "metin");
		await expect(page.locator(BALON)).toBeVisible();
		for (const secici of [".kalem-bubble", ".kalem-toolbar", ".kalem-slash", ".kalem-handle"]) {
			const varMi = await page.evaluate(
				(s) => document.querySelector(s)?.classList.contains("kalem-theme") ?? null,
				secici,
			);
			expect(varMi, secici).toBe(true);
		}
	});

	/** Sözlük yalnızca Kalem'in yüzeylerine iniyor; sayfaya sızmıyor. */
	test("tokenlar :root'a yazılmıyor", async ({ page }) => {
		const govde = await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue("--kalem-accent").trim(),
		);
		expect(govde).toBe("");
	});

	test("koyu tema dosyası paleti değiştiriyor", async ({ page }) => {
		const once = await vurgu(page, "#editor");
		await page.locator("#tema").selectOption("dark");
		await expect.poll(() => vurgu(page, "#editor")).not.toBe(once);
	});

	/** Yalın tema kütüphanenin kendi rengini geri çekiyor. */
	test("yalın tema vurgusu metnin kendisi", async ({ page }) => {
		await page.locator("#tema").selectOption("minimal");
		await expect.poll(() => vurgu(page, "#editor")).toBe("currentcolor");
	});

	test("yalın temada gölge ve yuvarlatma yok", async ({ page }) => {
		await page.locator("#tema").selectOption("minimal");
		await expect
			.poll(() =>
				page.evaluate(() =>
					getComputedStyle(document.querySelector("#editor") as Element)
						.getPropertyValue("--kalem-shadow")
						.trim(),
				),
			)
			.toBe("none");
	});

	/** Açık temayı **açıkça** seçen kullanıcıyı sistem tercihi ezmemeli. */
	test("data-theme sistem tercihini eziyor", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		const sistemKoyu = await vurgu(page, "#editor");
		await page.evaluate(() =>
			document.getElementById("editor")?.setAttribute("data-theme", "light"),
		);
		expect(await vurgu(page, "#editor")).not.toBe(sistemKoyu);
	});

	/*
	 * Öznitelik **atada**.
	 *
	 * Olağan kullanım bu: uygulama `<html data-theme="dark">` yazıyor,
	 * `kalem-theme` sınıfı ise editörün üstünde — ikisi aynı eleman değil.
	 * Yukarıdaki iki test özniteliği editörün kendisine koyduğu için bu
	 * durum kapsanmıyordu ve seçici yalnızca bileşik hâlde yazılıydı:
	 * sayfa koyuya dönüyor, belge açık kalıyordu. F5-05'in not defteri
	 * bunu ilk gün ortaya çıkardı.
	 */
	test("atadaki data-theme koyu temayı uyguluyor", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		const acik = await vurgu(page, "#editor");
		await page.evaluate(() => {
			document.documentElement.dataset["theme"] = "dark";
		});
		expect(await vurgu(page, "#editor")).not.toBe(acik);
	});

	test("atadaki data-theme sistem tercihini de eziyor", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		const sistemKoyu = await vurgu(page, "#editor");
		await page.evaluate(() => {
			document.documentElement.dataset["theme"] = "light";
		});
		expect(await vurgu(page, "#editor")).not.toBe(sistemKoyu);
	});
});
