import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/**
 * Örnek uygulama — Vite + Svelte  (İş listesi: F5-03)
 *
 * Svelte için bir Kalem sarmalayıcısı **yok** ve gerek de yok:
 * `<kalem-editor>` tarayıcının kendi bileşen modeli, Svelte onu sıradan
 * bir eleman gibi görüyor.
 */
export default defineConfig({
	plugins: [svelte()],
});
