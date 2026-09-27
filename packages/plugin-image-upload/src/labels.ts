/**
 * @kalem-editor/plugin-image-upload — Metinler  (İş listesi: F4-01)
 *
 * Eklentinin kullanıcıya gösterdiği her metin burada. `@kalem-editor/ui`nin
 * sözlüğüyle aynı kalıp: düz bir nesne, çeviri kütüphanesi yok.
 *
 * Ayrı bir sözlük olmasının sebebi bağımlılık: eklenti `@kalem-editor/ui`ye
 * bağlanırsa, kendi arayüzünü yazan bir uygulama görsel yüklemeyi almak
 * için bütün arayüz katmanını indirmek zorunda kalırdı.
 */

export interface ImageLabels {
	/** Görsel olmayan dosya bırakıldığında. */
	readonly rejectedType: string;
	/** Boyut sınırı aşıldığında. */
	readonly rejectedSize: string;
	/** Yükleme sürerken görselin erişilebilir durumu. */
	readonly uploading: string;
	/** Alt metin düzenleme alanının etiketi. */
	readonly altLabel: string;
	/** Alt metni olmayan görsel için uyarı. */
	readonly altMissing: string;
}

export const enImageLabels: ImageLabels = {
	rejectedType: "Only images can be added",
	rejectedSize: "This file is too large",
	uploading: "Uploading",
	altLabel: "Alt text",
	altMissing: "Describe this image",
};

export const trImageLabels: ImageLabels = {
	rejectedType: "Yalnızca görsel eklenebilir",
	rejectedSize: "Bu dosya çok büyük",
	uploading: "Yükleniyor",
	altLabel: "Alt metin",
	altMissing: "Bu görseli tarif edin",
};

/** Belge diline göre sözlük; yalnızca dil koduna bakılıyor, bölgeye değil. */
export function labelsFor(lang: string | null | undefined): ImageLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trImageLabels : enImageLabels;
}
