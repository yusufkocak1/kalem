import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	/*
	 * Örnek uygulama testleri bu paketin **dışında**.
	 *
	 * Kendi yapılandırmaları var (`playwright.examples.config.ts`): altı
	 * uygulamayı derleyip ayağa kaldırıyorlar ve bu, her `pnpm e2e`
	 * koşusuna dakikalar ekler. Burada dışlanmasalardı sunucusuz koşup
	 * bağlantı hatasıyla düşerlerdi.
	 */
	testIgnore: "examples/**",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
	use: {
		baseURL: "http://localhost:5173",
		trace: "on-first-retry",
		// Türkçe locale varsayılan: locale'e duyarlı davranışlar (F6-10)
		// varsayılan olarak Türkçe altında test edilir; İngilizce'de geçip
		// Türkçe'de patlayan hataların CI'a girmesi bu şekilde zorlaşır.
		locale: "tr-TR",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	webServer: {
		// Sunucu açılışta paketleri derliyor; demo sayfası `dist/`ten
		// yüklüyor ve derlemeden servis etmek eski JS'i test etmek demek.
		command: "node scripts/serve-demo.mjs 5173",
		url: "http://localhost:5173",
		/*
		 * Var olan sunucu **kullanılmıyor**.
		 *
		 * Açık duran bir sunucu, kendinden sonra yazılan kodu bilmiyor:
		 * testler geçiyor ama ölçtükleri şey çalışan kod değil. Bu bir kez
		 * 18 testi yanlış yere baktırdı. Port doluysa Playwright yüksek
		 * sesle hata veriyor — sessizce yanlış cevap vermesinden iyi.
		 */
		reuseExistingServer: false,
		stdout: "ignore",
	},
});
