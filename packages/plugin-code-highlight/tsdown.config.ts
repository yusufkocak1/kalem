import { defineConfig } from "tsdown";

/**
 * Diller **ayrı giriş noktası**.
 *
 * Kabul kriteri "vurgulama kullanılmadığında ana bundle'a 0 byte ekliyor"
 * diyor; bunun ikinci yarısı dil paketleri. Her gramer kendi dosyasına
 * çıkıyor ve `languages.ts` onları `import()` ile çağırıyor — Python
 * yazmayan kullanıcı Python gramerini indirmiyor.
 *
 * Çıktı adlarının tahmin edilebilir olması ayrıca gerekli: `size-limit`
 * bir dil paketini adıyla ölçüyor, yani "ayrı chunk" iddiası her
 * `pnpm verify`de sınanıyor.
 */
export default defineConfig({
	entry: ["src/index.ts", "src/langs/*.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
	platform: "neutral",
});
