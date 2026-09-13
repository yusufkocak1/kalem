import { defineConfig, devices } from "@playwright/test";

/**
 * Örnek uygulamalar için ayrı yapılandırma  (İş listesi: F5-01 … F5-05)
 *
 * ## Neden ana yapılandırmadan ayrı
 *
 * Yedi örneği, dogfooding uygulamasını ve doküman sitesini kurup
 * başlatmak dakikalar sürüyor (Next.js, Nuxt ve Angular üretim
 * derlemeleri dâhil) ve ana e2e paketi her çalıştığında bu bedeli
 * ödemek, hızlı geri bildirimi öldürürdü. Burada ölçülen şey de farklı:
 * editörün davranışı değil, **paketin bir uygulamaya gerçekten
 * takılabildiği**.
 *
 * ## Tek motor
 *
 * Sarmalayıcılar DOM davranışı üretmiyor; ürettikleri şey çerçevenin
 * yaşam döngüsü. Üç motorda koşturmak aynı React'i üç kez sınamak olurdu —
 * tarayıcı farkları zaten `e2e/*.spec.ts` tarafında ölçülüyor,
 * `<kalem-editor>`ünkiler dâhil (`e2e/wc.spec.ts`).
 *
 * ## Derleme burada değil, `pnpm e2e:examples`in içinde
 *
 * Script önce `pnpm build:examples` çalıştırıyor, sonra bu yapılandırmayı.
 * Yani derleme kırılırsa test hiç başlamıyor — derlemeyi her sunucu
 * komutunun içine koymanın sağladığı güvence aynen duruyor ama örnekler
 * **bir kez** derleniyor. Aşağıdaki komutlar yalnızca servis ediyor.
 *
 * Örnekler yayımlanacak çıktıdan çalışıyor; kaynağa takma ad veren bir
 * geliştirme sunucusu, paketin `exports` haritasındaki bir hatayı
 * gizlerdi.
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
	webServer: [
		{
			command: "pnpm --filter example-react-vite preview --port 4173 --strictPort",
			url: "http://localhost:4173",
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
		},
		{
			command: "pnpm --filter example-nextjs start -p 3100",
			url: "http://localhost:3100",
			reuseExistingServer: false,
			timeout: 120_000,
			stdout: "pipe",
		},
		{
			command: "pnpm --filter example-vue-vite preview --port 4174 --strictPort",
			url: "http://localhost:4174",
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
		},
		{
			// Nitro sunucusu doğrudan çalıştırılıyor: `nuxt preview` bir
			// sarmalayıcı ve port bayrağını sürümden sürüme farklı okuyor.
			command: "node examples/nuxt/.output/server/index.mjs",
			url: "http://localhost:3200",
			env: { PORT: "3200" },
			reuseExistingServer: false,
			timeout: 120_000,
			stdout: "pipe",
		},
		{
			command: "pnpm --filter example-svelte preview --port 4175 --strictPort",
			url: "http://localhost:4175",
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
		},
		{
			// Angular'ın ve düz HTML örneğinin kendi önizleme sunucusu yok;
			// üretim çıktısı depodaki sıfır bağımlılıklı sunucuyla yayınlanıyor.
			command: "node scripts/serve-static.mjs examples/angular/dist/browser 4176",
			url: "http://localhost:4176",
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
		},
		{
			command: "node scripts/serve-static.mjs examples/cdn-vanilla/dist 4177",
			url: "http://localhost:4177",
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
		},
		{
			// Örnek değil, **uygulama**: F5-05'in dogfooding not defteri.
			// Aynı yapılandırmada duruyor çünkü ölçtüğü şey aynı — derlenmiş
			// paketlerin gerçek bir uygulamada çalışması.
			command: "node scripts/serve-static.mjs apps/notlar/dist 4178",
			url: "http://localhost:4178",
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
		},
		{
			// Doküman sitesi: `/canli/` sayfasında vanilla, React ve Vue
			// örnekleri aynı anda çalışıyor (F6-03). Ölçülen şey yine aynı —
			// derlenmiş paketlerin gerçek bir uygulamada çalışması.
			command: "node scripts/serve-static.mjs apps/docs/dist 4179",
			url: "http://localhost:4179",
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
		},
		{
			// Playground (F6-06): ürünün vitrini. `apps/demo` test zemini
			// olduğu için ayrı bir uygulama.
			command: "node scripts/serve-static.mjs apps/playground/dist 4180",
			url: "http://localhost:4180",
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
		},
	],
});
