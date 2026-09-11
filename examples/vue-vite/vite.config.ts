import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/**
 * Örnek uygulama — Vite + Vue  (İş listesi: F5-02)
 *
 * Yapılandırmada Kalem'e özel hiçbir şey yok: paket sıradan bir npm
 * bağımlılığı gibi davranıyor.
 */
export default defineConfig({
	plugins: [vue()],
});
