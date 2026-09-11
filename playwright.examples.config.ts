import { defineConfig, devices } from "@playwright/test";

/**
 * Örnek uygulamalar için ayrı yapılandırma  (İş listesi: F5-01)
 *
 * ## Neden ana yapılandırmadan ayrı
 *
 * Örnekleri kurup başlatmak yarım dakika sürüyor (Next.js üretim derlemesi
 * dâhil) ve ana e2e paketi her çalıştığında bu bedeli ödemek, hızlı geri
 * bildirimi öldürürdü. Burada ölçülen şey de farklı: editörün davranışı
 * değil, **paketin bir uygulamaya gerçekten takılabildiği**.
 *
 * ## Tek motor
 *
 * Sarmalayıcı DOM davranışı üretmiyor; ürettiği şey React yaşam döngüsü.
 * Üç motorda koşturmak aynı React'i üç kez sınamak olurdu — tarayıcı
 * farkları zaten `e2e/*.spec.ts` tarafında ölçülüyor.
 */
export default defineConfig({
	testDir: "e2e/examples",
	fullyParallel: false,
	forbidOnly: process.env["CI"] !== undefined,
	retries: process.env["CI"] !== undefined ? 1 : 0,
	workers: 1,
	reporter: process.env["CI"] !== undefined ? "line" : "list",
	use: {
		locale: "tr-TR",
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	/*
	 * Derleme sunucu komutunun içinde: örnek, **yayımlanacak çıktıdan**
	 * çalışmak zorunda. Kaynağa takma ad veren bir geliştirme sunucusu,
	 * paketin `exports` haritasındaki bir hatayı gizlerdi.
	 */
	webServer: [
		{
			command:
				"pnpm --filter example-react-vite build && pnpm --filter example-react-vite preview --port 4173 --strictPort",
			url: "http://localhost:4173",
			reuseExistingServer: false,
			timeout: 180_000,
			stdout: "pipe",
		},
		{
			command: "pnpm --filter example-nextjs build && pnpm --filter example-nextjs start -p 3100",
			url: "http://localhost:3100",
			reuseExistingServer: false,
			timeout: 300_000,
			stdout: "pipe",
		},
	],
});
