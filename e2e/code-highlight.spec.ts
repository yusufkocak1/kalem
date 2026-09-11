import { expect, test } from "@playwright/test";

/**
 * `@kalem/plugin-code-highlight`  (İş listesi: F4-02)
 *
 * Birim testleri belirteçleyicinin doğruluğunu sabitliyor; burada ölçülen
 * gerçek tarayıcıda **tembel yüklemenin** çalıştığı, boyamanın belgeyi
 * bozmadığı ve kullanıcı kod bloğunun içinde yazarken imlecin yerinde
 * kaldığı.
 *
 * Kabul kriteri ("kullanılmadığında ana bundle'a 0 byte") bir boyut
 * iddiası; onu `size-limit` ölçüyor (`.size-limit.json`). Burada aynı
 * iddianın çalışma zamanı tarafı sınanıyor: dil paketi ayrı bir ağ isteği
 * olarak, yalnızca o dil belgede geçtiğinde iniyor.
 */

declare global {
	interface Window {
		kalem: {
			editor: {
				getValue(): string;
				setValue(md: string): void;
				focus(): void;
			};
			kodEklentisi: { refresh(): void; whenIdle(): Promise<void> };
		};
	}
}

const KOD = ["```js", "const x = 1; // not", "```", ""].join("\n");

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
});

/** Belgeyi kurar ve gramerin yüklenmesini bekler. */
async function yaz(page: import("@playwright/test").Page, md: string) {
	await page.evaluate((kaynak) => {
		window.kalem.editor.setValue(kaynak);
	}, md);
	await page.evaluate(() => window.kalem.kodEklentisi.whenIdle());
}

test("kod bloğu belirteçlere bölünüyor", async ({ page }) => {
	await yaz(page, KOD);
	const kod = page.locator("#editor pre code");
	await expect(kod.locator(".kalem-tok-keyword")).toHaveText("const");
	await expect(kod.locator(".kalem-tok-number")).toHaveText("1");
	await expect(kod.locator(".kalem-tok-comment")).toHaveText("// not");
});

test("belirteçlerin rengi temadan geliyor", async ({ page }) => {
	await yaz(page, KOD);
	const kod = page.locator("#editor pre code");
	// Bloğun kendi rengiyle aynı olsaydı `plugin-code.css` hiç
	// uygulanmamış, yani boyama görünmüyor olurdu.
	expect(
		await kod.locator(".kalem-tok-keyword").evaluate((el) => getComputedStyle(el).color),
	).not.toBe(await kod.evaluate((el) => getComputedStyle(el).color));
});

test("vurgulama Markdown çıktısını değiştirmiyor", async ({ page }) => {
	await yaz(page, KOD);
	// Asıl güvence bu: süsleme DOM'da, model temiz.
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(KOD);
});

test("dil paketi ayrı bir istek olarak ve yalnızca gerekince iniyor", async ({ page }) => {
	const inenler: string[] = [];
	page.on("request", (istek) => {
		const yol = new URL(istek.url()).pathname;
		if (yol.includes("/plugin-code-highlight/langs/")) inenler.push(yol);
	});

	// Demo açılışta bir `ts` bloğu taşıyor, yani JavaScript grameri sayfa
	// yüklenirken inmiş oluyor. Aynı dili tekrar yazmak yeni bir istek
	// üretmiyor: gramer önbellekte.
	await yaz(page, KOD);
	expect(inenler).toEqual([]);

	// `expect.poll`: `request` olayı test sürecine ağ isteğinden **sonra**
	// ulaşıyor ve WebKit'te bu gecikme `whenIdle`ın ötesine taşabiliyor.
	// Beklenen liste yine tam — yalnızca varışı bekleniyor.
	await yaz(page, '```json\n{"a": 1}\n```\n');
	await expect.poll(() => inenler).toEqual(["/@kalem/plugin-code-highlight/langs/json.js"]);
	await expect(page.locator("#editor pre code .kalem-tok-property")).toHaveText('"a"');

	// Belgede geçmeyen diller hiç inmiyor — kabul kriterinin çalışma
	// zamanı tarafı.
	await yaz(page, '```json\n{"a": 1}\n```\n\n```sql\nSELECT 1\n```\n');
	await expect
		.poll(() => inenler)
		.toEqual([
			"/@kalem/plugin-code-highlight/langs/json.js",
			"/@kalem/plugin-code-highlight/langs/sql.js",
		]);
});

test("bilinmeyen dil boyanmadan kalıyor, hata vermiyor", async ({ page }) => {
	await yaz(page, "```klingon\nnuqneH\n```\n");
	const kod = page.locator("#editor pre code");
	await expect(kod).toHaveText("nuqneH");
	await expect(kod.locator("span")).toHaveCount(0);
	await expect(page.locator("#kodHata")).toHaveText("—");
});

test("yazarken imleç yerinde kalıyor", async ({ page }) => {
	await yaz(page, KOD);
	const kod = page.locator("#editor pre code");

	// İmleci `const` ile boşluğun arasına koy: boyama DOM'u baştan
	// kurduğu için imleç korunmazsa yazılan harf başka yere düşer.
	await kod.click();
	await page.evaluate(() => {
		const el = document.querySelector("#editor pre code");
		const aralik = document.createRange();
		const yurutec = document.createTreeWalker(el as Node, NodeFilter.SHOW_TEXT);
		const ilk = yurutec.nextNode() as Text;
		aralik.setStart(ilk, 5);
		aralik.collapse(true);
		const secim = document.getSelection();
		secim?.removeAllRanges();
		secim?.addRange(aralik);
	});
	await page.keyboard.type("X");
	await page.evaluate(() => window.kalem.kodEklentisi.whenIdle());

	await expect(kod).toHaveText("constX x = 1; // not");
	// Harf eklendikten sonra `constX` artık anahtar sözcük değil.
	await expect(kod.locator(".kalem-tok-keyword")).toHaveCount(0);
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toContain("constX x = 1;");
});

test("satır sonu boyamada kaybolmuyor", async ({ page }) => {
	await yaz(page, ["```js", "const a = 1;", "const b = 2;", "```", ""].join("\n"));
	const kod = page.locator("#editor pre code");
	expect(await kod.evaluate((el) => el.textContent)).toContain("\n");
	expect(await page.evaluate(() => window.kalem.editor.getValue())).toContain(
		"const a = 1;\nconst b = 2;",
	);
});
