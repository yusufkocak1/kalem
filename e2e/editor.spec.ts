import { expect, test } from "@playwright/test";
import { WORD_HTML, WORD_TEXT } from "./fixtures/word-clipboard.js";

/**
 * `@kalem-editor/editor` — blok motoru  (İş listesi: F2-05)
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
				selectBlocks(anchor: string, focus?: string): void;
				mergeBlocks(): boolean;
				canMergeBlocks(): boolean;
				setColor(color: string | null): boolean;
				getColor(): string | null;
				toggleMark(mark: string): boolean;
				setBlockType(target: { type: string }): boolean;
				isMarkActive(mark: string): boolean;
				setLink(url: string): boolean;
				setReadOnly(readOnly: boolean): void;
				undo(): boolean;
				redo(): boolean;
				canUndo(): boolean;
				canRedo(): boolean;
				destroy(): void;
				readonly plugins: readonly string[];
				addPlugin(plugin: unknown): void;
				removePlugin(name: string): boolean;
			};
		};
		kalemEditor: { inputRulesPlugin(): unknown };
	}
}

const BLOK = "#editor > [data-kalem-id]";

test.beforeEach(async ({ page }) => {
	// Sayfa hatalarını yakala.
	//
	// Bu olmadan bir modül yükleme hatası, aşağıdaki `waitForFunction`ın 30
	// saniyelik zaman aşımı olarak görünüyor ve gerçek sebep (örneğin
	// importmap eksiği) hiçbir yerde yazmıyor. Bir kez tam olarak bu oldu.
	const hatalar: string[] = [];
	page.on("pageerror", (hata) => hatalar.push(String(hata)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
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

	/**
	 * Tablo hücresine yazılan çıktıya giriyor — ve **yalnızca o satır**
	 * değişiyor.
	 *
	 * F4-03'te bulunan sessiz veri kaybı: hücreler düzenlenebilir çiziliyor,
	 * model güncelleniyordu ama serileştirici tabloyu ham metinden koşulsuz
	 * geri yazdığı için yazılan hiçbir şey çıktıya girmiyordu. Artık değişen
	 * satır yeniden üretiliyor, dokunulmayan satırlar ve sütun hizası
	 * olduğu gibi kalıyor.
	 */
	test("tablo hücresine yazmak çıktıya giriyor, öteki satırlar değişmiyor", async ({ page }) => {
		const md = "| Ad    | Yaş |\n|:------|----:|\n| Ali   |  30 |\n| Ayşe  |  25 |\n";
		await page.evaluate((m) => window.kalem.editor.setValue(m), md);

		// Satırlar doğrudan `<table>` altında (`render.ts`); ilki başlık.
		const hucre = page.locator("#editor table tr").nth(1).locator("td").first();
		await hucre.click();
		await page.keyboard.press("End");
		await page.keyboard.type("can");

		await expect(page.locator("#cikti")).toContainText("| Alican |  30 |");
		const value = await page.evaluate(() => window.kalem.editor.getValue());
		expect(value).toBe("| Ad    | Yaş |\n|:------|----:|\n| Alican |  30 |\n| Ayşe  |  25 |\n");
	});

	test("code block in a table cell turns the selection into inline code", async ({ page }) => {
		await page.evaluate(() =>
			window.kalem.editor.setValue("| Ad | Yaş |\n|----|-----|\n| Ali | 30 |\n"),
		);
		const hucre = page.locator("#editor table tr").nth(1).locator("td").first();
		await hucre.click();
		await page.keyboard.press("End");
		for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");

		expect(await page.evaluate(() => window.kalem.editor.setBlockType({ type: "code" }))).toBe(
			true,
		);
		const value = await page.evaluate(() => window.kalem.editor.getValue());
		expect(value).toContain("| `Ali` | 30 |");
		expect(await page.evaluate(() => window.kalem.editor.getDocument().children[0]?.type)).toBe(
			"table",
		);

		expect(await page.evaluate(() => window.kalem.editor.setBlockType({ type: "paragraph" }))).toBe(
			false,
		);
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(value);
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
			// Modelin değişmesi **beklenir**, sabit bir gecikmeyle tahmin
			// edilmez: tek bir makro görev, yüklü bir makinede editörün
			// `input` işleyicisinden önce bitebiliyor ve test o zaman
			// ölçmediği bir şeyi doğrulamış oluyordu.
			const bekle = Date.now() + 2000;
			while (!window.kalem.editor.getValue().includes("Gölge!") && Date.now() < bekle) {
				await new Promise((r) => setTimeout(r, 10));
			}
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

/**
 * Seçim modeli  (İş listesi: F2-06)
 *
 * `contenteditable` blok başına verildiği için (F2-05) seçim de ikiye
 * bölünüyor: tek blok içinde tarayıcı, bloklar arasında biz. Sınırın
 * doğru yerde olduğu ancak gerçek fare sürüklemesiyle ölçülebilir.
 */
test.describe("seçim", () => {
	/** İki blok elemanının üzerinden fareyle sürükler. */
	async function surukle(page: import("@playwright/test").Page, ilk: number, son: number) {
		const bloklar = page.locator(BLOK);
		const bas = await bloklar.nth(ilk).boundingBox();
		const bit = await bloklar.nth(son).boundingBox();
		if (bas === null || bit === null) throw new Error("blok kutusu ölçülemedi");
		await page.mouse.move(bas.x + 6, bas.y + bas.height / 2);
		await page.mouse.down();
		await page.mouse.move(bit.x + bit.width - 6, bit.y + bit.height / 2, { steps: 12 });
		await page.mouse.up();
	}

	test("tek blok içindeki seçim tarayıcıda kalıyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+a");
		await expect(page.locator("#secim")).toHaveText("metin (blok içi)");
		await expect(page.locator("#editor .kalem-selected")).toHaveCount(0);
	});

	test("bloklar arası sürükleme blok seçimi kuruyor", async ({ page }) => {
		await surukle(page, 0, 2);
		await expect(page.locator("#editor .kalem-selected")).toHaveCount(3);
		await expect(page.locator("#secim")).toHaveText("3 blok seçili");
		await expect(page.locator("#editor")).toHaveClass(/kalem-block-selecting/);
	});

	/** F2-06'nın kabul kriteri. */
	test("sürükleyerek seçilen bloklar Delete ile siliniyor", async ({ page }) => {
		const once = await page.locator(BLOK).count();
		await surukle(page, 0, 2);
		await expect(page.locator("#editor .kalem-selected")).toHaveCount(3);

		await page.keyboard.press("Delete");
		await expect(page.locator(BLOK)).toHaveCount(once - 3);
		// Silinen başlık ve ilk paragraf çıktıda kalmamalı.
		await expect(page.locator("#cikti")).not.toContainText("# Işık ve Gölge");
		await expect(page.locator("#editor .kalem-selected")).toHaveCount(0);
	});

	test("Backspace de aynı işi yapıyor", async ({ page }) => {
		const once = await page.locator(BLOK).count();
		await surukle(page, 1, 2);
		await page.keyboard.press("Backspace");
		await expect(page.locator(BLOK)).toHaveCount(once - 2);
	});

	test("silmeden sonra imleç bir önceki blokta", async ({ page }) => {
		await surukle(page, 1, 2);
		await page.keyboard.press("Delete");
		const odakta = await page.evaluate(
			() => document.activeElement?.getAttribute("data-kalem-id") ?? null,
		);
		const ilkId = await page.evaluate(() =>
			document.querySelector("#editor > [data-kalem-id]")?.getAttribute("data-kalem-id"),
		);
		expect(odakta).toBe(ilkId);
	});

	test("tüm belge silinince boş paragraf kalıyor", async ({ page }) => {
		const son = (await page.locator(BLOK).count()) - 1;
		await surukle(page, 0, son);
		await page.keyboard.press("Delete");
		// Bloksuz editöre tıklanacak yer kalmaz; yerine boş paragraf konuyor.
		await expect(page.locator(BLOK)).toHaveCount(1);
		await expect(page.locator("#editor > p")).toHaveCount(1);
	});

	test("selectBlocks API ile seçim kurulabiliyor", async ({ page }) => {
		const secili = await page.evaluate(() => {
			const id = (n: number) =>
				document.querySelectorAll("#editor > [data-kalem-id]")[n]?.getAttribute("data-kalem-id");
			window.kalem.editor.selectBlocks(id(0) as string, id(1) as string);
			return document.querySelectorAll("#editor .kalem-selected").length;
		});
		expect(secili).toBe(2);
	});

	test("salt okunur modda blok seçimi silinmiyor", async ({ page }) => {
		await page.locator("#saltOkunur").check();
		const once = await page.locator(BLOK).count();
		await surukle(page, 0, 2);
		await page.keyboard.press("Delete");
		await expect(page.locator(BLOK)).toHaveCount(once);
	});
});

/**
 * Satır içi biçimlendirme  (İş listesi: F2-07)
 *
 * Biçim **modelde** uygulanıyor: seçim karakter ofsetine çevriliyor,
 * `Inline[]` kesiliyor, `toggleMark`'tan geçiyor, blok yeniden basılıyor,
 * seçim geri konuyor. Buradaki testlerin ölçtüğü şey bu zincirin uçtan uca
 * çalıştığı — özellikle imlecin kaybolmadığı.
 */
test.describe("biçimlendirme", () => {
	/** İlk paragrafı sadeleştirip ilk `n` karakterini seçer. */
	async function secim(page: import("@playwright/test").Page, metin: string, n: number) {
		const paragraf = page.locator("#editor > p").first();
		await paragraf.click();
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.type(metin);
		await page.keyboard.press("ControlOrMeta+a");
		if (n < metin.length) {
			await page.keyboard.press("ArrowLeft");
			for (let i = 0; i < n; i++) await page.keyboard.press("Shift+ArrowRight");
		}
	}

	test("Ctrl+B seçili metni kalın yapıyor", async ({ page }) => {
		await secim(page, "kalın olacak", 5);
		await page.keyboard.press("ControlOrMeta+b");
		await expect(page.locator("#cikti")).toContainText("**kalın** olacak");
		await expect(page.locator("#editor > p strong").first()).toHaveText("kalın");
	});

	/** F2-07'nin kabul kriteri: tekrar basınca kalkıyor. */
	test("tekrar Ctrl+B kalınlığı kaldırıyor", async ({ page }) => {
		await secim(page, "kalın olacak", 5);
		await page.keyboard.press("ControlOrMeta+b");
		await expect(page.locator("#cikti")).toContainText("**kalın**");
		await page.keyboard.press("ControlOrMeta+b");
		await expect(page.locator("#cikti")).toContainText("kalın olacak");
		await expect(page.locator("#cikti")).not.toContainText("**kalın**");
	});

	/**
	 * Blok yeniden basıldığı için DOM düğümleri değişiyor; seçim karakter
	 * ofsetiyle geri kuruluyor. Kurulmazsa kullanıcı ikinci kez Ctrl+B'ye
	 * basamaz — kabul kriterinin görünmeyen yarısı bu.
	 */
	test("biçimden sonra seçim korunuyor", async ({ page }) => {
		await secim(page, "kalın olacak", 5);
		await page.keyboard.press("ControlOrMeta+b");
		const secili = await page.evaluate(() => window.getSelection()?.toString() ?? "");
		expect(secili).toBe("kalın");
	});

	test("Ctrl+I italik yapıyor", async ({ page }) => {
		await secim(page, "italik olacak", 6);
		await page.keyboard.press("ControlOrMeta+i");
		await expect(page.locator("#cikti")).toContainText("*italik* olacak");
	});

	test("Ctrl+E satır içi kod yapıyor", async ({ page }) => {
		await secim(page, "kod olacak", 3);
		await page.keyboard.press("ControlOrMeta+e");
		await expect(page.locator("#cikti")).toContainText("`kod` olacak");
	});

	test("Ctrl+Shift+X üstü çizili yapıyor", async ({ page }) => {
		await secim(page, "cizik olacak", 5);
		await page.keyboard.press("ControlOrMeta+Shift+x");
		await expect(page.locator("#cikti")).toContainText("~~cizik~~ olacak");
	});

	/** Markdown'da altı çizili yok; tarayıcı `<u>` üretmemeli. */
	test("Ctrl+U hiçbir şey yapmıyor", async ({ page }) => {
		await secim(page, "altcizgi olacak", 8);
		await page.keyboard.press("ControlOrMeta+u");
		await expect(page.locator("#editor u")).toHaveCount(0);
		await expect(page.locator("#cikti")).toContainText("altcizgi olacak");
	});

	test("araç çubuğu düğmesi de aynı işi yapıyor", async ({ page }) => {
		await secim(page, "dugme olacak", 5);
		await page.locator("[data-bicim=strong]").click();
		await expect(page.locator("#cikti")).toContainText("**dugme** olacak");
		await expect(page.locator("[data-bicim=strong]")).toHaveAttribute("aria-pressed", "true");
	});

	test("etkin biçimler seçime göre raporlanıyor", async ({ page }) => {
		await secim(page, "abc def", 3);
		await page.keyboard.press("ControlOrMeta+b");
		await expect(page.locator("#bicimler")).toHaveText("strong");
	});

	test("bağlantı kuruluyor", async ({ page }) => {
		await secim(page, "baglanti olacak", 8);
		await page.locator("#bag").click();
		await expect(page.locator("#cikti")).toContainText("[baglanti](https://ornek.com)");
		await expect(page.locator("#editor > p a").first()).toHaveAttribute(
			"href",
			"https://ornek.com",
		);
	});

	test("imleç varken biçim uygulanmıyor", async ({ page }) => {
		const paragraf = page.locator("#editor > p").first();
		await paragraf.click();
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.type("imlec");
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ControlOrMeta+b");
		await expect(page.locator("#cikti")).toContainText("imlec");
		await expect(page.locator("#cikti")).not.toContainText("****");
	});

	test("salt okunur modda biçim uygulanmıyor", async ({ page }) => {
		await secim(page, "salt okunur", 4);
		await page.locator("#saltOkunur").check();
		await page.keyboard.press("ControlOrMeta+b");
		await expect(page.locator("#cikti")).not.toContainText("**salt**");
	});

	test("Türkçe karakterlerde ofset kaymıyor", async ({ page }) => {
		await secim(page, "ışık ve gölge", 4);
		await page.keyboard.press("ControlOrMeta+b");
		await expect(page.locator("#cikti")).toContainText("**ışık** ve gölge");
	});
});

/**
 * Görsel tek karakterlik atomik öğe  (F4-01'de bulunan kalan iş)
 *
 * Görselin ofset uzunluğu 0'dı: imleç görselin iki yanında aynı ofsete
 * düşüyordu, yani kullanıcı görselin yanına imleç koyamıyor, onu
 * seçemiyor ve Backspace ile silemiyordu.
 */
test.describe("satır içi görsel", () => {
	// 1×1 saydam PNG; `data:image/png` beyaz listede.
	const PNG =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

	test.beforeEach(async ({ page }) => {
		await page.evaluate((png) => window.kalem.editor.setValue(`ab![g](${png})cd\n`), PNG);
		// Metnin sonuna, görselden iki karakter sonraya.
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("End");
	});

	/**
	 * Eski kodda kırmızı olan test bu. İmleç ve Backspace'i tarayıcı zaten
	 * doğru yapıyordu; kırık olan, seçimi **modelden** okuyan işlemlerdi:
	 * yalnızca görseli seçmek modelde 0 uzunluklu bir aralıktı ve Ctrl+B,
	 * bağlantı, kopyalama hiçbir şey yapmıyordu.
	 */
	test("yalnızca görseli seçip biçimlendirmek çalışıyor", async ({ page }) => {
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("Shift+ArrowLeft");
		await page.keyboard.press("ControlOrMeta+b");
		await expect
			.poll(() => page.evaluate(() => window.kalem.editor.getValue()))
			.toMatch(/^ab\*\*!\[g\]\(data:image\/png;base64,[^)]+\)\*\*cd\n$/);
	});

	test("görselin arkasında Backspace yalnızca görseli siliyor", async ({ page }) => {
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("Backspace");
		await expect.poll(() => page.evaluate(() => window.kalem.editor.getValue())).toBe("abcd\n");
	});

	test("görselin iki yanına yazılabiliyor", async ({ page }) => {
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.type("Y");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.type("X");
		await expect
			.poll(() => page.evaluate(() => window.kalem.editor.getValue()))
			.toMatch(/^abX!\[g\]\(data:image\/png;base64,[^)]+\)Ycd\n$/);
	});
});

/**
 * Klavye ve gezinme  (İş listesi: F2-08)
 *
 * Kabul kriteri "klavye ile fare kullanmadan tam doküman yazılabiliyor".
 * Aşağıdaki testler o cümleyi parçalarına ayırıyor; en sonda da baştan
 * sona klavyeyle bir belge yazan bir test var.
 */
test.describe("klavye", () => {
	/** Editörü boşaltıp tek bir paragrafla başlar. */
	async function bosla(page: import("@playwright/test").Page, metin = "") {
		await page.evaluate((m) => window.kalem.editor.setValue(m === "" ? "\n" : `${m}\n`), metin);
		const ilk = page.locator("#editor > p").first();
		await ilk.click();
		await page.keyboard.press("ControlOrMeta+a");
		if (metin !== "") await page.keyboard.press("ArrowRight");
		else await page.keyboard.press("Delete");
	}

	test("Enter paragrafı ikiye bölüyor", async ({ page }) => {
		await bosla(page, "abcdef");
		for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("Enter");
		await expect(page.locator("#cikti")).toHaveText("abc\n\ndef\n");
		await expect(page.locator("#editor > p")).toHaveCount(2);
	});

	test("Enter'dan sonra yazmak ikinci bloğa gidiyor", async ({ page }) => {
		await bosla(page, "abc");
		await page.keyboard.press("Enter");
		await page.keyboard.type("def");
		await expect(page.locator("#cikti")).toHaveText("abc\n\ndef\n");
	});

	test("Shift+Enter satır sonu ekliyor, blok bölmüyor", async ({ page }) => {
		await bosla(page, "abc");
		await page.keyboard.press("Shift+Enter");
		await page.keyboard.type("def");
		await expect(page.locator("#editor > p")).toHaveCount(1);
		// Ters bölülü satır sonu: iki boşluk görünmez ve kırpılınca kaybolur.
		await expect(page.locator("#cikti")).toHaveText("abc\\\ndef\n");
	});

	test("blok başında Backspace önceki blokla birleştiriyor", async ({ page }) => {
		await bosla(page, "abc");
		await page.keyboard.press("Enter");
		await page.keyboard.type("def");
		await page.keyboard.press("Home");
		await page.keyboard.press("Backspace");
		await expect(page.locator("#editor > p")).toHaveCount(1);
		await expect(page.locator("#cikti")).toHaveText("abcdef\n");
	});

	test("blok sonunda Delete sonraki bloğu çekiyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("abc\n\ndef\n"));
		await page.locator("#editor > p").first().click();
		// Ctrl+A + ArrowRight üç motorda farklı davranıyor (Firefox listede
		// tüm bloğu seçiyor, WebKit `<pre>` içinde başa dönüyor). Ctrl+End
		// doğrudan düzenleme kökünün sonuna gidiyor ve üçünde de aynı.
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.press("Delete");
		await expect(page.locator("#cikti")).toHaveText("abcdef\n");
	});

	test("liste maddesinde Enter yeni madde açıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("- bir\n"));
		await page.locator("#editor li").first().click();
		// Ctrl+A + ArrowRight üç motorda farklı davranıyor (Firefox listede
		// tüm bloğu seçiyor, WebKit `<pre>` içinde başa dönüyor). Ctrl+End
		// doğrudan düzenleme kökünün sonuna gidiyor ve üçünde de aynı.
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("iki");
		await expect(page.locator("#cikti")).toHaveText("- bir\n- iki\n");
	});

	test("boş maddede Enter listeden çıkarıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("- bir\n"));
		await page.locator("#editor li").first().click();
		// Ctrl+A + ArrowRight üç motorda farklı davranıyor (Firefox listede
		// tüm bloğu seçiyor, WebKit `<pre>` içinde başa dönüyor). Ctrl+End
		// doğrudan düzenleme kökünün sonuna gidiyor ve üçünde de aynı.
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Enter");
		await page.keyboard.type("düz");
		await expect(page.locator("#editor > ul")).toHaveCount(1);
		await expect(page.locator("#cikti")).toContainText("- bir");
		await expect(page.locator("#cikti")).toContainText("düz");
	});

	test("Tab liste maddesini içeri alıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("- bir\n- iki\n"));
		await page.locator("#editor li").nth(1).click();
		await page.keyboard.press("Tab");
		await expect(page.locator("#cikti")).toHaveText("- bir\n  - iki\n");
	});

	test("Shift+Tab maddeyi dışarı alıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("- bir\n  - ic\n"));
		await page.locator("#editor li li").first().click();
		await page.keyboard.press("Shift+Tab");
		await expect(page.locator("#cikti")).toHaveText("- bir\n- ic\n");
	});

	test("Ctrl+Alt+2 paragrafı başlığa çeviriyor", async ({ page }) => {
		await bosla(page, "başlık");
		await page.keyboard.press("ControlOrMeta+Alt+2");
		await expect(page.locator("#editor > h2")).toHaveText("başlık");
		await expect(page.locator("#cikti")).toHaveText("## başlık\n");
	});

	test("Ctrl+Alt+0 başlığı paragrafa döndürüyor", async ({ page }) => {
		await bosla(page, "metin");
		await page.keyboard.press("ControlOrMeta+Alt+3");
		await page.keyboard.press("ControlOrMeta+Alt+0");
		await expect(page.locator("#editor > p")).toHaveCount(1);
		await expect(page.locator("#cikti")).toHaveText("metin\n");
	});

	test("Ctrl+Shift+8 madde imli liste yapıyor", async ({ page }) => {
		await bosla(page, "madde");
		await page.keyboard.press("ControlOrMeta+Shift+8");
		await expect(page.locator("#cikti")).toHaveText("- madde\n");
	});

	test("Ctrl+Shift+7 numaralı liste yapıyor", async ({ page }) => {
		await bosla(page, "madde");
		await page.keyboard.press("ControlOrMeta+Shift+7");
		await expect(page.locator("#cikti")).toHaveText("1. madde\n");
	});

	test("ok tuşları bloklar arasında geziniyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir\n\niki\n\nüç\n"));
		await page.locator("#editor > p").first().click();
		const kimlik = () => page.evaluate(() => document.activeElement?.textContent ?? "");

		await page.keyboard.press("ArrowDown");
		expect(await kimlik()).toBe("iki");
		await page.keyboard.press("ArrowDown");
		expect(await kimlik()).toBe("üç");
		await page.keyboard.press("ArrowUp");
		expect(await kimlik()).toBe("iki");
	});

	test("kod bloğunda Enter blok bölmüyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("```\nbir\n```\n"));
		await page.locator("#editor > pre").click();
		// `<pre>` içinde Ctrl+End WebKit'te içeriği yutuyor; tek satırlık kod
		// için `End` zaten satırın sonuna götürüyor.
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("iki");
		await expect(page.locator("#editor > pre")).toHaveCount(1);
		await expect(page.locator("#cikti")).toContainText("bir\niki");
	});

	/** F2-08'in kabul kriteri: fareye hiç dokunmadan bir belge. */
	test("fare kullanmadan tam belge yazılabiliyor", async ({ page }) => {
		await bosla(page);
		await page.keyboard.type("Işık ve Gölge");
		await page.keyboard.press("ControlOrMeta+Alt+1");
		await page.keyboard.press("Enter");

		await page.keyboard.type("İlk paragraf.");
		await page.keyboard.press("Enter");

		await page.keyboard.press("ControlOrMeta+Shift+8");
		await page.keyboard.type("bir");
		await page.keyboard.press("Enter");
		await page.keyboard.type("iki");
		await page.keyboard.press("Tab");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Enter");

		await page.keyboard.type("Son paragraf.");

		const value = await page.evaluate(() => window.kalem.editor.getValue());
		expect(value).toContain("# Işık ve Gölge");
		expect(value).toContain("İlk paragraf.");
		expect(value).toContain("- bir");
		expect(value).toContain("  - iki");
		expect(value).toContain("Son paragraf.");
	});
});

/**
 * Geçmiş — geri al / yinele  (İş listesi: F2-09)
 *
 * Yığının kendisi birim testinde (`history.test.ts`). Buradaki testler
 * tarayıcı tarafını ölçüyor: kısayolların bağlanması, imlecin geri
 * gelmesi ve **tarayıcının kendi geri almasının** devre dışı kaldığı.
 */
test.describe("geçmiş", () => {
	async function tekBlok(page: import("@playwright/test").Page, metin: string) {
		await page.evaluate((m) => window.kalem.editor.setValue(`${m}\n`), metin);
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+End");
	}

	test("Ctrl+Z yazılanı geri alıyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.type("def");
		await expect(page.locator("#cikti")).toHaveText("abcdef\n");
		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#cikti")).toHaveText("abc\n");
	});

	test("Ctrl+Y geri alınanı yineliyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.type("def");
		await page.keyboard.press("ControlOrMeta+z");
		await page.keyboard.press("ControlOrMeta+y");
		await expect(page.locator("#cikti")).toHaveText("abcdef\n");
	});

	test("Ctrl+Shift+Z de yineliyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.type("def");
		await page.keyboard.press("ControlOrMeta+z");
		await page.keyboard.press("ControlOrMeta+Shift+z");
		await expect(page.locator("#cikti")).toHaveText("abcdef\n");
	});

	/** Harf harf geri alma kimsenin istediği şey değil. */
	test("hızlı yazma tek adımda geri alınıyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.type("defghi", { delay: 20 });
		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#cikti")).toHaveText("abc\n");
	});

	test("yapısal değişiklik geri alınıyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.press("Enter");
		await expect(page.locator("#editor > p")).toHaveCount(2);
		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#editor > p")).toHaveCount(1);
	});

	test("biçimlendirme geri alınıyor", async ({ page }) => {
		await tekBlok(page, "kalın");
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.press("ControlOrMeta+b");
		await expect(page.locator("#cikti")).toHaveText("**kalın**\n");
		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#cikti")).toHaveText("kalın\n");
	});

	test("geri aldıktan sonra yazmak ileri dalı atıyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.type("def");
		await page.keyboard.press("ControlOrMeta+z");
		await page.keyboard.type("xyz");
		await expect(page.locator("#ileri")).toBeDisabled();
		await expect(page.locator("#cikti")).toHaveText("abcxyz\n");
	});

	test("geri alma imleci de geri getiriyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.press("Enter");
		await page.keyboard.type("ikinci");
		await page.keyboard.press("ControlOrMeta+z");
		await page.keyboard.press("ControlOrMeta+z");
		// İmleç ilk bloğa dönmeli; yazmaya devam edilebilmeli.
		const odakMetni = await page.evaluate(() => document.activeElement?.textContent ?? "");
		expect(odakMetni).toBe("abc");
	});

	test("araç çubuğu düğmeleri de çalışıyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.type("def");
		await page.locator("#geri").click();
		await expect(page.locator("#cikti")).toHaveText("abc\n");
		await page.locator("#ileri").click();
		await expect(page.locator("#cikti")).toHaveText("abcdef\n");
	});

	test("setValue geçmişi sıfırlıyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.type("def");
		await page.evaluate(() => window.kalem.editor.setValue("yeni\n"));
		expect(await page.evaluate(() => window.kalem.editor.canUndo())).toBe(false);
	});

	test("salt okunur modda geri alma çalışmıyor", async ({ page }) => {
		await tekBlok(page, "abc");
		await page.keyboard.type("def");
		await page.locator("#saltOkunur").check();
		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#cikti")).toHaveText("abcdef\n");
	});
});

/**
 * Giriş kuralları — yazarken otomatik dönüşüm  (İş listesi: F2-10)
 *
 * Kuralların kendisi birim testinde (`input-rules.test.ts`). Buradaki
 * testler tuş dizisinden dönüşüme kadar olan zincirin gerçekten
 * kapandığını ve imlecin doğru yerde kaldığını ölçüyor.
 */
test.describe("giriş kuralları", () => {
	async function bosBelge(page: import("@playwright/test").Page) {
		await page.evaluate(() => window.kalem.editor.setValue(""));
		await page.locator("#editor > p").first().click();
	}

	test("`# ` başlık yapıyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("# Başlık");
		await expect(page.locator("#editor > h1")).toHaveText("Başlık");
		await expect(page.locator("#cikti")).toHaveText("# Başlık\n");
	});

	test("`### ` üçüncü seviye başlık yapıyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("### Alt");
		await expect(page.locator("#editor > h3")).toHaveText("Alt");
	});

	test("`- ` liste yapıyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("- madde");
		await expect(page.locator("#editor > ul li")).toHaveText("madde");
		await expect(page.locator("#cikti")).toHaveText("- madde\n");
	});

	/** Kullanıcının yazdığı işaret korunuyor. */
	test("`* ` yıldız işaretini koruyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("* madde");
		await expect(page.locator("#cikti")).toHaveText("* madde\n");
	});

	test("`1. ` numaralı liste yapıyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("1. madde");
		await expect(page.locator("#editor > ol li")).toHaveText("madde");
	});

	test("`> ` alıntı yapıyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("> söz");
		await expect(page.locator("#editor > blockquote")).toContainText("söz");
	});

	test("`**a**` kalın yapıyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("bir **iki**");
		await expect(page.locator("#editor > p strong")).toHaveText("iki");
		await expect(page.locator("#cikti")).toHaveText("bir **iki**\n");
	});

	test("`` `a` `` kod yapıyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("bir `kod`");
		await expect(page.locator("#editor > p code")).toHaveText("kod");
	});

	test("dönüşümden sonra yazmaya devam edilebiliyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("- madde");
		await page.keyboard.type(" devam");
		await expect(page.locator("#cikti")).toHaveText("- madde devam\n");
	});

	/**
	 * F2-10'un açık şartı: bir Ctrl+Z kuralı iptal eder, metni korur.
	 *
	 * "Bir kez" ifadesi **dönüşümün hemen ardından** demek. Araya yazı
	 * girerse ilk Ctrl+Z doğal olarak o yazıyı geri alır; kural iptali
	 * bir sonraki adımdadır.
	 */
	test("tek Ctrl+Z dönüşümü iptal edip metni bırakıyor", async ({ page }) => {
		await bosBelge(page);
		await page.keyboard.type("# ");
		await expect(page.locator("#editor > h1")).toHaveCount(1);

		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#editor > h1")).toHaveCount(0);
		// İşaret metinde kalmalı: kullanıcı yazdığını kaybetmemeli.
		await expect(page.locator("#cikti")).toContainText("#");
	});

	test("kod bloğu içinde kural çalışmıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("```\nx\n```\n"));
		await page.locator("#editor > pre").click();
		await page.keyboard.press("End");
		await page.keyboard.type(" # not");
		await expect(page.locator("#editor > pre")).toHaveCount(1);
		await expect(page.locator("#editor h1")).toHaveCount(0);
	});
});

/**
 * Kopyala / kes  (İş listesi: F2-11)
 *
 * Pano API'si tarayıcı izinlerine takılabildiği için testler `copy`/`cut`
 * olayını doğrudan tetikleyip `DataTransfer`'a yazılanı okuyor: ölçülen
 * şey tam olarak kullanıcının panosuna giden içerik.
 */
test.describe("pano", () => {
	/**
	 * `copy`/`cut` olayını tetikler ve editörün panoya **yazdığını** döndürür.
	 *
	 * Yazılan içerik `setData` gözlenerek okunuyor, `getData` ile değil:
	 * Firefox sentetik (güvenilmeyen) bir pano olayında `getData`'yı boş
	 * döndürüyor. Gözlemci üç motorda da çalışıyor ve ölçtüğü şey aynı —
	 * kullanıcının panosuna giden içerik.
	 */
	async function kopyala(page: import("@playwright/test").Page, tur: "copy" | "cut" = "copy") {
		return page.evaluate((olayAdi) => {
			const kayit: [string, string][] = [];
			const orijinal = DataTransfer.prototype.setData;
			DataTransfer.prototype.setData = function (tip: string, deger: string) {
				kayit.push([tip, deger]);
				return orijinal.call(this, tip, deger);
			};
			try {
				const olay = new ClipboardEvent(olayAdi, {
					clipboardData: new DataTransfer(),
					bubbles: true,
					cancelable: true,
				});
				// Olay kapsayıcıya gönderiliyor: dinleyici orada ve bloklar
				// arası seçimde odak editörün dışında olabiliyor.
				document.getElementById("editor")?.dispatchEvent(olay);
			} finally {
				DataTransfer.prototype.setData = orijinal;
			}
			const bul = (tip: string) => kayit.find(([t]) => t === tip)?.[1] ?? "";
			return { text: bul("text/plain"), html: bul("text/html") };
		}, tur);
	}

	test("blok içi seçim Markdown olarak kopyalanıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir **iki** üç\n"));
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+a");

		const pano = await kopyala(page);
		// Asıl kazanç: not defterine yapıştıran kullanıcı işaretleri görür.
		expect(pano.text).toBe("bir **iki** üç");
		expect(pano.html).toContain("<strong>iki</strong>");
	});

	test("kopyalanan HTML'de düzenleme öznitelikleri yok", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("# Başlık\n\nmetin\n"));
		await page.locator("#editor > h1").click();
		await page.keyboard.press("ControlOrMeta+a");
		const pano = await kopyala(page);
		expect(pano.html).not.toContain("data-kalem");
		expect(pano.html).not.toContain("contenteditable");
	});

	test("bloklar arası seçim yapısıyla kopyalanıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("# Başlık\n\n- bir\n- iki\n"));
		const secildi = await page.evaluate(() => {
			const bloklar = document.querySelectorAll("#editor > [data-kalem-id]");
			const id = (n: number) => bloklar[n]?.getAttribute("data-kalem-id") as string;
			window.kalem.editor.selectBlocks(id(0), id(1));
			return document.querySelectorAll("#editor .kalem-selected").length;
		});
		expect(secildi).toBe(2);

		const pano = await kopyala(page);
		expect(pano.text).toBe("# Başlık\n\n- bir\n- iki");
		expect(pano.html).toContain("<h1>Başlık</h1>");
		expect(pano.html).toContain("<ul>");
	});

	test("kesme kopyalayıp siliyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("silinecek\n"));
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+a");

		const pano = await kopyala(page, "cut");
		expect(pano.text).toBe("silinecek");
		await expect(page.locator("#cikti")).toHaveText("\n");
	});

	test("bloklar arası kesme blokları siliyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir\n\niki\n\nüç\n"));
		await page.evaluate(() => {
			const bloklar = document.querySelectorAll("#editor > [data-kalem-id]");
			const id = (n: number) => bloklar[n]?.getAttribute("data-kalem-id") as string;
			window.kalem.editor.selectBlocks(id(0), id(1));
		});
		await kopyala(page, "cut");
		await expect(page.locator(BLOK)).toHaveCount(1);
		await expect(page.locator("#cikti")).toHaveText("üç\n");
	});

	test("kesme geri alınabiliyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("silinecek\n"));
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+a");
		await kopyala(page, "cut");
		await page.keyboard.press("ControlOrMeta+z");
		await expect(page.locator("#cikti")).toHaveText("silinecek\n");
	});

	test("salt okunur modda kesme silmiyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("kalacak\n"));
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+a");
		await page.locator("#saltOkunur").check();
		await kopyala(page, "cut");
		await expect(page.locator("#cikti")).toHaveText("kalacak\n");
	});
});

/**
 * Eklenti sistemi  (İş listesi: F2-12)
 *
 * F2-12'nin kabul kriteri: **çekirdek bir özellik eklenti olarak
 * çıkarılıp tekrar takılabiliyor.** Giriş kuralları ve görev listesi
 * davranışı gerçekten eklentiye taşındı; aşağıdaki testler kaldırınca
 * davranışın kaybolduğunu, geri ekleyince döndüğünü ölçüyor.
 */
test.describe("eklentiler", () => {
	test("yerleşik eklentiler varsayılan olarak kayıtlı", async ({ page }) => {
		const adlar = await page.evaluate(() => window.kalem.editor.plugins);
		// Demo sayfası `mountUi` çağırıyor; arayüz katmanı kendi kısayollarını
		// da eklenti olarak kaydediyor: Ctrl+K (F3-02) ve Ctrl+Shift+↑/↓ ile
		// blok taşıma (F3-04). Görsel yükleme (F4-01), kod vurgulama (F4-02),
		// F4-01…F4-07 eklentileri demo tarafından ayrıca kaydediliyor. Sıra
		// kayıt sırası — çakışma kuralı o.
		expect(adlar).toEqual([
			"input-rules",
			"task-list",
			"ui-link-shortcut",
			"ui-block-move",
			"image-upload",
			"code-highlight",
			"find-replace",
			"outline",
			"word-count",
			"source-mode",
			"autosave",
		]);
	});

	test("giriş kuralı eklentisi kaldırılınca dönüşüm duruyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalem.editor.setValue("");
			window.kalem.editor.removePlugin("input-rules");
		});
		await page.locator("#editor > p").first().click();
		await page.keyboard.type("# Başlık");
		await expect(page.locator("#editor > h1")).toHaveCount(0);
		await expect(page.locator("#cikti")).toContainText("# Başlık");
	});

	test("geri eklenince dönüşüm dönüyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalem.editor.removePlugin("input-rules");
			window.kalem.editor.addPlugin(window.kalemEditor.inputRulesPlugin());
			window.kalem.editor.setValue("");
		});
		await page.locator("#editor > p").first().click();
		await page.keyboard.type("# Başlık");
		await expect(page.locator("#editor > h1")).toHaveText("Başlık");
	});

	test("görev listesi eklentisi kaldırılınca kutu modeli değiştirmiyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.removePlugin("task-list"));
		await page.locator("#editor .kalem-task input[type=checkbox]").nth(1).click();
		await expect(page.locator("#cikti")).toContainText("- [ ] Enter ile blok bölme");
	});

	test("aynı ad iki kez kaydedilemiyor", async ({ page }) => {
		const hata = await page.evaluate(() => {
			try {
				window.kalem.editor.addPlugin(window.kalemEditor.inputRulesPlugin());
				return null;
			} catch (e) {
				return String(e);
			}
		});
		expect(hata).toContain("already registered");
	});

	test("özel eklenti tuşu çekirdekten önce yakalıyor", async ({ page }) => {
		await page.evaluate(() => {
			window.kalem.editor.setValue("abc\n");
			window.kalem.editor.addPlugin({
				name: "test-kisayol",
				keymap: (event, ctx) => {
					if (!event.ctrlKey || event.key !== "b") return false;
					ctx.applyEdit({
						doc: { ...ctx.getDocument(), children: [] },
						caret: { blockIndex: 0, path: [], offset: 0 },
					});
					return true;
				},
			});
		});
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.press("Control+b");
		// Çekirdek Ctrl+B kalın yapardı; eklenti onu tüketti.
		await expect(page.locator("#cikti")).not.toContainText("**");
	});
});

test.describe("blok birleştirme", () => {
	const value = (page: import("@playwright/test").Page) =>
		page.evaluate(() => window.kalem.editor.getValue());

	const selectBlocks = (page: import("@playwright/test").Page, first: number, last: number) =>
		page.evaluate(
			([a, b]) => {
				const ids = window.kalem.editor.getDocument().children.map((block) => block.id as string);
				window.kalem.editor.selectBlocks(ids[a as number] as string, ids[b as number] as string);
			},
			[first, last],
		);

	test("seçili bloklar tek blokta birleşiyor ve geri alınabiliyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir\n\niki\n\nüç\n\ndört\n"));
		await selectBlocks(page, 0, 2);
		expect(await page.evaluate(() => window.kalem.editor.canMergeBlocks())).toBe(true);
		expect(await page.evaluate(() => window.kalem.editor.mergeBlocks())).toBe(true);
		expect(await value(page)).toBe("bir\\\niki\\\nüç\n\ndört\n");
		await expect(page.locator(BLOK)).toHaveCount(2);

		// The caret lands where the first block ended.
		await page.keyboard.type("X");
		expect(await value(page)).toBe("birX\\\niki\\\nüç\n\ndört\n");
		await page.keyboard.press("ControlOrMeta+z");
		await page.keyboard.press("ControlOrMeta+z");
		expect(await value(page)).toBe("bir\n\niki\n\nüç\n\ndört\n");
	});

	test("imleç varken blok üsttekiyle birleşiyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("bir\n\niki\n"));
		await page.locator(BLOK).nth(1).click();
		expect(await page.evaluate(() => window.kalem.editor.mergeBlocks())).toBe(true);
		expect(await value(page)).toBe("bir\\\niki\n");

		await page.locator(BLOK).first().click();
		expect(await page.evaluate(() => window.kalem.editor.canMergeBlocks())).toBe(false);
		expect(await page.evaluate(() => window.kalem.editor.mergeBlocks())).toBe(false);
	});

	test("paragraflar kod bloğuna satır olarak giriyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("```\na\n```\n\nb\n\nc\n"));
		await selectBlocks(page, 0, 2);
		expect(await page.evaluate(() => window.kalem.editor.mergeBlocks())).toBe(true);
		expect(await value(page)).toBe("```\na\nb\nc\n```\n");
		await expect(page.locator("#editor > pre")).toHaveCount(1);
	});

	test("birleşemeyen bloklar olduğu gibi kalıyor", async ({ page }) => {
		const source = "bir\n\n| a |\n| --- |\n| b |\n";
		await page.evaluate((markdown) => window.kalem.editor.setValue(markdown), source);
		await selectBlocks(page, 0, 1);
		expect(await page.evaluate(() => window.kalem.editor.canMergeBlocks())).toBe(false);
		expect(await page.evaluate(() => window.kalem.editor.mergeBlocks())).toBe(false);
		expect(await value(page)).toBe(source);
	});
});

test.describe("yazı rengi", () => {
	const value = (page: import("@playwright/test").Page) =>
		page.evaluate(() => window.kalem.editor.getValue());

	test("seçili metin renkleniyor ve renk kaldırılabiliyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("abc def\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.keyboard.press("End");
		for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
		expect(await page.evaluate(() => window.kalem.editor.setColor("#e03131"))).toBe(true);
		expect(await value(page)).toBe('abc <span style="color:#e03131">def</span>\n');
		await expect(page.locator("#editor [data-kalem-color]")).toHaveCSS("color", "rgb(224, 49, 49)");
		expect(await page.evaluate(() => window.kalem.editor.getColor())).toBe("#e03131");

		await page.keyboard.press("ControlOrMeta+b");
		expect(await value(page)).toBe('abc <span style="color:#e03131">**def**</span>\n');
		await page.keyboard.press("ControlOrMeta+b");
		expect(await value(page)).toBe('abc <span style="color:#e03131">def</span>\n');

		expect(await page.evaluate(() => window.kalem.editor.setColor(null))).toBe(true);
		expect(await value(page)).toBe("abc def\n");
	});

	test("renkli metnin içine yazılan metin rengi koruyor", async ({ page }) => {
		await page.evaluate(() =>
			window.kalem.editor.setValue('<span style="color:red">abc</span> def\n'),
		);
		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.keyboard.press("Home");
		await page.keyboard.press("ArrowRight");
		await page.keyboard.type("X");
		expect(await value(page)).toBe('<span style="color:red">aXbc</span> def\n');
		await page.keyboard.press("ControlOrMeta+z");
		expect(await value(page)).toBe('<span style="color:red">abc</span> def\n');
	});

	test("seçim yokken renk uygulanmıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("abc\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		expect(await page.evaluate(() => window.kalem.editor.setColor("red"))).toBe(false);
		expect(await value(page)).toBe("abc\n");
	});
});

/**
 * Yapıştırma boru hattı  (İş listesi: F3-07)
 *
 * Birim testleri kaynak tespitini ve yerleştirmeyi sabitliyor; burada
 * ölçülen, `paste` olayının gerçekten boru hattına bağlandığı ve
 * tarayıcının kendi yapıştırmasının devreye girmediği.
 *
 * Firefox sentetik bir `paste` olayında `clipboardData`yı okutmuyor
 * (F2-11 ve F3-02'de aynı kısıt); gerçek pano izni yalnızca Chromium'da
 * veriliyor. Ölçülemeyen şey davranış değil, sentetik olayın
 * okunabilirliği.
 */
test.describe("yapıştırma", () => {
	/** Editöre sentetik bir yapıştırma olayı gönderir. */
	async function yapistir(
		page: import("@playwright/test").Page,
		veri: { html?: string; text?: string },
	) {
		await page.evaluate((d) => {
			const dt = new DataTransfer();
			if (d.html !== undefined) dt.setData("text/html", d.html);
			if (d.text !== undefined) dt.setData("text/plain", d.text);
			document
				.getElementById("editor")
				?.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
				);
		}, veri);
	}

	/** İmleci ilk bloğun sonuna koyar. */
	async function imlecSona(page: import("@playwright/test").Page) {
		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.keyboard.press("End");
	}

	test.beforeEach(async ({ browserName }) => {
		test.skip(browserName === "firefox", "Firefox sentetik paste verisini okutmuyor");
	});

	test("düz metin satır içi ekleniyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("abcd\n"));
		await imlecSona(page);
		await yapistir(page, { text: "XY" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("abcdXY\n");
	});

	test("Markdown metni yapısıyla geliyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		await yapistir(page, { text: "# Başlık\n\nmetin\n" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("# Başlık\n\nmetin\n");
	});

	test("kod bloğuna yapıştırılan metin koda giriyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("```\nbir\n```\n"));
		await page.locator("#editor > pre").click();
		await page.keyboard.press("End");
		await yapistir(page, {
			html: "<p><b>iki</b></p><p># üç</p>",
			text: "\r\niki\r\n# üç",
		});
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"```\nbir\niki\n# üç\n```\n",
		);
		await page.keyboard.type("!");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"```\nbir\niki\n# üç!\n```\n",
		);
	});

	test("kod bloğunda seçili metin yapıştırılanla değişiyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("```\nbir\n```\n"));
		await page.locator("#editor > pre").click();
		await page.keyboard.press("End");
		await page.keyboard.press("Shift+Home");
		await yapistir(page, { text: "iki" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("```\niki\n```\n");
		await page.keyboard.press("ControlOrMeta+z");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("```\nbir\n```\n");
	});

	/** `2 * 3 * 4` yazan kullanıcının metni bozulmamalı. */
	test("Markdown'a benzemeyen metin olduğu gibi kalıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		await yapistir(page, { text: "2 * 3 * 4" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("2 * 3 * 4\n");
	});

	/** Tarayıcının kendi yapıştırması devreye girerse DOM'a ham HTML sızar. */
	test("HTML modele giriyor, DOM'a değil", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		await yapistir(page, { html: "<p>bir <b>kalın</b></p><p>iki</p>", text: "bir kalın\niki" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe(
			"bir **kalın**\n\niki\n",
		);
		// Word'ün stil öznitelikleri DOM'da hiç görünmemeli.
		expect(await page.locator("#editor").innerHTML()).not.toContain("style=");
	});

	test("seçili metnin yerine geçiyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("abcd\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.keyboard.press("ControlOrMeta+a");
		await yapistir(page, { text: "yeni" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("yeni\n");
	});

	test("yapıştırma tek Ctrl+Z ile geri alınıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("abcd\n"));
		await imlecSona(page);
		await yapistir(page, { text: "XY" });
		await page.keyboard.press("ControlOrMeta+z");
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("abcd\n");
	});

	test("Ctrl+Shift+V biçimi atıyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.keyboard.press("ControlOrMeta+Shift+v");
		await yapistir(page, { html: "<p>bir <b>kalın</b></p>", text: "bir kalın" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("bir kalın\n");
	});

	/** Bayrak tek seferlik: sonraki yapıştırma yeniden biçimli. */
	test("biçimsiz yapıştırma kalıcı değil", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.keyboard.press("ControlOrMeta+Shift+v");
		await yapistir(page, { html: "<p>bir</p>", text: "bir" });
		await yapistir(page, { html: "<p><b>iki</b></p>", text: "iki" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toContain("**iki**");
	});

	test("salt okunur modda yapıştırma yok", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setValue("abcd\n"));
		await page.evaluate(() => window.kalem.editor.setReadOnly(true));
		await yapistir(page, { text: "XY" });
		expect(await page.evaluate(() => window.kalem.editor.getValue())).toBe("abcd\n");
	});
});

/**
 * F3-07'nin kabul kriteri  (İş listesi)
 *
 * > "Word'den kopyalanan 3 sayfalık biçimli doküman doğru yapıya
 * > dönüşüyor."
 *
 * Playwright'a Word kurulamıyor. Ölçülebilen ve aslında ölçülmesi gereken
 * şey, Word'ün **panoya yazdığı HTML'in** doğru işlenmesi;
 * `fixtures/word-clipboard.ts` o çıktının yapısını birebir taşıyor.
 * Taklit olduğu orada da yazıyor.
 */
test.describe("Word belgesi yapıştırma", () => {
	test.beforeEach(async ({ page, browserName }) => {
		test.skip(browserName === "firefox", "Firefox sentetik paste verisini okutmuyor");
		await page.evaluate(() => window.kalem.editor.setValue("\n"));
		await page.locator("#editor > [data-kalem-id]").first().click();
		await page.evaluate(
			([html, text]) => {
				const dt = new DataTransfer();
				dt.setData("text/html", html as string);
				dt.setData("text/plain", text as string);
				document
					.getElementById("editor")
					?.dispatchEvent(
						new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
					);
			},
			[WORD_HTML, WORD_TEXT],
		);
	});

	const cikti = (page: import("@playwright/test").Page) =>
		page.evaluate(() => window.kalem.editor.getValue());

	test("başlık hiyerarşisi korunuyor", async ({ page }) => {
		const md = await cikti(page);
		expect(md).toContain("# Yıllık Değerlendirme");
		expect(md).toContain("## Başarılar");
		expect(md).toContain("## Öncelikler");
		expect(md).toContain("### Bütçe");
	});

	test("stille verilen biçimler taşınıyor", async ({ page }) => {
		const md = await cikti(page);
		// Fixture'da `<b>` içeriği iki satıra yayılıyor; HTML'de satır sonu
		// boşluktur ve normalleştirme onu tek boşluğa indiriyor.
		expect(md).toContain("**öne çıkan başlıklarını**");
		expect(md).toContain("*planını*");
	});

	/** Word `<ul>` üretmiyor; listeler `mso-list` paragraflarından kuruluyor. */
	test("sahte listeler gerçek listeye dönüşüyor", async ({ page }) => {
		const md = await cikti(page);
		expect(md).toContain("- Gelirde artış");
		expect(md).toContain("- Müşteri memnuniyeti");
		expect(md).toContain("- Yeni pazarlar");
	});

	test("iç içe liste seviyesi korunuyor", async ({ page }) => {
		expect(await cikti(page)).toContain("  - Destek süresi kısaldı");
	});

	test("numaralı liste sıralı kalıyor", async ({ page }) => {
		const md = await cikti(page);
		expect(md).toContain("1. Altyapı yenileme");
		expect(md).toContain("2. Ekip büyütme");
	});

	/** Madde imi kullanıcının metni değil. */
	test("madde imleri metne karışmıyor", async ({ page }) => {
		const md = await cikti(page);
		expect(md).not.toContain("·");
		expect(md).not.toContain("o\u00a0");
	});

	test("bağlantı korunuyor", async ({ page }) => {
		expect(await cikti(page)).toContain("[rapor sayfasında](https://ornek.com/rapor)");
	});

	test("tablo tablo olarak geliyor", async ({ page }) => {
		const md = await cikti(page);
		expect(md).toContain("Kalem");
		expect(md).toContain("1.200.000");
		expect(md).toContain("|");
	});

	/** Word'ün çöpü çıktıya sızmamalı. */
	test("mso stilleri ve o:p etiketleri düşüyor", async ({ page }) => {
		const md = await cikti(page);
		expect(md).not.toContain("mso-");
		expect(md).not.toContain("o:p");
		expect(md).not.toContain("MsoNormal");
		expect(md).not.toContain("Calibri");
	});

	test("gizli style bloğu içeriğe girmiyor", async ({ page }) => {
		const md = await cikti(page);
		expect(md).not.toContain("font-face");
		expect(md).not.toContain("panose");
	});

	test("DOM'a ham Word biçimlemesi sızmıyor", async ({ page }) => {
		const html = await page.locator("#editor").innerHTML();
		expect(html).not.toContain("mso-");
		expect(html).not.toContain("MsoNormal");
	});

	/** Yapıştırmanın tamamı tek geçmiş adımı olmalı. */
	test("tek Ctrl+Z ile tamamı geri alınıyor", async ({ page }) => {
		await page.keyboard.press("ControlOrMeta+z");
		// Boş belgenin Markdown karşılığı boş dize: tek boş paragraf hiçbir
		// karakter üretmiyor.
		expect(await cikti(page)).toBe("");
	});
});
