import { expect, test } from "@playwright/test";

/**
 * Demo sayfasının konsol/otomasyon köprüsü.
 *
 * Kütüphane global'e hiçbir şey yazmaz; bunu yazan `apps/demo/viewer.html`.
 * Tipler burada gevşek tutuldu (`unknown`): bu dosyanın işi AST'nin şeklini
 * doğrulamak değil, iki render hedefinin çıktısını karşılaştırmak.
 */
declare global {
	interface Window {
		kalem: {
			parse: (markdown: string) => unknown;
			buildPlan: (ast: unknown, options?: unknown) => unknown;
			renderToDOM: (ast: unknown, target: Element, options?: unknown) => void;
			renderToString: (ast: unknown, options?: unknown) => string;
		};
		__xss: number;
	}
}

/**
 * `@kalem-editor/viewer` — gerçek tarayıcı testleri  (İş listesi: F2-01, F2-02)
 *
 * ## Neden jsdom yok
 *
 * F2-02'nin kabul kriteri `renderToDOM` ile `renderToString`'in **aynı
 * çıktıyı** vermesi. Bu eşitliğin hakemi tarayıcının kendi HTML
 * serileştirme algoritması; onu taklit eden bir kütüphaneye sormak,
 * cevabı test edilen şeyin kendisinden almak olurdu. Vitest tarafı bu
 * yüzden yalnızca saf `renderToString`'i sınıyor, DOM tarafı burada —
 * üç motorda birden.
 *
 * Sayfa `apps/demo/viewer.html`; kütüphaneyi **derlenmiş bundle'dan**
 * yüklüyor, yani npm'e gidecek olanla aynı kod ölçülüyor.
 */

/** Her biri farklı bir render yolunu zorlayan girdiler. */
const ORNEKLER: readonly [string, string][] = [
	["başlıklar", "# bir\n\nyazı\n\n## iki\n\n### üç"],
	["vurgu", "*a* **b** ~~c~~ `d` ve düz metin"],
	["liste", "- bir\n- iki\n  - iç\n\n1. sıralı\n2. ikinci"],
	["gevşek liste", "- bir\n\n- iki"],
	["görev listesi", "- [x] bitti\n- [ ] duruyor"],
	["alıntı", "> alıntı\n>\n> ikinci paragraf"],
	["kod", "```ts\nconst a = 1 < 2 && 3 > 2;\n```"],
	["tablo", "| a | b |\n| :-- | --: |\n| 1 | 2 |"],
	["bağlantı", '[a](/y "başlık") ve ![görsel](/r.png "alt başlık")'],
	["referans", "[a][k] ve [tanımsız][yok]\n\n[k]: /yol"],
	["kaçışlama", "a & b < c > d \" e ' f"],
	["türkçe", "# Işık ve Gölge\n\nığüşöç İĞÜŞÖÇ — `dosya_adi` bozulmuyor."],
	["parantezli url", "[a](https://tr.wikipedia.org/wiki/Kalem_(araç))"],
	["ham html", "<div>blok</div>\n\nsatır içi <b>kalın</b> etiketi"],
	["sert satır sonu", "bir  \niki"],
	["yatay çizgi", "üst\n\n---\n\nalt"],
	["boş belge", ""],
];

test.beforeEach(async ({ page }) => {
	await page.goto("/viewer.html");
	// Modül yüklenene kadar bekle: `window.kalem` sayfanın son işi.
	await page.waitForFunction(() => "kalem" in window);
});

test.describe("iki render hedefi", () => {
	for (const [ad, markdown] of ORNEKLER) {
		test(`${ad} — DOM ve string byte-birebir aynı`, async ({ page }) => {
			const sonuc = await page.evaluate((md) => {
				const { parse, renderToDOM, renderToString } = window.kalem;
				const kok = parse(md);
				const kap = document.createElement("div");
				renderToDOM(kok, kap);
				return { dom: kap.innerHTML, metin: renderToString(kok) };
			}, markdown);
			expect(sonuc.dom).toBe(sonuc.metin);
		});
	}

	test("politika değişse de eşitlik korunuyor", async ({ page }) => {
		for (const politika of ["escape", "strip"] as const) {
			const sonuc = await page.evaluate(
				({ md, html }) => {
					const { parse, renderToDOM, renderToString } = window.kalem;
					const kok = parse(md);
					const kap = document.createElement("div");
					renderToDOM(kok, kap, { html });
					return { dom: kap.innerHTML, metin: renderToString(kok, { html }) };
				},
				{ md: "<div>x</div>\n\nsatır içi <b>y</b>", html: politika },
			);
			expect(sonuc.dom, politika).toBe(sonuc.metin);
		}
	});
});

test.describe("güvenlik", () => {
	test("javascript: bağlantısı etkisizleştiriliyor", async ({ page }) => {
		const href = await page.evaluate(() => {
			const { parse, renderToDOM } = window.kalem;
			const kap = document.createElement("div");
			renderToDOM(parse("[tıkla](javascript:alert(1))"), kap);
			return kap.querySelector("a")?.getAttribute("href");
		});
		expect(href).toBe("#");
	});

	/**
	 * Asıl iddia: metin hiçbir aşamada HTML olarak **ayrıştırılmıyor**.
	 * `onerror` çalışsaydı bu sayaç artardı; `createElement` + `textContent`
	 * yolu bunu yapısal olarak imkânsız kılıyor.
	 */
	test("ham HTML çalıştırılmıyor", async ({ page }) => {
		const sonuc = await page.evaluate(async () => {
			window.__xss = 0;
			const { parse, renderToDOM } = window.kalem;
			const kap = document.createElement("div");
			document.body.appendChild(kap);
			renderToDOM(
				parse('<img src=x onerror="window.__xss++">\n\n<script>window.__xss++</script>'),
				kap,
			);
			await new Promise((r) => setTimeout(r, 50));
			const sonuc = {
				xss: window.__xss,
				img: kap.querySelectorAll("img").length,
				metin: kap.textContent,
			};
			kap.remove();
			return sonuc;
		});
		expect(sonuc.xss).toBe(0);
		expect(sonuc.img).toBe(0);
		expect(sonuc.metin).toContain("onerror");
	});
});

/**
 * F2-03 — `@kalem-editor/themes/viewer.css`
 *
 * Stil dosyası gerçekten yükleniyor mu ve `.kalem-doc` kapsamından dışarı
 * sızıyor mu. İkincisi asıl iddia: görüntüleyici, gömüldüğü uygulamanın
 * görünümüne dokunmamalı.
 */
test.describe("tema", () => {
	test("stil dosyası uygulanıyor", async ({ page }) => {
		const pre = page.locator("#onizleme pre").first();
		// Tema `<pre>`ye zemin ve köşe yarıçapı veriyor; sayfanın kendi CSS'i vermiyor.
		await expect(pre).toHaveCSS("border-radius", "6px");
		await expect(pre).toHaveCSS("overflow-x", "auto");
	});

	test("başlık ritmi ilk çocukta sıfırlanıyor", async ({ page }) => {
		await expect(page.locator("#onizleme h1").first()).toHaveCSS("margin-top", "0px");
	});

	test("stil `.kalem-doc` dışına sızmıyor", async ({ page }) => {
		// Sayfa kabuğundaki `<h1>` tema kuralından etkilenmemeli.
		const kabukBaslik = page.locator("header h1");
		await expect(kabukBaslik).toHaveCSS("font-size", "17px");
	});

	test("hizalama sınıfları çalışıyor", async ({ page }) => {
		await page.locator("#girdi").fill("| a |\n| --: |\n| 1 |");
		await expect(page.locator("#onizleme td").first()).toHaveCSS("text-align", "right");
	});
});

test.describe("demo sayfası", () => {
	test("eşitlik göstergesi yeşil", async ({ page }) => {
		await expect(page.locator("#esitlik")).toHaveText("byte-birebir ✓");
	});

	test("önizleme gerçekten render edilmiş", async ({ page }) => {
		await expect(page.locator("#onizleme.kalem-doc h1")).toHaveText("Kalem");
		await expect(page.locator("#onizleme pre code.language-ts")).toContainText("const kok");
	});

	test("yazmak önizlemeyi güncelliyor", async ({ page }) => {
		const girdi = page.locator("#girdi");
		await girdi.fill("## Işık");
		await expect(page.locator("#onizleme h2")).toHaveText("Işık");
		await expect(page.locator("#esitlik")).toHaveText("byte-birebir ✓");
	});

	test("politika değişince ham HTML görünürlüğü değişiyor", async ({ page }) => {
		await page.locator("#girdi").fill("<div>ham</div>");
		await expect(page.locator("#cikti")).toHaveText("&lt;div&gt;ham&lt;/div&gt;");
		await page.locator("#politika").selectOption("strip");
		await expect(page.locator("#cikti")).toHaveText("");
	});
});
