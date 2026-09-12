import { expect, test } from "@playwright/test";

/**
 * Doküman sitesi — canlı örnekler  (İş listesi: F6-03)
 *
 * F6-03'ün kabul kriteri "ürünün ana iddiası doküman sitesinin kendisiyle
 * kanıtlanıyor". İddia ölçülebilir: **aynı sayfada** vanilla, React ve Vue
 * ile kurulmuş üç editör, aynı anda, tek bir motorla çalışıyor mu.
 *
 * Bu testler olmadan sayfa sessizce çürüyebilirdi — bir ada kurulmayı
 * bıraksa sayfa yine derlenir, yalnızca kutulardan biri boş kalırdı.
 */

const KOK = "http://localhost:4179/canli/";

test.beforeEach(async ({ page }) => {
	await page.goto(KOK);
	await expect(page.locator(".canli").first()).toBeVisible();
});

test("üç editör de aynı sayfada, aynı anda yaşıyor", async ({ page }) => {
	// Sekmeler gizli de olsa üçü de kurulu: `role="textbox"` editörün
	// kök elemanında ve her kutuda bir tane var.
	await expect(page.locator(".canli [role='textbox']")).toHaveCount(3);
	await expect(page.locator(".canli > .kalem-toolbar")).toHaveCount(3);
	await expect(page.locator(".canli-cikti")).toHaveCount(3);
});

test("rozetler üç çerçeveyi adlandırıyor", async ({ page }) => {
	const rozetler = await page.locator(".canli-rozet b").allTextContents();
	expect(rozetler).toEqual(["vanilla", "React", "Vue"]);
});

for (const [sekme, imza] of [
	["Vanilla", "VANILLA"],
	["React", "REACT"],
	["Vue", "VUE"],
] as const) {
	test(`${sekme} örneği gerçekten düzenleniyor`, async ({ page }) => {
		await page.getByRole("tab", { name: sekme, exact: true }).click();

		const yazi = page.locator(".canli-yazi [contenteditable='true']:visible").first();
		await yazi.click();
		await page.keyboard.press("End");
		await page.keyboard.type(` ${imza}`);

		// Markdown çıktısı canlı: gidiş-dönüş kutunun sağında görünüyor.
		await expect(page.locator(".canli-cikti:visible").first()).toContainText(imza);
	});
}

test("yazım tercihi üç örnekte de korunuyor", async ({ page }) => {
	// Belge `*` ile yazılmış bir liste ve `1)` ayracı taşıyor; hiçbiri
	// normalize edilmemeli.
	for (const sekme of ["Vanilla", "React", "Vue"]) {
		await page.getByRole("tab", { name: sekme, exact: true }).click();
		const cikti = page.locator(".canli-cikti:visible").first();
		await expect(cikti).toContainText("* yıldız işareti korunuyor");
		await expect(cikti).toContainText("1) parantez ayracı da öyle");
	}
});

test("araç çubuğu kurulmuş ve biçimlendirme çalışıyor", async ({ page }) => {
	await page.getByRole("tab", { name: "Vanilla", exact: true }).click();

	const yazi = page.locator(".canli-yazi [contenteditable='true']:visible").first();
	await yazi.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" kalınlaşacak");
	// Son kelimeyi seç ve Ctrl+B.
	for (let i = 0; i < "kalınlaşacak".length; i++) {
		await page.keyboard.press("Shift+ArrowLeft");
	}
	await page.keyboard.press("Control+b");

	await expect(page.locator(".canli-cikti:visible").first()).toContainText("**kalınlaşacak**");
});

test("Vue adası sunucuda çiziliyor", async ({ page }) => {
	/*
	 * Ada `client:load` ile kurulu, yani bileşen önce sunucuda çiziliyor.
	 * Nuxt sayfasındaki "`<ClientOnly>` gerekmiyor" iddiası bu sayfanın
	 * kendi HTML'inde duruyor — JavaScript hiç çalışmadan.
	 */
	const ham = await (await page.request.get(KOK)).text();
	expect(ham).toContain("Işık ve Gölge");
	expect(ham).toContain("yıldız işareti korunuyor");
});

test("konsola hata düşmüyor", async ({ page }) => {
	// Üç ada aynı anda kuruluyor; hidrasyon uyuşmazlığı ya da çifte
	// montaj buradan görünürdü.
	const hatalar: string[] = [];
	page.on("pageerror", (e) => hatalar.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") hatalar.push(m.text());
	});
	await page.reload();
	await expect(page.locator(".canli [role='textbox']")).toHaveCount(3);
	expect(hatalar).toEqual([]);
});
