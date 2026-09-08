import { expect, test } from "@playwright/test";

/**
 * `@kalem/editor` — blok motoru  (İş listesi: F2-05)
 *
 * Editörün tamamı DOM davranışı: `contenteditable`, seçim, `input` olayı.
 * Bunların hiçbirinin taklidi güvenilir değil, o yüzden testler gerçek
 * tarayıcıda ve üç motorda birden koşuyor.
 *
 * Sayfa `apps/demo/editor.html`; kütüphaneyi derlenmiş bundle'dan yüklüyor.
 */

declare global {
	interface Window {
		kalem: {
			editor: {
				getValue(): string;
				getDocument(): { children: { type: string; id?: string }[] };
				setValue(markdown: string): void;
				setReadOnly(readOnly: boolean): void;
				destroy(): void;
			};
		};
	}
}

const BLOK = "#editor > [data-kalem-id]";

test.beforeEach(async ({ page }) => {
	await page.goto("/editor.html");
	await page.waitForFunction(() => "kalem" in window);
});

test.describe("render", () => {
	test("her üst düzey blok bir DOM elemanı", async ({ page }) => {
		const modelde = await page.evaluate(() => window.kalem.editor.getDocument().children.length);
		await expect(page.locator(BLOK)).toHaveCount(modelde);
	});

	test("blok tipleri doğru etikete gidiyor", async ({ page }) => {
		await expect(page.locator("#editor > h1")).toHaveText("Işık ve Gölge");
		await expect(page.locator("#editor > ul")).toHaveCount(2);
		await expect(page.locator("#editor > ol")).toHaveCount(1);
		await expect(page.locator("#editor > blockquote")).toHaveCount(1);
		await expect(page.locator("#editor > pre code.language-ts")).toContainText("new Editor");
		await expect(page.locator("#editor > hr")).toHaveCount(1);
	});

	test("her blok kendi düzenlenebilir alanı", async ({ page }) => {
		const durum = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#editor > [data-kalem-id]")).map((el) => ({
				tag: el.localName,
				editable: (el as HTMLElement).isContentEditable,
			})),
		);
		for (const blok of durum) {
			// Yatay çizginin içi yok; düzenlenebilir olması anlamsız.
			expect(blok.editable, blok.tag).toBe(blok.tag !== "hr");
		}
	});

	test("görev listesi kutuları durumu gösteriyor", async ({ page }) => {
		const kutular = page.locator("#editor .kalem-task input[type=checkbox]");
		await expect(kutular).toHaveCount(2);
		await expect(kutular.nth(0)).toBeChecked();
		await expect(kutular.nth(1)).not.toBeChecked();
	});
});

test.describe("yazma", () => {
	test("paragrafa yazmak modeli güncelliyor", async ({ page }) => {
		const paragraf = page.locator("#editor > p").first();
		await paragraf.click();
		// `Home` görsel satırın başına gider, bloğun değil — sarmalanmış
		// paragrafta yanlış yere yazar. Ctrl+A `contenteditable` içinde
		// yalnızca o bloğu seçer; en güvenilir "baştan yaz" yolu bu.
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.type("Işıldayan yeni paragraf");

		await expect(page.locator("#cikti")).toContainText("Işıldayan yeni paragraf");
		const value = await page.evaluate(() => window.kalem.editor.getValue());
		expect(value).toContain("Işıldayan yeni paragraf");
		// Komşu bloklar etkilenmemeli.
		expect(value).toContain("# Işık ve Gölge");
	});

	test("başlığa yazmak başlık olarak kalıyor", async ({ page }) => {
		const baslik = page.locator("#editor > h1");
		await baslik.click();
		await page.keyboard.press("End");
		await page.keyboard.type(" II");
		await expect(page.locator("#cikti")).toContainText("# Işık ve Gölge II");
	});

	test("kod bloğuna yazmak kodu güncelliyor", async ({ page }) => {
		const kod = page.locator("#editor > pre").first();
		await kod.click();
		await page.keyboard.press("End");
		await page.keyboard.type(" // not");
		await expect(page.locator("#cikti")).toContainText("// not");
		// Çit ve dil korunmalı.
		await expect(page.locator("#cikti")).toContainText("```ts");
	});

	/**
	 * Asıl mimari iddia: satır içi içerik DOM'dan okunurken **blok düzeyi
	 * yazım tercihleri** modelde kalıyor. Kullanıcı bir paragrafa harf
	 * eklediğinde listenin `*` işareti `-`ye dönmemeli.
	 */
	test("yazmak yazım tercihlerini bozmuyor", async ({ page }) => {
		await expect(page.locator("#tercih")).toHaveText("liste işareti: *");
		await page.locator("#editor > p").first().click();
		await page.keyboard.type("x");
		await expect(page.locator("#tercih")).toHaveText("liste işareti: *");
		await expect(page.locator("#cikti")).toContainText("* yıldız işareti korunuyor");
		await expect(page.locator("#cikti")).toContainText("1) parantez ayracı da öyle");
	});

	test("Türkçe karakterler bozulmuyor", async ({ page }) => {
		const paragraf = page.locator("#editor > p").first();
		await paragraf.click();
		await page.keyboard.press("Home");
		await page.keyboard.type("ığüşöç İĞÜŞÖÇ ");
		await expect(page.locator("#cikti")).toContainText("ığüşöç İĞÜŞÖÇ");
	});

	test("görev kutusuna tıklamak modeli güncelliyor", async ({ page }) => {
		await page.locator("#editor .kalem-task input[type=checkbox]").nth(1).click();
		await expect(page.locator("#cikti")).toContainText("- [x] Enter ile blok bölme");
	});
});

test.describe("yaşam döngüsü", () => {
	/**
	 * Değişmeyen bloğun DOM elemanı **aynı nesne** kalmalı. Kalmazsa imleç
	 * her tuşta başa kaçar ve IME bileşimi bozulur — bu testin ölçtüğü şey
	 * hedefli yamanın gerçekten hedefli olduğu.
	 */
	test("yazarken diğer blokların elemanları yeniden kurulmuyor", async ({ page }) => {
		const ayni = await page.evaluate(async () => {
			const bloklar = () => Array.from(document.querySelectorAll("#editor > [data-kalem-id]"));
			const once = bloklar();
			const h1 = once[0] as HTMLElement;
			h1.focus();
			// `input` olayını gerçek düzenleme gibi tetikle.
			h1.append(document.createTextNode("!"));
			h1.dispatchEvent(new Event("input", { bubbles: true }));
			await new Promise((r) => setTimeout(r, 0));
			const sonra = bloklar();
			return once.length === sonra.length && once.every((el, i) => el === sonra[i]);
		});
		expect(ayni).toBe(true);
	});

	test("setValue belgeyi değiştiriyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("# Yeni\n\nmetin\n"));
		await expect(page.locator(BLOK)).toHaveCount(2);
		await expect(page.locator("#editor > h1")).toHaveText("Yeni");
	});

	test("salt okunur modda yazılamıyor", async ({ page }) => {
		await page.locator("#saltOkunur").check();
		const editable = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#editor > [data-kalem-id]")).some(
				(el) => (el as HTMLElement).isContentEditable,
			),
		);
		expect(editable).toBe(false);
		await expect(page.locator("#editor")).toHaveAttribute("aria-readonly", "true");
	});

	test("destroy düzenlenebilirliği kaldırıyor, içeriği bırakıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.destroy());
		await expect(page.locator("#editor > h1")).toHaveText("Işık ve Gölge");
		const editable = await page.evaluate(() =>
			document.querySelector("#editor > h1")?.hasAttribute("contenteditable"),
		);
		expect(editable).toBe(false);
	});
});

test.describe("dil bağlamı", () => {
	/**
	 * `lang` süs değil: tarayıcı **yazım denetimi sözlüğünü** buna göre
	 * seçer. Türkçe belgeyi İngilizce sözlükle denetlemek her kelimeyi
	 * kırmızı yapar — F2-05'in kabul kriteri tam olarak bu.
	 */
	test("bloklar belge dilini miras alıyor", async ({ page }) => {
		await expect(page.locator("#editor")).toHaveAttribute("lang", "tr");
		const cozulen = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#editor > [data-kalem-id]")).map(
				(el) => el.closest("[lang]")?.getAttribute("lang") ?? null,
			),
		);
		expect(new Set(cozulen)).toEqual(new Set(["tr"]));
	});

	test("metin bloklarında yazım denetimi açık, kodda kapalı", async ({ page }) => {
		const durum = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#editor > [data-kalem-id]")).map((el) => ({
				tag: el.localName,
				spellcheck: (el as HTMLElement).spellcheck,
			})),
		);
		for (const blok of durum) {
			if (blok.tag === "pre") expect(blok.spellcheck, blok.tag).toBe(false);
			else if (blok.tag !== "hr") expect(blok.spellcheck, blok.tag).toBe(true);
		}
	});
});

test.describe("erişilebilirlik", () => {
	test("kapsayıcı çok satırlı metin kutusu olarak duyuruluyor", async ({ page }) => {
		await expect(page.locator("#editor")).toHaveAttribute("role", "textbox");
		await expect(page.locator("#editor")).toHaveAttribute("aria-multiline", "true");
	});
});
