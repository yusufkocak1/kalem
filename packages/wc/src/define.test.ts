import { describe, expect, it } from "vitest";
import { defineKalemEditor } from "./define.js";

/**
 * Sunucuda kayıt  (F6-12 yayın provası)
 *
 * Bu dosya Node ortamında koşuyor: `customElements` ve `HTMLElement` yok.
 * SvelteKit, Astro ve Nuxt bileşen betiğini sunucuda da çalıştırıyor;
 * `import '@kalem/wc/define'` orada sunucuyu çökertmemeli.
 */
describe("defineKalemEditor — sunucuda", () => {
	it("customElements yokken hata atmadan false döndürüyor", () => {
		expect(typeof (globalThis as { customElements?: unknown }).customElements).toBe("undefined");
		expect(defineKalemEditor()).toBe(false);
	});

	it("yan etkili giriş sunucuda içe aktarılabiliyor", async () => {
		await expect(import("./define-side-effect.js")).resolves.toBeDefined();
	});
});
