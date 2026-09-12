import { defineConfig } from "tsdown";

export default defineConfig({
	/*
	 * İki giriş: `@kalem/wc` (yan etkisiz) ve `@kalem/wc/define` (kaydeden).
	 *
	 * Ayrımın sebebi `sideEffects: false`: paketleyici yan etkisiz bir
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
});
