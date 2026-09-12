import { defineConfig } from "tsdown";

export default defineConfig([
	{
		/*
		 * İki giriş: `@kalem/wc` (yan etkisiz) ve `@kalem/wc/define` (kaydeden).
		 *
		 * Ayrımın sebebi `sideEffects` beyanı: paketleyici yan etkisiz bir
		 * modülü, dışa aktardığı hiçbir şey kullanılmıyorsa atıyor. Tek giriş
		 * olsaydı `import "@kalem/wc"` yazan bir uygulamada eleman **hiç
		 * kaydolmazdı** ve hata sessiz olurdu.
		 */
		entry: ["src/index.ts", "src/define-side-effect.ts"],
		format: ["esm", "cjs"],
		dts: true,
		clean: true,
		treeshake: true,
		platform: "neutral",
	},
	{
		/*
		 * CDN sürümü: `<script>` etiketiyle düşüyor.
		 *
		 * `noExternal` bilerek: yukarıdaki çıktı `@kalem/core` ve
		 * `@kalem/editor`i dışarıda bırakıyor (paketleyici kullanan
		 * uygulamada doğrusu bu), ama çıplak bir `import "@kalem/editor"`
		 * satırı tarayıcıda çözülmez. Burada hepsi içeride.
		 *
		 * `clean` kapalı — ilk yapılandırmanın çıktısını silerdi.
		 */
		// Dosya adı `kalem-editor.iife.js` — CDN bağlantısında okunan ad.
		entry: { "kalem-editor": "src/global.ts" },
		format: ["iife"],
		globalName: "Kalem",
		platform: "browser",
		noExternal: [/^@kalem\//],
		minify: true,
		dts: false,
		clean: false,
		sourcemap: false,
	},
]);
