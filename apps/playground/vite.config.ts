import { defineConfig } from "vite";

/**
 * Kalem playground  (İş listesi: F6-06)
 *
 * Yapılandırmada Kalem'e özel tek satır yok: paketler sıradan npm
 * bağımlılığı gibi tüketiliyor ve **yayımlanacak çıktıdan** geliyor.
 * Kaynağa takma ad veren bir kurulum, `exports` haritasındaki bir hatayı
 * gizlerdi.
 *
 * `base` göreli: uygulama bir alt yolda da servis edilebiliyor.
 */
export default defineConfig({
	base: "./",
});
