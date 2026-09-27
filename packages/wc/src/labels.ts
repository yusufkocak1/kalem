/**
 * @kalem-editor/wc — Metinler  (İş listesi: F5-03)
 *
 * Tek bir kullanıcı metni var: `required` verilmiş ve belge boşken form
 * gönderiminde gösterilen doğrulama mesajı. Tarayıcı bunu kendi
 * `<input required>` için üretiyor ama özel elemana vermiyor —
 * `setValidity()` mesajı **zorunlu** istiyor.
 *
 * Sözlük eklentilerdeki kalıbın aynısı: dil koduna göre seçiliyor,
 * `required-message` özniteliğiyle ya da `requiredMessage` özelliğiyle
 * ezilebiliyor.
 */

export interface WcLabels {
	/** `required` verilmiş ve belge boş. */
	readonly valueMissing: string;
}

export const enWcLabels: WcLabels = {
	valueMissing: "Please fill out this field.",
};

export const trWcLabels: WcLabels = {
	valueMissing: "Bu alan boş bırakılamaz.",
};

/** Belge diline göre sözlük; yalnızca dil koduna bakılıyor, bölgeye değil. */
export function labelsFor(lang: string | null | undefined): WcLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trWcLabels : enWcLabels;
}
