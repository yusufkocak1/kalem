import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

declare global {
	interface Window {
		kalem: {
			editor: { setValue(md: string): void; setReadOnly(v: boolean): void };
		};
	}
}

/**
 * Editör ve arayüz — erişilebilirlik geçişi  (İş listesi: F3-10)
 *
 * ## Ne ölçülüyor, ne ölçülmüyor
 *
 * axe, WCAG ihlallerinin **otomatik saptanabilir olan kısmını** yakalıyor;
 * "axe temiz" ile "erişilebilir" aynı şey değil. Bu dosyanın iddiası dar:
 * *editörün ve arayüzün ürettiği işaretleme, her durumda otomatik olarak
 * saptanabilir bir WCAG 2.1 A/AA ihlali içermiyor.* Yanına klavye
 * gezinmesi, odak yönetimi ve canlı bölge duyuruları elle yazılmış
 * testlerle ekleniyor — onları axe göremiyor.
 *
 * **Ekran okuyucuyla elle test (NVDA/VoiceOver) yapılmadı.** Otomatik
 * araçlarla ölçülemeyen tek şey o ve iş listesinde açık bırakıldı.
 *
 * ## Neden durum durum taranıyor
 *
 * Arayüzün çoğu ancak bir etkileşimden **sonra** var oluyor: balon
 * seçimle, slash menü `/` ile, blok menüsü tutamaçla. Yalnızca açılış
 * ekranını taramak, arayüzün büyük kısmını hiç görmemek demek.
 */

const KAPSAMLI = `# Ana başlık

Paragraf, **kalın**, *italik*, ~~üstü çizili~~, \`kod\` ve
[bağlantı](https://ornek.com).

## İkinci seviye

- madde
- ikinci madde
  - iç madde

1. sıralı
2. ikinci

- [x] biten görev
- [ ] duran görev

> Alıntı bloğu.

\`\`\`ts
const kok = parse(md);
\`\`\`

| Sütun | Sayı |
| :-- | --: |
| bir | 1 |

---

Son paragraf.
`;

/**
 * Tarama kapsamı.
 *
 * Demo sayfasının kabuğu (başlık, ölçüm kartları) kütüphanenin ürünü
 * değil; onun kusurları buraya yazılmamalı. Yüzen parçalar `<body>`
 * altında durduğu için ayrıca kapsanıyor.
 */
const KAPSAM = [
	"#editor",
	".kalem-toolbar",
	".kalem-bubble",
	".kalem-menu",
	".kalem-slash",
	".kalem-handle",
	".kalem-live",
];

/**
 * Bilerek kabul edilen **tek** axe bulgusu.
 *
 * `scrollable-region-focusable`, kaydırılabilir her bölgenin ya kendisinin
 * sekme sırasında olmasını ya da sekmelenebilir içerik taşımasını istiyor.
 * Slash menüsünün listesi kaydırmalı (`max-height`) ama ikisi de olamaz:
 * menü açıkken kullanıcı **yazmaya devam ediyor** (`/bas` ile filtreliyor),
 * yani odak editörde kalmak zorunda. Seçili öğe `aria-activedescendant`
 * ile bildiriliyor — ARIA APG'nin açılır liste için önerdiği desen bu.
 *
 * Kuralın koruduğu asıl şey (*klavye kullanıcısı listenin tamamına
 * erişebiliyor mu*) sağlanıyor: ok tuşları seçimi gezdiriyor ve seçili öğe
 * görünür alana kaydırılıyor. Bunu axe göremediği için aşağıda ayrı bir
 * test ölçüyor.
 *
 * İstisna **dar**: yalnızca bu kural, yalnızca bu eleman. Aynı elemanda
 * başka bir ihlal çıkarsa test yine kırmızıya döner.
 */
function kabulEdilen(ihlal: { id: string; nodes: readonly { target: unknown[] }[] }): boolean {
	return (
		ihlal.id === "scrollable-region-focusable" &&
		ihlal.nodes.every((n) => n.target.join(" ").includes("kalem-slash-list"))
	);
}

async function tara(page: import("@playwright/test").Page) {
	let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
	for (const secici of KAPSAM) builder = builder.include(secici);
	const sonuc = await builder.analyze();
	return { ...sonuc, violations: sonuc.violations.filter((v) => !kabulEdilen(v)) };
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
	await page.evaluate((md) => window.kalem.editor.setValue(md), KAPSAMLI);
	await page.locator("#aracCubugu").selectOption("both");
	await expect(page.locator(".kalem-toolbar")).toBeVisible();
});

/** Bir paragrafın tamamını seçer — balon araç çubuğunu açar. */
async function secimYap(page: import("@playwright/test").Page) {
	await page.locator("#editor > p").first().click();
	await page.keyboard.press("ControlOrMeta+a");
	await expect(page.locator(".kalem-bubble")).toBeVisible();
}

test.describe("axe taraması", () => {
	test("açılış ekranı temiz", async ({ page }) => {
		expect((await tara(page)).violations).toEqual([]);
	});

	test("balon araç çubuğu açıkken temiz", async ({ page }) => {
		await secimYap(page);
		expect((await tara(page)).violations).toEqual([]);
	});

	test("slash menü açıkken temiz", async ({ page }) => {
		// `/` yalnızca kelime başında açıyor; paragrafın sonu nokta olduğu
		// için önce içerik seçilip değiştiriliyor.
		await page.locator("#editor > p").last().click();
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.type("/");
		await expect(page.locator(".kalem-slash")).toBeVisible();
		expect((await tara(page)).violations).toEqual([]);
	});

	test("blok menüsü açıkken temiz", async ({ page }) => {
		const kutu = await page.locator("#editor > p").first().boundingBox();
		await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
		await expect(page.locator(".kalem-handle")).toBeVisible();
		await page.locator(".kalem-handle-grip").click();
		await expect(page.locator(".kalem-block-menu")).toBeVisible();
		expect((await tara(page)).violations).toEqual([]);
	});

	test("bağlantı popover'ı açıkken temiz", async ({ page }) => {
		await secimYap(page);
		await page.keyboard.press("ControlOrMeta+k");
		await expect(page.locator(".kalem-link-popover")).toBeVisible();
		expect((await tara(page)).violations).toEqual([]);
	});

	test("salt okunur modda temiz", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setReadOnly(true));
		expect((await tara(page)).violations).toEqual([]);
	});

	/** Kontrast kuralları temaya göre değişiyor; koyu tema ayrıca taranmalı. */
	test("koyu temada temiz", async ({ page }) => {
		await page.locator("#tema").selectOption("dark");
		await secimYap(page);
		expect((await tara(page)).violations).toEqual([]);
	});

	test("yalın temada temiz", async ({ page }) => {
		await page.locator("#tema").selectOption("minimal");
		await secimYap(page);
		expect((await tara(page)).violations).toEqual([]);
	});
});

/**
 * axe'ın göremediği kısım.
 *
 * Otomatik tarama işaretlemeye bakıyor; klavyeyle *gerçekten* iş
 * yapılabildiğini göremiyor. Kabul kriterinin ikinci yarısı bu:
 * "ekran okuyucuyla doküman yazılıp düzenlenebiliyor."
 */
test.describe("klavye ve odak", () => {
	/** Editör bir metin kutusu olarak duyurulmalı ve **adı olmalı**. */
	test("editör adlandırılmış metin kutusu", async ({ page }) => {
		const ed = page.locator("#editor");
		await expect(ed).toHaveAttribute("role", "textbox");
		await expect(ed).toHaveAttribute("aria-multiline", "true");
		await expect(ed).toHaveAttribute("aria-label", "Belge");
	});

	test("salt okunur mod duyuruluyor", async ({ page }) => {
		await page.evaluate(() => window.kalem.editor.setReadOnly(true));
		await expect(page.locator("#editor")).toHaveAttribute("aria-readonly", "true");
	});

	/** Görev kutusunun adı maddenin kendi metninden geliyor — her dilde doğru. */
	test("görev kutusunun erişilebilir adı var", async ({ page }) => {
		const kutu = page.locator("#editor .kalem-task input").first();
		await expect(kutu).toHaveAttribute("aria-label", "biten görev");
	});

	/**
	 * Sürükle-bırak tek yol olamaz. Fare kullanamayan kullanıcı da blok
	 * sıralayabilmeli ve sonucu **duyabilmeli**.
	 */
	test("blok klavyeyle taşınıyor ve duyuruluyor", async ({ page }) => {
		await page.locator("#editor > p").first().click();
		await page.keyboard.press("ControlOrMeta+Shift+ArrowDown");
		await expect(page.locator(".kalem-live")).toHaveText("Blok aşağı taşındı");
	});

	/** Menüden yapılan işlemler de duyuruluyor; ekranda görünen tek geri bildirim değil. */
	test("blok menüsü işlemleri duyuruluyor", async ({ page }) => {
		const kutu = await page.locator("#editor > p").first().boundingBox();
		await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
		await page.locator(".kalem-handle-grip").click();
		await page.locator(".kalem-block-menu .kalem-menu-item", { hasText: "Çoğalt" }).click();
		await expect(page.locator(".kalem-live")).toHaveText("Blok çoğaltıldı");
	});

	/**
	 * Odak boşlukta kalamaz: menü kapanınca kullanıcı nereye döndüğünü
	 * bilmeli. Klavye kullanıcısı için tek yönelim işareti bu.
	 */
	test("menü kapanınca odak geri veriliyor", async ({ page }) => {
		const kutu = await page.locator("#editor > p").first().boundingBox();
		await page.mouse.move(kutu!.x + 10, kutu!.y + kutu!.height / 2);
		await page.locator(".kalem-handle-grip").click();
		await page.keyboard.press("Escape");
		await expect(page.locator(".kalem-handle-grip")).toBeFocused();
	});

	/**
	 * axe'ın `scrollable-region-focusable` bulgusunun koruduğu asıl şey:
	 * klavye kullanıcısı listenin **tamamına** erişebiliyor mu.
	 */
	test("slash menüsünün son öğesine klavyeyle inilebiliyor", async ({ page }) => {
		await page.locator("#editor > p").last().click();
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.type("/");
		await expect(page.locator(".kalem-slash")).toBeVisible();

		const sayi = await page.locator(".kalem-slash-item").count();
		for (let i = 1; i < sayi; i++) await page.keyboard.press("ArrowDown");

		const son = page.locator(".kalem-slash-item").last();
		await expect(son).toHaveAttribute("aria-selected", "true");
		// Seçili öğe görünür alana kaydırılmış olmalı — kaydırma klavyeden
		// erişilebilir, bu yüzden axe'ın kuralı pratikte karşılanıyor.
		const gorunur = await son.evaluate((el) => {
			const liste = el.parentElement as HTMLElement;
			const a = el.getBoundingClientRect();
			const b = liste.getBoundingClientRect();
			return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
		});
		expect(gorunur).toBe(true);
	});

	/** Araç çubuğuna tek Tab ile giriliyor, içinde oklarla geziliyor. */
	test("araç çubukları tek sekme durağı", async ({ page }) => {
		const sayi = await page.evaluate(
			() => document.querySelectorAll('.kalem-toolbar [tabindex="0"]').length,
		);
		expect(sayi).toBe(1);
	});

	/** Simgeler süs; anlamı düğmenin erişilebilir adı taşıyor. */
	test("her düğmenin adı, her simgenin aria-hidden'ı var", async ({ page }) => {
		const eksik = await page.evaluate(() => {
			const kotu: string[] = [];
			for (const b of document.querySelectorAll(".kalem-toolbar button, .kalem-handle button")) {
				if ((b.getAttribute("aria-label") ?? "").trim() === "") kotu.push(b.outerHTML.slice(0, 60));
			}
			for (const g of document.querySelectorAll(".kalem-toolbar span, .kalem-handle span")) {
				if (g.getAttribute("aria-hidden") !== "true") kotu.push(g.outerHTML.slice(0, 60));
			}
			return kotu;
		});
		expect(eksik).toEqual([]);
	});

	/** Canlı bölge görsel olarak gizli ama erişilebilirlik ağacında. */
	test("canlı bölge doğru kurulmuş", async ({ page }) => {
		const bolge = page.locator(".kalem-live");
		await expect(bolge).toHaveAttribute("aria-live", "polite");
		await expect(bolge).toHaveAttribute("role", "status");
		const gizli = await bolge.evaluate((el) => getComputedStyle(el).display === "none");
		expect(gizli).toBe(false);
	});
});
