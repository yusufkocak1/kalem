/**
 * Örnek uygulama — Nuxt SSR  (İş listesi: F5-02)
 *
 * Kalem'e özel tek ayar tema CSS'i. `build.transpile` yok, `ssr: false`
 * yok, `<ClientOnly>` yok: belge sunucuda `@kalem/viewer` ile çiziliyor ve
 * editör istemcide aynı elemanı devralıyor.
 */
export default defineNuxtConfig({
	compatibilityDate: "2025-01-01",
	devtools: { enabled: false },
	css: ["@kalem/themes/tokens.css", "@kalem/themes/viewer.css", "@kalem/themes/editor.css"],
});
