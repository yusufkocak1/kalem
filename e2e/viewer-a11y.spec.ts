import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * `@kalem/viewer` — erişilebilirlik taraması  (İş listesi: F2-04)
 *
 * ## Ne ölçülüyor, ne ölçülmüyor
 *
 * axe otomatik olarak WCAG ihlallerinin **bir kısmını** yakalar; "axe temiz"
 * ile "erişilebilir" aynı şey değildir. Buradaki iddia dar ve dürüst:
 * *görüntüleyicinin ürettiği işaretleme, otomatik olarak saptanabilir bir
 * WCAG 2.1 A/AA ihlali içermiyor.* Klavye gezinmesi, ekran okuyucu akışı ve
 * odak yönetimi F3-10'un işi.
 *
 * Tarama **yalnızca `#onizleme` ağacına** kapsanıyor: demo sayfasının
 * kabuğu (araç çubuğu, ölçüm kartları) kütüphanenin ürünü değil, onun
 * kusurları buraya yazılmamalı.
 */

/** Render'ın ürettiği tüm eleman tiplerini kapsayan tek belge. */
const KAPSAMLI_BELGE = `# Ana başlık

Paragraf, **kalın**, *italik*, ~~üstü çizili~~, \`kod\` ve
[bağlantı](https://ornek.com "başlık").

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
| iki | 2 |

![Kalem logosu, mürekkepli bir dolma kalem](/logo.png)

---

Son paragraf.
`;

test.beforeEach(async ({ page }) => {
	await page.goto("/viewer.html");
	await page.waitForFunction(() => "kalem" in window);
	await page.locator("#girdi").fill(KAPSAMLI_BELGE);
	await expect(page.locator("#onizleme h1")).toHaveText("Ana başlık");
});

test.describe("erişilebilirlik", () => {
	test("render edilen belgede WCAG 2.1 A/AA ihlali yok", async ({ page }) => {
		const sonuc = await new AxeBuilder({ page })
			.include("#onizleme")
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
			.analyze();

		// İhlal varsa mesajda kural adı ve seçici görünsün — çıplak sayı
		// karşılaştırması hatayı bulunamaz kılıyor.
		expect(
			sonuc.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`),
		).toEqual([]);
	});

	test("koyu temada da ihlal yok", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		const sonuc = await new AxeBuilder({ page })
			.include("#onizleme")
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
			.analyze();
		expect(sonuc.violations.map((v) => v.id)).toEqual([]);
	});
});
