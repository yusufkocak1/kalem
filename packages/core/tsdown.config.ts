import { defineConfig } from "tsdown";

export default defineConfig({
	// İki giriş noktası: `@kalem/core` ve `@kalem/core/html`.
	// HTML dönüştürücü yalnızca yapıştırma yolunda gerekir; Markdown işleyen
	// kullanıcı onu indirmemeli (analiz §5.3 — tembel yüklenebilirlik).
	entry: ["src/index.ts", "src/commands.ts", "src/html.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
	platform: "neutral",
});
