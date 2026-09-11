import { expect, test } from "@playwright/test";

/**
 * `@kalem/plugin-source-mode`  (İş listesi: F4-06)
 *
 * Kabul kriteri: *iki mod arası geçişte içerik kaybı yok.* Gidiş-dönüşün
 * model tarafı birim testleriyle sabit (`roundtrip.test.ts`); burada
 * ölçülen, geçişin gerçek editörde de kayıpsız olduğu ve kaynakta
 * yazılanın belgeye döndüğü.
 */

declare global {
	interface Window {
		kalem: {
			editor: { getValue(): string; setValue(md: string): void; setReadOnly(v: boolean): void };
			kaynakEklentisi: {
				enter(): void;
				exit(): void;
				toggle(): void;
				isSource(): boolean;
				text(): string;
			};
		};
	}
}

const ZENGIN = [
	"# Işık ve Gölge",
	"",
	"Paragraf, **kalın**, *eğik* ve [bağlantı](https://ornek.com).",
	"",
	"* yıldız işareti",
	"* korunuyor",
	"",
	"1) parantez ayracı",
	"",
	"> Alıntı bloğu.",
	"",
	"```ts",
	"const x: number = 1;",
	"```",
	"",
	"| a | b |",
	"| --- | --- |",
	"| c | d |",
	"",
	"- [x] görev",
	"- [ ] açık",
	"",
	"---",
	"",
	"Son.",
	"",
].join("\n");

const kutu = (page: import("@playwright/test").Page) => page.locator("textarea.kalem-source");

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
	await page.evaluate((md) => window.kalem.editor.setValue(md), ZENGIN);
});

test("düğme kaynağa geçiriyor ve geri getiriyor", async ({ page }) => {
	await page.locator("#kaynak").click();
	await expect(kutu(page)).toBeVisible();
	await expect(page.locator("#editor")).toBeHidden();
	await expect(page.locator("#kaynak")).toHaveAttribute("aria-pressed", "true");

	await page.locator("#kaynak").click();
	await expect(kutu(page)).toBeHidden();
	await expect(page.locator("#editor")).toBeVisible();
});

test("Ctrl+Shift+M kipi değiştiriyor", async ({ page }) => {
	await page.locator("#editor > p").first().click();
	await page.keyboard.press("Control+Shift+m");
	await expect(kutu(page)).toBeVisible();
	// Kaynaktan çıkış da aynı tuşla: odak `<textarea>`da olduğu için
	// editörün tuş haritası değil, kutunun kendi dinleyicisi yakalıyor.
	await page.keyboard.press("Control+Shift+m");
	await expect(kutu(page)).toBeHidden();
});

test("Escape kaynaktan çıkıyor", async ({ page }) => {
	await page.locator("#kaynak").click();
	await page.keyboard.press("Escape");
	await expect(kutu(page)).toBeHidden();
});

test("kaynakta belgenin Markdown'ı görünüyor", async ({ page }) => {
	await page.locator("#kaynak").click();
	expect(await kutu(page).inputValue()).toBe(ZENGIN);
});

test("geçişte içerik kaybı yok", async ({ page }) => {
	const once = await page.evaluate(() => window.kalem.editor.getValue());
	await page.locator("#kaynak").click();
	await page.locator("#kaynak").click();
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(once);
});

test("üç tur gidip gelmek belgeyi değiştirmiyor", async ({ page }) => {
	const once = await page.evaluate(() => window.kalem.editor.getValue());
	for (let i = 0; i < 3; i++) {
		await page.locator("#kaynak").click();
		await page.locator("#kaynak").click();
	}
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(once);
});

test("değiştirilmeyen kaynak geçmişe adım yazmıyor", async ({ page }) => {
	// Kullanıcı kaynağa bakıp hiçbir şey yapmadan dönerse hiçbir şey
	// olmamalı: Ctrl+Z bir önceki **gerçek** düzenlemeye dönmeli.
	await page.locator("#editor > p").first().click();
	await page.keyboard.press("End");
	await page.keyboard.type("!");
	const yazdiktanSonra = await page.evaluate(() => window.kalem.editor.getValue());

	await page.locator("#kaynak").click();
	await page.locator("#kaynak").click();
	await page.keyboard.press("Control+z");

	const geriAlinmis = await page.evaluate(() => window.kalem.editor.getValue());
	expect(geriAlinmis).not.toBe(yazdiktanSonra);
	expect(geriAlinmis).toBe(ZENGIN);
});

test("kaynakta yazılan belgeye dönüyor", async ({ page }) => {
	await page.locator("#kaynak").click();
	await kutu(page).fill("# Yepyeni\n\nBaşka bir metin.\n");
	await page.locator("#kaynak").click();

	await expect(page.locator("#editor > h1")).toHaveText("Yepyeni");
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
		"# Yepyeni\n\nBaşka bir metin.\n",
	);
});

test("kaynakta yapılan değişiklik tek Ctrl+Z ile geri alınıyor", async ({ page }) => {
	await page.locator("#kaynak").click();
	await kutu(page).fill("# Değişti\n");
	await page.locator("#kaynak").click();
	await page.keyboard.press("Control+z");
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(ZENGIN);
});

test("Türkçe karakterler kaynakta bozulmuyor", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setValue("ığüşöç İĞÜŞÖÇ\n"));
	await page.locator("#kaynak").click();
	expect(await kutu(page).inputValue()).toBe("ığüşöç İĞÜŞÖÇ\n");
	await page.locator("#kaynak").click();
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("ığüşöç İĞÜŞÖÇ\n");
});

test("salt okunur belgede kaynak da salt okunur", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setReadOnly(true));
	await page.locator("#kaynak").click();
	await expect(kutu(page)).toHaveAttribute("readonly", "");
});

test("kaynak kutusu adlandırılmış", async ({ page }) => {
	await page.locator("#kaynak").click();
	await expect(page.getByRole("textbox", { name: "Markdown kaynağı" })).toBeVisible();
});
