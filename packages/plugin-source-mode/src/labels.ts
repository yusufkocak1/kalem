/**
 * @kalem/plugin-source-mode — Metinler  (İş listesi: F4-06)
 */

export interface SourceLabels {
	/** Kaynak kutusunun erişilebilir adı. */
	readonly label: string;
	/** Kipi değiştiren düğmenin adı — kendi düğmesini koyan uygulama için. */
	readonly toggle: string;
}

export const enSourceLabels: SourceLabels = {
	label: "Markdown source",
	toggle: "Markdown source",
};

export const trSourceLabels: SourceLabels = {
	label: "Markdown kaynağı",
	toggle: "Markdown kaynağı",
};

/** Belge diline göre sözlük; yalnızca dil koduna bakılıyor, bölgeye değil. */
export function labelsFor(lang: string | null | undefined): SourceLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trSourceLabels : enSourceLabels;
}
