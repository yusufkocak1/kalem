import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Kalem Notlar — Vite yapılandırması  (İş listesi: F5-05)
 *
 * Kalem'e ait tek satır yok: uygulama paketleri sıradan npm bağımlılığı
 * gibi tüketiyor. Dogfooding'in anlamı da bu — kütüphane kendi deposunda
 * ayrıcalıklı davranıyorsa ölçtüğü şey gerçek kullanım olmaz.
 *
 * `base` göreli: uygulama bir alt yolda da servis edilebiliyor.
 */
export default defineConfig({
	base: "./",
	plugins: [react()],
});
