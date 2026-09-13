import { expect, test } from "@playwright/test";

/**
 * Performans geçişi  (İş listesi: F6-08)
 *
 * Üç soru var ve üçü de ölçülüyor:
 *
 * 1. **Bin bloklu belgede yazmak akıcı mı** — kabul kriteri bu.
 * 2. **Sanal kaydırma gerekli mi** — 5.000 blokta maliyet nasıl büyüyor.
 * 3. **`destroy()` sonrası sızıntı var mı** — dinleyiciler ve nesneler.
 *
 * ## Neden eşikler cömert
 *
 * Bu testler CI makinesinde, paylaşılan bir çekirdekte koşuyor; kesin
 * sayıları `scripts/olcum.mjs` üretiyor. Buradaki eşikler **gerileme**
 * yakalamak için: gerçek ölçümün birkaç katı, yani rastgele yavaşlıkta
 * patlamıyor ama tuş başına maliyeti O(belge)e çeviren bir değişiklik
 * fark edilmeden geçemiyor.
 *
 * Sayfa `apps/demo/olcum.html`; `window.olcum` üstünden sürülüyor.
 */

declare global {
	interface Window {
		olcum: {
			belge(blok: number): string;
			kur(
				blok: number,
				secenek?: { arayuz?: boolean; deger?: string | null },
			): { kurulus: number; karakter: number; blok: number; dugum: number };
			sok(): void;
			sonuc(): {
				orneklem: number;
				p50: number;
				p95: number;
				enKotu: number;
				uzunGorevler: number;
				uzunGorevDestegi: boolean;
			};
			donguBaslat(kez: number, blok: number): Promise<number>;
			canliEditor(): number;
			gidisDonus(metin: string): boolean;
			rapor(metin: string): void;
		};
	}
}

/** Tuş başına bütçe. Bir kare 60 Hz'de 16,7 ms; hedef onun altında kalmak. */
const KARE = 16;

test.beforeEach(async ({ page }) => {
	await page.goto("/olcum.html");
	await expect(page.locator("#hazir")).toHaveText("hazır");
});

/** Editöre odaklanıp `n` karakter yazar; ölçüm `beforeinput`ten başlıyor. */
async function yaz(page: import("@playwright/test").Page, n: number): Promise<void> {
	const ilk = page.locator("#editor > [data-kalem-id]").first();
	await ilk.click();
	await page.keyboard.press("End");
	// Tuşlar arasında gecikme yok: en kötü durum ölçülüyor, kullanıcının
	// düşünme payı değil.
	await page.keyboard.type("ışık gölge İŞIK", { delay: 0 });
	if (n > 15) await page.keyboard.type("x".repeat(n - 15), { delay: 0 });
}

test.describe("kabul: bin bloklu belgede yazmak akıcı", () => {
	test("tuş başına maliyet bir karenin altında", async ({ page }) => {
		const kurulum = await page.evaluate(() => window.olcum.kur(1000));
		expect(kurulum.blok).toBe(1000);
		// Blok sayısı üst seviye; ekrana inen eleman sayısı çok daha fazla.
		expect(kurulum.dugum).toBeGreaterThan(2000);

		await yaz(page, 40);

		const o = await page.evaluate(() => window.olcum.sonuc());
		expect(o.orneklem).toBeGreaterThan(30);
		expect(o.p50).toBeLessThan(KARE);
		// p95 daha gevşek: arada bir çöp toplama girmesi normal.
		expect(o.p95).toBeLessThan(KARE * 3);
	});

	test("araç çubuğu bağlıyken de akıcı", async ({ page }) => {
		// `mountUi` seçim dinleyicileri ve balon çubuk ekliyor; bunların
		// tuş başına maliyete girmemesi gerekiyor.
		await page.evaluate(() => window.olcum.kur(1000, { arayuz: true }));
		await yaz(page, 40);

		const o = await page.evaluate(() => window.olcum.sonuc());
		expect(o.p50).toBeLessThan(KARE);
		expect(o.p95).toBeLessThan(KARE * 3);
	});

	test("uzun görev üretmiyor", async ({ page }) => {
		await page.evaluate(() => window.olcum.kur(1000));
		await yaz(page, 60);

		const o = await page.evaluate(() => window.olcum.sonuc());
		// Desteklemeyen motorda (Firefox, Safari) sayaç 0 kalıyor ve bu
		// test orada bir şey iddia etmiyor — açıkça söylensin diye böyle.
		test.skip(!o.uzunGorevDestegi, "longtask API'si yalnızca Chromium'da");
		expect(o.uzunGorevler).toBe(0);
	});

	test("hız uğruna doğruluk kaybedilmiyor", async ({ page }) => {
		// Bin bloklu belgede de gidiş-dönüş byte-birebir: ölçülen hız
		// bozuk bir çıktının hızı değil.
		const tamam = await page.evaluate(() => window.olcum.gidisDonus(window.olcum.belge(1000)));
		expect(tamam).toBe(true);
	});
});

test.describe("sanal kaydırma gerekli mi", () => {
	/**
	 * Büyük belgelerde **oran** ölçülüyor, mutlak süre değil.
	 *
	 * Bu testler sekiz işçiyle paralel koşuyor: yanı başında yedi tarayıcı
	 * aynı çekirdeği kullanırken alınan mutlak süre kütüphaneyi değil
	 * makinenin o anki yükünü ölçüyor. Ölçüldü: tek başına 7,3 ms çıkan
	 * 5.000 bloklu ölçüm, tüm takım koşarken 17,8 ms'ye çıkıyor.
	 *
	 * Oran ise çekişmeye dayanıklı — iki ölçüm de aynı koşullarda alınıyor,
	 * yük ikisini birden büyütüyor. Ve asıl sorulan şey zaten oran: maliyet
	 * belge boyutuyla **doğru orantılı** mı büyüyor. Mutlak sayılar
	 * `pnpm olcum` raporunda, gürültüsüz bir koşuda.
	 */
	async function oran(
		page: import("@playwright/test").Page,
		kucukBlok: number,
		buyukBlok: number,
	): Promise<number> {
		await page.evaluate((n) => window.olcum.kur(n), kucukBlok);
		await yaz(page, 40);
		const kucuk = await page.evaluate(() => window.olcum.sonuc());

		await page.evaluate((n) => window.olcum.kur(n), buyukBlok);
		await yaz(page, 40);
		const buyuk = await page.evaluate(() => window.olcum.sonuc());

		return buyuk.p50 / Math.max(kucuk.p50, 0.5);
	}

	test("beş kat belge, beş kat maliyet getirmiyor", async ({ page }) => {
		/*
		 * Asıl soru bu — ve cevabı "sanal kaydırma gerekmiyor".
		 *
		 * Tuş başına maliyet belge boyutuyla doğrusal büyüyordu ama darboğaz
		 * DOM değil `serialize(doc)` idi: her tuşta belgenin tamamı yeniden
		 * yazılıyordu. Sanal kaydırma DOM düğümü azaltır, bunu azaltmazdı.
		 * Blok başına serileştirme önbelleği (F6-08) 5.000 blokta p50'yi
		 * 27,5 ms'den 7,3 ms'ye indirdi.
		 *
		 * Eşik önbelleği koruyor: önbellek kalkarsa 5.000/1.000 oranı 5,6×
		 * oluyor (ölçüldü), yani 5× sınırı onu geçirmez. Önbellekliyken
		 * 3,8× — aradaki pay dar ama gürültüye değil koda duyarlı.
		 */
		expect(await oran(page, 1000, 5000)).toBeLessThan(5);
	});

	test("on kat belge, on kat maliyet getirmiyor", async ({ page }) => {
		// İş listesi "5.000+" diyor; üstünü de ölçmek, sınırın nerede
		// olduğunu tahmin etmek yerine bilmek demek. Gürültüsüz koşuda
		// 10.000 blokta p50 13,0 ms — hâlâ bir karenin altında.
		expect(await oran(page, 1000, 10_000)).toBeLessThan(10);
	});

	test("beş bin blok açılıyor ve yazılabiliyor", async ({ page }) => {
		const kurulum = await page.evaluate(() => window.olcum.kur(5000));
		expect(kurulum.blok).toBe(5000);
		// Kurulum tek seferlik ve kullanıcı onu bekliyor; eşik cömert.
		expect(kurulum.kurulus).toBeLessThan(8000);

		await yaz(page, 20);
		const o = await page.evaluate(() => window.olcum.sonuc());
		expect(o.orneklem).toBeGreaterThan(10);
	});
});

test.describe("destroy sonrası sızıntı", () => {
	test("ulaşılabilir hedefte dinleyici bırakmıyor", async ({ page }) => {
		/*
		 * Bu test tek tek dinleyici adı saymıyor; `addEventListener`ı sarıp
		 * sökme sonrası **ne kaldığına** bakıyor. Adları saymak bir sonraki
		 * unutulanı yakalamazdı — nitekim `paste` dinleyicisi tam olarak
		 * böyle unutulmuştu (bkz. iş listesi F6-08).
		 *
		 * ## Ham simetri yanlış ölçü
		 *
		 * İlk sürüm eklenen/kaldırılan sayısını karşılaştırıyordu ve dokuz
		 * "sızıntı" buldu — hepsi yanlış alarmdı: `mountUi` düğmelerine
		 * dinleyici takıyor ve sökerken düğmeleri **DOM'dan çıkarıyor**.
		 * Ulaşılamayan bir elemanın dinleyicisi elemanla birlikte
		 * toplanıyor; o bir sızıntı değil, geçerli bir temizleme yöntemi.
		 *
		 * Kalan tek doğru ölçüt: dinleyici, sökme bittikten sonra **hâlâ
		 * ulaşılabilir** bir hedefte mi duruyor — `document`, `window` ya da
		 * belgeye bağlı bir eleman.
		 */
		const kalan = await page.evaluate(() => {
			const kayitlar: { hedef: EventTarget; tur: string }[] = [];
			const protolar = [Element.prototype, Document.prototype, Window.prototype];
			const asil = protolar.map((p) => [p.addEventListener, p.removeEventListener] as const);

			for (const proto of protolar) {
				const ekle = proto.addEventListener;
				const sil = proto.removeEventListener;
				proto.addEventListener = function (this: EventTarget, ...a: unknown[]) {
					kayitlar.push({ hedef: this, tur: String(a[0]) });
					return (ekle as (...x: unknown[]) => void).apply(this, a);
				} as typeof proto.addEventListener;
				proto.removeEventListener = function (this: EventTarget, ...a: unknown[]) {
					const i = kayitlar.findIndex((k) => k.hedef === this && k.tur === String(a[0]));
					if (i !== -1) kayitlar.splice(i, 1);
					return (sil as (...x: unknown[]) => void).apply(this, a);
				} as typeof proto.removeEventListener;
			}

			window.olcum.kur(50, { arayuz: true });
			window.olcum.sok();

			for (const [i, proto] of protolar.entries()) {
				const c = asil[i];
				if (c === undefined) continue;
				proto.addEventListener = c[0];
				proto.removeEventListener = c[1];
			}

			return kayitlar
				.filter(
					({ hedef }) =>
						hedef === document || hedef === window || (hedef instanceof Node && hedef.isConnected),
				)
				.map(({ tur }) => tur)
				.sort();
		});

		expect(kalan).toEqual([]);
	});

	test("sökülen editör bellekte kalmıyor", async ({ page, browserName }) => {
		test.skip(browserName !== "chromium", "Çöp toplayıcıyı zorlamak CDP gerektiriyor");

		const sayi = await page.evaluate(() => window.olcum.donguBaslat(30, 50));
		expect(sayi).toBe(30);

		// Çöp toplayıcı kendiliğinden çalışmıyor; zorlanmadan yapılan ölçüm
		// "sızıntı var" der ve yanlış olur.
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("HeapProfiler.collectGarbage");
		await cdp.detach();

		const canli = await page.evaluate(() => window.olcum.canliEditor());
		// Bir tane kalabilir: son döngüdeki referans hâlâ yerel değişkende
		// tutuluyor olabiliyor. Otuzdan biri sızıntı değil, yirmisi sızıntı.
		expect(canli).toBeLessThanOrEqual(1);
	});

	test("söküp yeniden kurmak DOM'u büyütmüyor", async ({ page }) => {
		/*
		 * Playground ve `apps/notlar` editörü **aynı elemanın üstünde**
		 * yeniden kuruyor (tema ya da araç çubuğu kipi değişince). Sökme
		 * eksik kalırsa DOM her turda büyür.
		 */
		const ilk = await page.evaluate(() => window.olcum.kur(100, { arayuz: true }).dugum);
		const son = await page.evaluate(() => {
			let n = 0;
			for (let i = 0; i < 5; i++) n = window.olcum.kur(100, { arayuz: true }).dugum;
			return n;
		});
		expect(son).toBe(ilk);
	});
});
