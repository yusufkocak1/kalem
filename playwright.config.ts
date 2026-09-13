import { defineConfig, devices, type Project } from "@playwright/test";

/**
 * Edge projesi — yalnızca kurulu olabileceği yerde  (İş listesi: F6-09)
 *
 * Edge, Chrome'la **aynı motoru** kullanıyor (Blink + V8): ayrıştırıcı,
 * `contenteditable` ve seçim davranışı `chromium` projesinde zaten
 * ölçülüyor, 1.130 testi ikinci kez koşturmak altı dakika ekleyip yeni
 * bilgi vermezdi. Farklı olan kabuk — sürüm takvimi, kendi eklentileri,
 * varsayılan ayarları. Tarayıcı geçiş testi tam olarak onu yokluyor:
 * gerçek bir Edge kurulumunda editör uçtan uca çalışıyor mu.
 *
 * `channel: "msedge"` **kurulu Edge'i** açıyor, Playwright'ın indirdiği
 * Chromium'u değil. Kurulu değilse proje başlatılamıyor ve tüm koşu
 * düşüyor — bu yüzden yalnızca Windows'ta ekleniyor. Başka bir yerde
 * denemek için `KALEM_EDGE=1 pnpm e2e`.
 */
const edgeIstensin = process.env["KALEM_EDGE"] === "1" || process.platform === "win32";

/**
 * Masaüstü projelerinin dışladıkları.
 *
 * **İkisi de tek listede olmalı.** Proje düzeyindeki `testIgnore`, üst
 * düzeydekini genişletmiyor — **eziyor**. Yalnızca `mobil.spec.ts`
 * yazıldığında örnek uygulama testleri üç motora birden sızdı ve
 * sunucusuz koşup düştüler.
 */
const MASAUSTU_HARIC = ["examples/**", /mobil\.spec\.ts/];

const EDGE_PROJESI: Project[] = edgeIstensin
	? [
			{
				name: "edge",
				use: { ...devices["Desktop Edge"], channel: "msedge" },
				testMatch: /tarayici\.spec\.ts/,
			},
		]
	: [];

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
	/*
	 * Projeler  (İş listesi: F6-09)
	 *
	 * Üç masaüstü motoru tüm testleri koşuyor. Mobil ve Edge ise yalnızca
	 * kendi geçiş testlerini koşuyor; sebebi aşağıda.
	 */
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: MASAUSTU_HARIC },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] }, testIgnore: MASAUSTU_HARIC },
		{ name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: MASAUSTU_HARIC },

		...EDGE_PROJESI,

		/*
		 * Mobil: gerçek cihaz değil, cihaz benzetimi.
		 *
		 * Playwright dokunmatik, cihaz piksel oranı, görünüm alanı ve
		 * kullanıcı aracısını taklit ediyor; **taklit edemediği** şey sanal
		 * klavye ve yerel metin seçme jestleri. Bu testlerin iddiası bu
		 * yüzden "mobilde her şey çalışıyor" değil, kararın istediği şey:
		 * "belge yazılabiliyor ve düzen bozulmuyor". Taklit edilemeyenler
		 * bilinen kısıtlar sayfasında yazılı.
		 */
		{
			name: "mobil-safari",
			use: { ...devices["iPhone 15"] },
			testMatch: /mobil\.spec\.ts/,
		},
		{
			name: "mobil-chrome",
			use: { ...devices["Pixel 7"] },
			testMatch: /mobil\.spec\.ts/,
		},
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
