import { expect, test } from "@playwright/test";

/**
 * `@kalem-editor/plugin-outline`  (İş listesi: F4-04)
 *
 * Başlık çıkarma birim testleriyle sabit (`outline.test.ts`); burada
 * ölçülen, panelin belgeyle birlikte güncellendiği, tıklamanın imleci
 * gerçekten taşıdığı ve etkin başlığın hem imleçten hem kaydırmadan
 * geldiği.
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
			anahatEklentisi: {
				items(): readonly { text: string; depth: number; level: number }[];
				activeIndex(): number;
				goTo(index: number): void;
			};
		};
	}
}

const BELGE = [
	"# Işık ve Gölge",
	"",
	"Giriş paragrafı.",
	"",
	"## Birinci bölüm",
	"",
	"Metin.",
	"",
	"### Alt başlık",
	"",
	"Metin.",
	"",
	"## İkinci bölüm",
	"",
	"Son.",
	"",
].join("\n");

const panel = (page: import("@playwright/test").Page) =>
	page.locator("#icindekiler .kalem-outline");
const maddeler = (page: import("@playwright/test").Page) =>
	panel(page).locator(".kalem-outline-item");

test.beforeEach(async ({ page }) => {
	const hatalar: string[] = [];
	page.on("pageerror", (h) => hatalar.push(String(h)));
	await page.goto("/editor.html");
	await page
		.waitForFunction(() => "kalem" in window)
		.catch((sebep) => {
			throw new Error(hatalar.length > 0 ? `Sayfa hatası: ${hatalar.join(" · ")}` : String(sebep));
		});
	await page.locator("#anahat").check();
	await page.evaluate((md) => {
		window.kalem.editor.setValue(md);
		window.kalem.editor.focus();
	}, BELGE);
});

test("başlıklar belge sırasında listeleniyor", async ({ page }) => {
	await expect(maddeler(page)).toHaveText([
		"Işık ve Gölge",
		"Birinci bölüm",
		"Alt başlık",
		"İkinci bölüm",
	]);
});

test("girinti seviyesi atlamaları düzeltiyor", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setValue("# Bir\n\n### Üç\n\n### Üç2\n"));
	const seviyeler = await maddeler(page).evaluateAll((el) =>
		el.map((e) => (e as HTMLElement).dataset.level),
	);
	// `#` sonrası gelen `###` iki seviye girinti alıyor, üç değil.
	expect(seviyeler).toEqual(["1", "2", "2"]);
});

test("başlık yoksa boş durum görünüyor", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setValue("Yalnızca paragraf.\n"));
	await expect(maddeler(page)).toHaveCount(0);
	await expect(panel(page).locator(".kalem-outline-empty")).toBeVisible();
});

test("başlık yazılınca liste güncelleniyor", async ({ page }) => {
	await expect(maddeler(page)).toHaveCount(4);
	await page.evaluate(() => window.kalem.editor.setValue(`${"# Yeni\n\n"}metin\n`));
	await expect(maddeler(page)).toHaveText(["Yeni"]);
});

test("başlığa tıklamak imleci oraya taşıyor", async ({ page }) => {
	await maddeler(page).nth(2).click();
	const nerede = await page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null;
		return { metin: el?.textContent ?? "", etiket: el?.localName ?? "" };
	});
	expect(nerede).toEqual({ metin: "Alt başlık", etiket: "h3" });
});

test("tıklanan başlık etkin oluyor", async ({ page }) => {
	await maddeler(page).nth(3).click();
	await expect(maddeler(page).nth(3)).toHaveAttribute("aria-current", "location");
	expect(await page.evaluate(() => window.kalem.anahatEklentisi.activeIndex())).toBe(3);
});

test("imleç bölümü değiştirince etkin başlık da değişiyor", async ({ page }) => {
	// İkinci bölümün paragrafına tıkla: panel o başlığı işaretlemeli.
	await page.locator("#editor > p").last().click();
	await expect(maddeler(page).nth(3)).toHaveAttribute("aria-current", "location");
});

test("etkin başlık aynı anda yalnızca bir tane", async ({ page }) => {
	await maddeler(page).nth(1).click();
	await maddeler(page).nth(2).click();
	await expect(panel(page).locator("[aria-current]")).toHaveCount(1);
});

test("kaydırma etkin başlığı güncelliyor", async ({ page }) => {
	// Ekrana sığmayan bir belge; her bölümde birkaç paragraf.
	await page.evaluate(() => {
		const bolumler = Array.from(
			{ length: 8 },
			(_, i) => `## Bölüm ${i + 1}\n\n${"Metin.\n\n".repeat(6)}`,
		);
		window.kalem.editor.setValue(`# Üst\n\n${bolumler.join("")}`);
	});
	await expect(maddeler(page)).toHaveCount(9);

	// Beşinci `##` başlığını görünür alanın tepesine kaydır. Tıklamayla
	// değil doğrudan DOM'dan: ölçülen şey **kaydırmanın** paneli
	// güncellediği, panelin kendi tıklamasının değil.
	await page.evaluate(() => {
		document.querySelectorAll("#editor > h2")[4]?.scrollIntoView({ block: "start" });
	});
	// Ölçüm bir sonraki çizim karesinde yapılıyor.
	await expect.poll(() => page.evaluate(() => window.kalem.anahatEklentisi.activeIndex())).toBe(5);
});

test("salt okunur belgede de atlama çalışıyor", async ({ page }) => {
	await page.evaluate(() => window.kalem.editor.setReadOnly(true));
	await maddeler(page).nth(1).click();
	expect(await page.evaluate(() => window.kalem.anahatEklentisi.activeIndex())).toBe(1);
});

test("panel erişilebilir bir gezinme bölgesi", async ({ page }) => {
	await expect(page.getByRole("navigation", { name: "İçindekiler" })).toBeVisible();
	// Maddeler düğme: adrese gitmiyoruz, imleci taşıyoruz.
	await expect(maddeler(page).first()).toHaveRole("button");
});
