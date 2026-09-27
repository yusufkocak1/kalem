import { expect, test } from "@playwright/test";

/**
 * `@kalem-editor/plugin-image-upload`  (İş listesi: F4-01)
 *
 * Kabul kriteri: *sahte bir S3 yükleyiciyle uçtan uca çalışıyor.* Demo
 * sayfası `window.kalemYukleme` ile ayarlanabilen bir yükleyici kuruyor;
 * testler onun hızını ve başarısızlığını buradan sürüyor.
 *
 * Model katmanı (`model.test.ts`) neyin nereye gittiğini sabitliyor;
 * burada ölçülen, sürükle-bırak ve yapıştırmanın gerçekten oraya
 * bağlandığı ve yükleme bitince belgenin doğru güncellendiği.
 */

declare global {
	interface Window {
		kalem: {
			editor: {
				getValue(): string;
				setValue(md: string): void;
				setReadOnly(v: boolean): void;
			};
			gorselEklentisi: { pendingUploads(): readonly { url: string; progress: number }[] };
		};
		kalemYukleme: { gecikme: number; adim: number; hata: boolean; sonAdres: string | null };
	}
}

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
	await page.evaluate(() => window.kalem.editor.setValue("Metin.\n"));
});

/**
 * Editöre dosya bırakır.
 *
 * `DataTransfer` sayfa içinde kuruluyor: Playwright'ın `setInputFiles`ı bir
 * `<input>` gerektiriyor ve burada öyle bir eleman yok — kullanıcı dosyayı
 * doğrudan metnin üstüne bırakıyor.
 */
async function dosyaBirak(
	page: import("@playwright/test").Page,
	ad: string,
	tur = "image/png",
	boyut = 64,
) {
	await page.evaluate(
		([dosyaAdi, mime, uzunluk]) => {
			const veri = new DataTransfer();
			const icerik = new Uint8Array(Number(uzunluk));
			veri.items.add(new File([icerik], String(dosyaAdi), { type: String(mime) }));
			const el = document.getElementById("editor");
			el?.dispatchEvent(
				new DragEvent("dragover", { dataTransfer: veri, bubbles: true, cancelable: true }),
			);
			el?.dispatchEvent(
				new DragEvent("drop", { dataTransfer: veri, bubbles: true, cancelable: true }),
			);
		},
		[ad, tur, String(boyut)] as const,
	);
}

/** Editöre dosya yapıştırır. */
async function dosyaYapistir(page: import("@playwright/test").Page, ad: string) {
	await page.evaluate((dosyaAdi) => {
		const veri = new DataTransfer();
		veri.items.add(new File([new Uint8Array(8)], dosyaAdi, { type: "image/png" }));
		document
			.getElementById("editor")
			?.dispatchEvent(
				new ClipboardEvent("paste", { clipboardData: veri, bubbles: true, cancelable: true }),
			);
	}, ad);
}

const md = (page: import("@playwright/test").Page) =>
	page.evaluate(() => window.kalem.editor.getValue());

test.describe("sürükle-bırak", () => {
	/** F4-01'in kabul kriteri. */
	test("bırakılan görsel yüklenip belgeye giriyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
		await dosyaBirak(page, "manzara.png");

		await expect.poll(() => md(page)).toContain("![manzara](https://sahte-s3.ornek/manzara.png)");
	});

	/** Yükleme başlarken görsel zaten belgede: kullanıcı bekleme hissetmiyor. */
	test("yükleme başlar başlamaz önizleme görünüyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalemYukleme.gecikme = 300;
		});
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
		await dosyaBirak(page, "yavas.png");

		await expect(page.locator("#editor img")).toHaveCount(1);
		await expect(page.locator("#editor img")).toHaveAttribute("src", /^blob:/);
	});

	test("yükleme sürerken görsel işaretli", async ({ page }) => {
		await page.evaluate(() => {
			window.kalemYukleme.gecikme = 300;
		});
		await page.locator("#editor > p").first().click();
		await dosyaBirak(page, "yavas.png");
		await expect(page.locator("#editor img.kalem-uploading")).toHaveCount(1);
		// Bitince işaret kalkıyor.
		await expect(page.locator("#editor img.kalem-uploading")).toHaveCount(0, { timeout: 15000 });
	});

	/** Gömen uygulama kaydetmeden önce buna bakabilmeli. */
	test("süren yüklemeler sorulabiliyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalemYukleme.gecikme = 300;
		});
		await page.locator("#editor > p").first().click();
		await dosyaBirak(page, "yavas.png");

		await expect
			.poll(() => page.evaluate(() => window.kalem.gorselEklentisi.pendingUploads().length))
			.toBe(1);
		await expect
			.poll(() => page.evaluate(() => window.kalem.gorselEklentisi.pendingUploads().length), {
				timeout: 15000,
			})
			.toBe(0);
	});

	test("ilerleme bildiriliyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalemYukleme.gecikme = 200;
			window.kalemYukleme.adim = 5;
		});
		await page.locator("#editor > p").first().click();
		await dosyaBirak(page, "yavas.png");

		await expect
			.poll(() =>
				page.evaluate(() => window.kalem.gorselEklentisi.pendingUploads()[0]?.progress ?? 0),
			)
			.toBeGreaterThan(0);
	});

	/** Alt metin dosya adından türetiliyor; boş bırakmaktan iyi. */
	test("alt metin dosya adından geliyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await dosyaBirak(page, "tatil-fotografi_2.png");
		await expect.poll(() => md(page)).toContain("![tatil fotografi 2]");
	});

	test("Türkçe dosya adı bozulmuyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await dosyaBirak(page, "ışık-gölge.png");
		await expect.poll(() => md(page)).toContain("![ışık gölge]");
	});

	test("birden çok dosya sırayla yükleniyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
		await page.evaluate(() => {
			const veri = new DataTransfer();
			for (const ad of ["bir.png", "iki.png"]) {
				veri.items.add(new File([new Uint8Array(4)], ad, { type: "image/png" }));
			}
			document
				.getElementById("editor")
				?.dispatchEvent(
					new DragEvent("drop", { dataTransfer: veri, bubbles: true, cancelable: true }),
				);
		});
		await expect.poll(() => md(page)).toContain("bir.png");
		await expect.poll(() => md(page)).toContain("iki.png");
	});

	/** Sürükleme sırasında editör hedef olduğunu göstermeli. */
	test("sürükleme sırasında hedef işaretleniyor", async ({ page }) => {
		await page.evaluate(() => {
			const veri = new DataTransfer();
			veri.items.add(new File([new Uint8Array(4)], "a.png", { type: "image/png" }));
			document
				.getElementById("editor")
				?.dispatchEvent(
					new DragEvent("dragover", { dataTransfer: veri, bubbles: true, cancelable: true }),
				);
		});
		await expect(page.locator("#editor")).toHaveClass(/kalem-drop-target/);
	});
});

test.describe("yapıştırma", () => {
	/**
	 * Firefox sentetik (güvenilmeyen) bir `paste` olayında `clipboardData`yı
	 * okutmuyor — F2-11, F3-02 ve F3-07'de aynı kısıt. Ölçülemeyen şey
	 * davranış değil, sentetik olayın okunabilirliği; sürükle-bırak yolu
	 * Firefox'ta da koşuyor ve aynı koda gidiyor.
	 */
	test.beforeEach(({ browserName }) => {
		test.skip(browserName === "firefox", "Firefox sentetik paste verisini okutmuyor");
	});

	test("yapıştırılan görsel yükleniyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
		await dosyaYapistir(page, "pano.png");
		await expect.poll(() => md(page)).toContain("![pano](https://sahte-s3.ornek/pano.png)");
	});

	/** Pano hem dosya hem metin taşıyabiliyor; dosya varsa kastedilen o. */
	test("dosya varken metin yapıştırılmıyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
		await page.evaluate(() => {
			const veri = new DataTransfer();
			veri.items.add(new File([new Uint8Array(4)], "a.png", { type: "image/png" }));
			veri.setData("text/plain", "YAPISTIRILMAMALI");
			document
				.getElementById("editor")
				?.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: veri, bubbles: true, cancelable: true }),
				);
		});
		await expect.poll(() => md(page)).toContain("a.png");
		expect(await md(page)).not.toContain("YAPISTIRILMAMALI");
	});
});

test.describe("hata yolları", () => {
	test("görsel olmayan dosya reddediliyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await dosyaBirak(page, "rapor.pdf", "application/pdf");
		await expect(page.locator("#gorselHata")).toHaveText("Yalnızca görsel eklenebilir");
		expect(await md(page)).toBe("Metin.\n");
	});

	test("büyük dosya reddediliyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await dosyaBirak(page, "dev.png", "image/png", 6 * 1024 * 1024);
		await expect(page.locator("#gorselHata")).toHaveText("Bu dosya çok büyük");
		expect(await md(page)).toBe("Metin.\n");
	});

	/** Yükleme patlarsa yarım kalan görsel belgede bırakılmamalı. */
	test("yükleme başarısız olunca görsel geri alınıyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalemYukleme.hata = true;
		});
		await page.locator("#editor > p").first().click();
		await dosyaBirak(page, "kotu.png");

		await expect(page.locator("#gorselHata")).toHaveText("Yükleme başarısız (sahte)");
		await expect.poll(() => page.locator("#editor img").count()).toBe(0);
	});

	test("salt okunur modda yükleme yok", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setReadOnly(true));
		await dosyaBirak(page, "a.png");
		await expect.poll(() => md(page)).toBe("Metin.\n");
	});
});

test.describe("yaşam döngüsü", () => {
	/**
	 * Kullanıcı yükleme sürerken görseli silerse istek boşuna sürmemeli ve
	 * biten yükleme silinmiş bir düğümü aramamalı.
	 */
	test("silinen görselin yüklemesi iptal ediliyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalemYukleme.gecikme = 400;
		});
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
		await dosyaBirak(page, "silinecek.png");
		await expect(page.locator("#editor img")).toHaveCount(1);

		// Tek Ctrl+Z eklemeyi geri alıyor.
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#editor img")).toHaveCount(0);

		await expect
			.poll(() => page.evaluate(() => window.kalem.gorselEklentisi.pendingUploads().length))
			.toBe(0);
		// Yükleme bitse bile görsel geri gelmemeli.
		await page.waitForTimeout(1200);
		expect(await page.locator("#editor img").count()).toBe(0);
	});
});

/**
 * Alt metin düzenleme  (İş listesi: F4-01)
 *
 * Alt metin dosya adından türetiliyor ve iyi bir tarif olduğunu iddia
 * etmiyor; kullanıcı görsele tıklayıp düzeltebilmeli.
 */
test.describe("alt metin", () => {
	test.beforeEach(async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("![eski ad](https://ornek/a.png)\n"));
	});

	test("görsele tıklamak düzenleyiciyi açıyor", async ({ page }) => {
		await page.locator("#editor img").click();
		await expect(page.locator(".kalem-alt-editor")).toBeVisible();
		await expect(page.locator(".kalem-alt-input")).toHaveValue("eski ad");
	});

	test("Enter yeni alt metni kaydediyor", async ({ page }) => {
		await page.locator("#editor img").click();
		await page.locator(".kalem-alt-input").fill("kar manzarası");
		await page.keyboard.press("Enter");
		await expect(page.locator(".kalem-alt-editor")).toBeHidden();
		expect(await md(page)).toBe("![kar manzarası](https://ornek/a.png)\n");
	});

	/** Vazgeçen kullanıcının belgesi değişmemeli. */
	test("Escape değişikliği atıyor", async ({ page }) => {
		await page.locator("#editor img").click();
		await page.locator(".kalem-alt-input").fill("yazılmamalı");
		await page.keyboard.press("Escape");
		await expect(page.locator(".kalem-alt-editor")).toBeHidden();
		expect(await md(page)).toBe("![eski ad](https://ornek/a.png)\n");
	});

	/** Dışarı tıklamak kaydediyor: yazdığını kaybetmek en kötüsü. */
	test("dışarı tıklamak kaydediyor", async ({ page }) => {
		await page.locator("#editor img").click();
		await page.locator(".kalem-alt-input").fill("kaydedilsin");
		await page.locator("#cikti").click();
		await expect(page.locator(".kalem-alt-editor")).toBeHidden();
		expect(await md(page)).toBe("![kaydedilsin](https://ornek/a.png)\n");
	});

	test("alt metin boşaltılabiliyor", async ({ page }) => {
		await page.locator("#editor img").click();
		await page.locator(".kalem-alt-input").fill("");
		await page.keyboard.press("Enter");
		expect(await md(page)).toBe("![](https://ornek/a.png)\n");
	});

	test("erişilebilir adı var", async ({ page }) => {
		await page.locator("#editor img").click();
		await expect(page.locator(".kalem-alt-input")).toHaveAttribute("aria-label", "Alt metin");
	});

	test("salt okunur modda açılmıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setReadOnly(true));
		await page.locator("#editor img").click();
		await expect(page.locator(".kalem-alt-editor")).toBeHidden();
	});
});
