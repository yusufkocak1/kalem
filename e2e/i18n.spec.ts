import { expect, type Page, test } from "@playwright/test";

/**
 * i18n ve locale  (İş listesi: F6-10)
 *
 * Birim testleri (`lang.test.ts`, `labels.test.ts`) kararların kendisini
 * sabitliyor. Buradaki soru başka: **gerçek bir tarayıcıda** o kararlar
 * birbirine doğru bağlanıyor mu — arayüz, eklentiler ve özellik
 * yöneliminin hepsi aynı dili ve aynı yönü görüyor mu.
 */

declare global {
	interface Window {
		kalem: {
			editor: {
				getLang(): string;
				getElement(): HTMLElement;
				addPlugin(plugin: unknown): void;
				removePlugin(name: string): boolean;
				setValue(markdown: string): void;
			};
			mountUi(editor: unknown, options?: unknown): { destroy(): void };
			readonly ui: { destroy(): void };
			sayacEklentisi: { name: string };
		};
	}
}

const BLOK = "#editor > [data-kalem-id]";

test.beforeEach(async ({ page }) => {
	await page.goto("/editor.html");
	await expect(page.locator(BLOK).first()).toBeVisible();
});

/** Arayüzü baştan kurar; `mountUi` tek seferlik bir montaj. */
async function yenidenMonte(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.kalem.ui.destroy();
		// Yeni örnek sayfanın `ui` değişkenine yazılamıyor; test boyunca
		// ona ihtiyaç yok, sökülmesini sayfa kapanışı hallediyor.
		window.kalem.mountUi(window.kalem.editor);
	});
}

// ---------------------------------------------------------------------------
// Kabul: dil değişimi çalışıyor
// ---------------------------------------------------------------------------

test.describe("dil değişimi", () => {
	test("arayüz belge diline göre konuşuyor", async ({ page }) => {
		// Demo sayfası `lang="tr"`.
		await expect(page.locator("#editor")).toHaveAttribute("aria-label", "Belge");
	});

	test("dil değişip arayüz yeniden kurulunca metinler değişiyor", async ({ page }) => {
		/*
		 * Kabul kriteri bu. Dil **montaj anında** okunuyor — araç çubuğu
		 * kipiyle aynı model (bkz. temalar rehberi). Canlı değiştirmek her
		 * bileşenin her metnini dinlemesi demek olurdu; dil bir oturumda
		 * nadiren değişiyor ve yeniden kurmak tek satır.
		 */
		await page.evaluate(() => window.kalem.editor.getElement().setAttribute("lang", "en"));
		await yenidenMonte(page);

		await expect(page.locator("#editor")).toHaveAttribute("aria-label", "Document");
	});

	test("eklenti de aynı dili görüyor", async ({ page }) => {
		/*
		 * F6-10'dan önce her eklenti dili kendisi çözüyordu. Bu test tek
		 * kaynağın gerçekten tek olduğunu ölçüyor: arayüz İngilizce'ye
		 * dönünce eklenti de dönüyor.
		 */
		await expect(page.locator(".kalem-wordcount")).toHaveAttribute(
			"aria-label",
			"Belge istatistikleri",
		);

		await page.evaluate(() => {
			const { editor, sayacEklentisi } = window.kalem;
			editor.getElement().setAttribute("lang", "en");
			editor.removePlugin(sayacEklentisi.name);
			editor.addPlugin(sayacEklentisi);
		});

		await expect(page.locator(".kalem-wordcount")).toHaveAttribute(
			"aria-label",
			"Document statistics",
		);
	});

	test("sayılar belge dilinin biçiminde", async ({ page }) => {
		/*
		 * Binlik ayırıcı dile göre ters: Türkçe'de nokta, İngilizce'de
		 * virgül. Yanlış olanı başka bir sayı gibi okunuyor.
		 */
		await page.evaluate(() => window.kalem.editor.setValue(`${"kelime ".repeat(1234)}\n`));
		await expect(page.locator(".kalem-wordcount")).toContainText("1.234 kelime");
	});
});

// ---------------------------------------------------------------------------
// Belge dilinin tek kaynağı
// ---------------------------------------------------------------------------

test.describe("dil zinciri", () => {
	test("lang seçeneği elemana yazılıyor ve getLang onu veriyor", async ({ page }) => {
		expect(await page.evaluate(() => window.kalem.editor.getLang())).toBe("tr");
	});

	test("canlı çözülüyor, önbelleğe alınmıyor", async ({ page }) => {
		const dil = await page.evaluate(() => {
			window.kalem.editor.getElement().setAttribute("lang", "en-GB");
			return window.kalem.editor.getLang();
		});
		expect(dil).toBe("en-GB");
	});

	test("sayfa dil beyan etmiyorsa tarayıcının dili", async ({ page }) => {
		/*
		 * F6-10'a kadar hiçbir yerde olmayan halka. Yapılandırmanın yerel
		 * ayarı `tr-TR`; sayfadaki bütün `lang`ler sökülünce editör onu
		 * görmeli, "en"e değil.
		 */
		const dil = await page.evaluate(() => {
			for (const el of document.querySelectorAll("[lang]")) el.removeAttribute("lang");
			return { editor: window.kalem.editor.getLang(), tarayici: navigator.language };
		});
		expect(dil.editor).toBe(dil.tarayici);
		expect(dil.editor).toMatch(/^tr/);
	});

	test("boş lang dil sayılmıyor", async ({ page }) => {
		// `lang=""` HTML'de "bilinmiyor" demek; zincir onu atlayıp
		// `<html lang>`a bakmalı.
		const dil = await page.evaluate(() => {
			window.kalem.editor.getElement().setAttribute("lang", "");
			document.documentElement.lang = "tr";
			return window.kalem.editor.getLang();
		});
		expect(dil).toBe("tr");
	});
});

test.describe("tarayıcı Almanca", () => {
	test.use({ locale: "de-DE" });

	test("dil beyan etmeyen sayfada tarayıcı dili zincirin sonu", async ({ page }) => {
		const dil = await page.evaluate(() => {
			for (const el of document.querySelectorAll("[lang]")) el.removeAttribute("lang");
			return window.kalem.editor.getLang();
		});
		expect(dil).toBe("de-DE");
	});
});

// ---------------------------------------------------------------------------
// Sağdan sola  (dir="rtl" temel desteği)
// ---------------------------------------------------------------------------

test.describe("sağdan sola", () => {
	test.beforeEach(async ({ page }) => {
		await page.evaluate(() => {
			const el = window.kalem.editor.getElement();
			el.setAttribute("dir", "rtl");
			el.setAttribute("lang", "ar");
		});
	});

	test("tutamaç satırın başında — sağda", async ({ page }) => {
		const blok = page.locator(BLOK).nth(1);
		await blok.hover();

		const tutamac = page.locator(".kalem-handle");
		await expect(tutamac).toBeVisible();

		const t = await tutamac.boundingBox();
		const b = await blok.boundingBox();
		// Bloğun sağ kenarının ötesinde, metnin üstüne binmeden.
		expect(t?.x ?? 0).toBeGreaterThanOrEqual((b?.x ?? 0) + (b?.width ?? 0));
	});

	test("tutamaç boşluğu da sağda", async ({ page }) => {
		// `.kalem-ui { padding-inline-start }` — soldan sağa yazıda sol,
		// sağdan sola yazıda sağ boşluk.
		const dolgu = await page.evaluate(() => {
			const s = getComputedStyle(window.kalem.editor.getElement());
			return { sol: s.paddingLeft, sag: s.paddingRight };
		});
		expect(Number.parseFloat(dolgu.sag)).toBeGreaterThan(Number.parseFloat(dolgu.sol));
	});

	test("alıntı çizgisi ve liste girintisi aynalanıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("> alıntı\n\n- madde\n"));
		const olcu = await page.evaluate(() => {
			const q = getComputedStyle(document.querySelector("#editor blockquote") as Element);
			const ul = getComputedStyle(document.querySelector("#editor ul") as Element);
			return {
				alintiSag: q.borderRightWidth,
				alintiSol: q.borderLeftWidth,
				listeSag: Number.parseFloat(ul.paddingRight),
				listeSol: Number.parseFloat(ul.paddingLeft),
			};
		});
		expect(olcu.alintiSag).toBe("3px");
		expect(olcu.alintiSol).toBe("0px");
		expect(olcu.listeSag).toBeGreaterThan(olcu.listeSol);
	});

	test("sağdan sola metin yazılıp Markdown'a iniyor", async ({ page }) => {
		// Yazma yönü tarayıcının işi; editörün işi modeli bozmamak.
		await page.evaluate(() => window.kalem.editor.setValue("مرحبا\n"));
		const ilk = page.locator(BLOK).first();
		await ilk.click();
		await page.keyboard.press("End");
		await page.keyboard.type(" بالعالم");
		await expect(page.locator("#cikti")).toContainText("مرحبا بالعالم");
	});

	test("tutamaç soldan sağa yazıda hâlâ solda", async ({ page }) => {
		// Geri dönüş: RTL desteği varsayılan yönü bozmamalı.
		await page.evaluate(() => window.kalem.editor.getElement().setAttribute("dir", "ltr"));
		const blok = page.locator(BLOK).nth(1);
		await blok.hover();

		const tutamac = page.locator(".kalem-handle");
		await expect(tutamac).toBeVisible();
		const t = await tutamac.boundingBox();
		const b = await blok.boundingBox();
		expect((t?.x ?? 0) + (t?.width ?? 0)).toBeLessThanOrEqual((b?.x ?? 0) + 1);
	});
});
