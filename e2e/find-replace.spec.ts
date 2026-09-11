import { expect, test } from "@playwright/test";

/**
 * `@kalem/plugin-find-replace`  (İş listesi: F4-03)
 *
 * Arama mantığının tamamı birim testleriyle sabit (`search.test.ts`);
 * burada ölçülen, tuşların panele, panelin de arama motoruna gerçekten
 * bağlandığı ve boyamanın üç motorda da göründüğü.
 */

declare global {
	interface Window {
		kalem: {
			editor: {
				getValue(): string;
				setValue(md: string): void;
				setReadOnly(v: boolean): void;
				focus(): void;
			};
			aramaEklentisi: {
				open(mode?: "find" | "replace"): void;
				close(): void;
				matches(): readonly { from: number; to: number }[];
				currentIndex(): number;
			};
		};
	}
}

const BELGE = "Işık ve gölge\n\nIŞIK her yerde.\n\nİŞİK diye bir kelime yok.\n";

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
	await page.evaluate((md) => {
		window.kalem.editor.setValue(md);
		window.kalem.editor.focus();
	}, BELGE);
});

/**
 * Belgeyi kurar ve odağı editörde bırakır.
 *
 * `setValue` blokları yeniden çiziyor ve odak belgeye düşüyor; Ctrl+F
 * editörün tuş haritasından geçtiği için odağın editörde olması şart.
 */
async function yaz(page: import("@playwright/test").Page, md: string) {
	await page.evaluate((kaynak) => {
		window.kalem.editor.setValue(kaynak);
		window.kalem.editor.focus();
	}, md);
}

const panel = (page: import("@playwright/test").Page) => page.locator(".kalem-find");
const bulKutusu = (page: import("@playwright/test").Page) =>
	panel(page).getByRole("textbox", { name: "Bul", exact: true });
const degistirKutusu = (page: import("@playwright/test").Page) =>
	panel(page).getByRole("textbox", { name: "Şununla değiştir" });
const sayac = (page: import("@playwright/test").Page) => panel(page).locator(".kalem-find-count");

test("Ctrl+F paneli açıyor, Escape kapatıyor", async ({ page }) => {
	await page.keyboard.press("Control+f");
	await expect(panel(page)).toBeVisible();
	await expect(bulKutusu(page)).toBeFocused();

	await page.keyboard.press("Escape");
	await expect(panel(page)).toBeHidden();
	// Odak editöre dönüyor: kullanıcı yazdığı yere devam edebilmeli. Kökün
	// kendisi odaklanabilir değil — her blok kendi `contenteditable`ı.
	await expect
		.poll(() => page.evaluate(() => document.activeElement?.closest("#editor") !== null))
		.toBe(true);
});

test("Türkçe kasa katlaması: ışık ↔ IŞIK eşleşiyor, İŞİK eşleşmiyor", async ({ page }) => {
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("ışık");
	// "Işık" ve "IŞIK" var; "İŞİK" yok.
	await expect(sayac(page)).toHaveText("1 / 2");
});

test("iyi ↔ İYİ eşleşiyor", async ({ page }) => {
	await yaz(page, "İYİ günler\n");
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("iyi");
	await expect(sayac(page)).toHaveText("1 / 1");
});

test("sonuç yoksa söylüyor", async ({ page }) => {
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("zürafa");
	await expect(sayac(page)).toHaveText("Sonuç yok");
});

test("eşleşmeler boyanıyor", async ({ page }) => {
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("ışık");
	// Özel Vurgu API'si DOM'a düğüm eklemiyor; kayıt defterine bakıyoruz.
	const boyanan = await page.evaluate(() => {
		const kayit = (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights;
		return {
			tum: kayit.get("kalem-find")?.size ?? 0,
			gecerli: kayit.get("kalem-find-current")?.size ?? 0,
		};
	});
	expect(boyanan).toEqual({ tum: 1, gecerli: 1 });
});

test("boyama belgeye düğüm eklemiyor", async ({ page }) => {
	const once = await page.locator("#editor").innerHTML();
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("ışık");
	await expect(sayac(page)).toHaveText("1 / 2");
	expect(await page.locator("#editor").innerHTML()).toBe(once);
});

test("Enter sonraki eşleşmeye gidiyor ve başa sarıyor", async ({ page }) => {
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("ışık");
	await expect(sayac(page)).toHaveText("1 / 2");
	await page.keyboard.press("Enter");
	await expect(sayac(page)).toHaveText("2 / 2");
	await page.keyboard.press("Enter");
	await expect(sayac(page)).toHaveText("1 / 2");
});

test("Shift+Enter geriye gidiyor", async ({ page }) => {
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("ışık");
	await page.keyboard.press("Shift+Enter");
	await expect(sayac(page)).toHaveText("2 / 2");
});

test("Ctrl+H değiştirme satırını açıyor", async ({ page }) => {
	await page.keyboard.press("Control+h");
	await expect(degistirKutusu(page)).toBeVisible();
});

test("tek eşleşmeyi değiştiriyor", async ({ page }) => {
	await yaz(page, "bir kedi ve bir kedi\n");
	await page.keyboard.press("Control+h");
	await bulKutusu(page).fill("kedi");
	await degistirKutusu(page).fill("köpek");
	await panel(page).getByRole("button", { name: "Değiştir", exact: true }).click();
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bir köpek ve bir kedi\n");
	// Kalan eşleşme sayaçta görünüyor.
	await expect(sayac(page)).toHaveText("1 / 1");
});

test("tümünü değiştir tek adımda çalışıyor ve tek Ctrl+Z ile geri alınıyor", async ({ page }) => {
	await yaz(page, "kedi kedi kedi\n");
	await page.keyboard.press("Control+h");
	await bulKutusu(page).fill("kedi");
	await degistirKutusu(page).fill("köpek");
	await panel(page).getByRole("button", { name: "Tümünü değiştir" }).click();
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("köpek köpek köpek\n");

	await page.keyboard.press("Escape");
	await page.keyboard.press("Control+z");
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("kedi kedi kedi\n");
});

test("biçim korunuyor: kalın kelime kalın kalıyor", async ({ page }) => {
	await yaz(page, "bu **kedi** metni\n");
	await page.keyboard.press("Control+h");
	await bulKutusu(page).fill("kedi");
	await degistirKutusu(page).fill("köpek");
	await panel(page).getByRole("button", { name: "Tümünü değiştir" }).click();
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bu **köpek** metni\n");
});

test("tam kelime seçeneği ekleri dışlıyor", async ({ page }) => {
	await yaz(page, "kedi kediler\n");
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("kedi");
	await expect(sayac(page)).toHaveText("1 / 2");
	await panel(page).getByLabel("Tam kelime").check();
	await expect(sayac(page)).toHaveText("1 / 1");
});

test("büyük/küçük harf duyarlı seçeneği", async ({ page }) => {
	await yaz(page, "Kedi kedi\n");
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("kedi");
	await expect(sayac(page)).toHaveText("1 / 2");
	await panel(page).getByLabel("Büyük/küçük harf duyarlı").check();
	await expect(sayac(page)).toHaveText("1 / 1");
});

test("salt okunur belgede arama çalışıyor, değiştirme kapalı", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setReadOnly(true));
	await page.evaluate(() => window.kalem.aramaEklentisi.open("replace"));
	await bulKutusu(page).fill("ışık");
	await expect(sayac(page)).toHaveText("1 / 2");
	await expect(panel(page).getByRole("button", { name: "Tümünü değiştir" })).toBeDisabled();
});

test("belge değişince eşleşmeler güncelleniyor", async ({ page }) => {
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("ışık");
	await expect(sayac(page)).toHaveText("1 / 2");
	await yaz(page, "IŞIK IŞIK IŞIK\n");
	await expect(sayac(page)).toHaveText("1 / 3");
});

test("kod bloğunun içinde de buluyor", async ({ page }) => {
	await yaz(page, "```js\nconst kedi = 1;\n```\n");
	await page.keyboard.press("Control+f");
	await bulKutusu(page).fill("kedi");
	await expect(sayac(page)).toHaveText("1 / 1");
});
