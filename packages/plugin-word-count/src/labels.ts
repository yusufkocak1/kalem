/**
 * @kalem/plugin-word-count — Metinler  (İş listesi: F4-05)
 *
 * Hepsi fonksiyon, çünkü hepsi sayı taşıyor ve **çoğul kuralı dile
 * bağlı**: İngilizce'de "1 word / 2 words", Türkçe'de her ikisi de
 * "kelime". Şablona sayı gömen bir dize bunu ifade edemiyor.
 */

export interface WordCountLabels {
	/** Durum çubuğunun erişilebilir adı. */
	readonly title: string;
	readonly words: (n: number) => string;
	readonly characters: (n: number) => string;
	readonly minutes: (n: number) => string;
}

export const enWordCountLabels: WordCountLabels = {
	title: "Document statistics",
	words: (n) => (n === 1 ? "1 word" : `${n} words`),
	characters: (n) => (n === 1 ? "1 character" : `${n} characters`),
	minutes: (n) => (n === 1 ? "1 min read" : `${n} min read`),
};

export const trWordCountLabels: WordCountLabels = {
	title: "Belge istatistikleri",
	words: (n) => `${n} kelime`,
	characters: (n) => `${n} karakter`,
	minutes: (n) => `${n} dk okuma`,
};

/** Belge diline göre sözlük; yalnızca dil koduna bakılıyor, bölgeye değil. */
export function labelsFor(lang: string | null | undefined): WordCountLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trWordCountLabels : enWordCountLabels;
}
