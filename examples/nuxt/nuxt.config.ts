/**
 * Örnek uygulama — Nuxt SSR  (İş listesi: F5-02)
 *
 * Kalem'e özel tek ayar tema CSS'i. `build.transpile` yok, `ssr: false`
 * yok, `<ClientOnly>` yok: belge sunucuda `@kalem-editor/viewer` ile çiziliyor ve
 * editör istemcide aynı elemanı devralıyor.
 */
export default defineNuxtConfig({
	compatibilityDate: "2025-01-01",
	devtools: { enabled: false },
	css: [
		"@kalem-editor/themes/tokens.css",
		"@kalem-editor/themes/viewer.css",
		"@kalem-editor/themes/editor.css",
	],
});
