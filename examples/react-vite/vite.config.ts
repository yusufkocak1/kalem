import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Örnek uygulama — Vite + React  (İş listesi: F5-01)
 *
 * Yapılandırmada Kalem'e özel hiçbir şey yok ve olay budur: paket sıradan
 * bir npm bağımlılığı gibi davranıyor, takma ad ya da derleme hilesi
 * gerektirmiyor.
 */
export default defineConfig({
	plugins: [react()],
});
