/**
 * @kalem-editor/plugin-outline — Metinler  (İş listesi: F4-04)
 *
 * İki metin; yine de ayrı dosya, çünkü diğer eklentilerle aynı kalıp ve
 * gömen uygulama `labels` seçeneğiyle ikisini de değiştirebiliyor.
 */

export interface OutlineLabels {
	/** Panelin erişilebilir adı. */
	readonly title: string;
	/** Belgede hiç başlık yokken. */
	readonly empty: string;
}

export const enOutlineLabels: OutlineLabels = {
	title: "Table of contents",
	empty: "No headings yet",
};

export const trOutlineLabels: OutlineLabels = {
	title: "İçindekiler",
	empty: "Henüz başlık yok",
};

/** Belge diline göre sözlük; yalnızca dil koduna bakılıyor, bölgeye değil. */
export function labelsFor(lang: string | null | undefined): OutlineLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trOutlineLabels : enOutlineLabels;
}
