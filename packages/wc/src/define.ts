/**
 * @kalem-editor/wc — Kayıt  (İş listesi: F5-03)
 *
 * Kayıt neden otomatik değil: `customElements.define` global bir isim
 * alanına yazıyor ve aynı adı iki kez kaydetmek **hata atıyor**. Bir
 * kütüphane bunu import edilir edilmez yapsaydı, aynı sayfada iki sürümü
 * bulunan bir uygulama (mikro-ön uç, iki bağımlılığın farklı sürümleri)
 * kendini açılışta patlamış bulurdu.
 *
 * Onun yerine çağrı açık ve **tekrarlanabilir**: ad zaten kayıtlıysa
 * sessizce geçiliyor.
 */
import { kalemEditorElement } from "./element.js";

/**
 * `<kalem-editor>` etiketini kaydeder.
 *
 * @param tag Etiket adı. Tire zorunlu (platform kuralı); farklı bir ad
 *   vermek aynı sayfada iki sürümü yan yana çalıştırmayı mümkün kılıyor.
 * @returns Kaydın bu çağrıyla yapılıp yapılmadığı.
 */
export function defineKalemEditor(tag = "kalem-editor"): boolean {
	/*
	 * Sunucuda (SSR) kayıt yapılmıyor ve hata da atılmıyor.
	 *
	 * SvelteKit, Astro ve Nuxt bileşenin betiğini sunucuda da çalıştırıyor;
	 * belgelerdeki `import '@kalem-editor/wc/define'` satırı orada
	 * `customElements is not defined` ile **sunucuyu** çökertiyordu.
	 * Yayın provası (F6-12), paketi Node'da içe aktarırken buldu. Sınıfın
	 * kendisi zaten tembel kuruluyor (`element.ts`); eksik olan buydu.
	 */
	if (typeof customElements === "undefined") return false;
	if (customElements.get(tag) !== undefined) return false;
	customElements.define(tag, kalemEditorElement());
	return true;
}
