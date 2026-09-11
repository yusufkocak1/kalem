import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
	platform: "neutral",
	// React ve JSX çalışma zamanı **dışarıda**: ikisi de peer bağımlılık ve
	// paketlemek, uygulamanın React'iyle ikinci bir kopya çalıştırmak olurdu.
	external: ["react", "react/jsx-runtime"],
	outputOptions: {
		/*
		 * `"use client"` paketleyici tarafından **düşürülüyor**.
		 *
		 * Kaynakta `KalemEditor.tsx`in başında duruyor ama rolldown modülleri
		 * birleştirirken yönergeyi atıyor. Next.js App Router'da sonuç şu:
		 * bir sunucu bileşeni `<KalemEditor>` import ettiğinde "useState
		 * yalnızca istemci bileşenlerinde çalışır" hatası alıyor — yani
		 * F5-01'in uyumluluk sözü, derleme çıktısında sessizce bozuluyordu.
		 *
		 * Bant (banner) olarak yeniden yazılıyor. Bütün pakete uygulanması
		 * doğru: buradaki her satır React kancası kullanıyor, hiçbiri
		 * sunucuda çalışamaz.
		 */
		banner: '"use client";',
	},
});
