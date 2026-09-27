/**
 * @kalem-editor/plugin-word-count — Metinler  (İş listesi: F4-05)
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

/*
 * Sayı biçimi sözlüğün içinde  (İş listesi: F6-10)
 *
 * F6-10'a kadar sayılar ham basılıyordu: 440 bin karakterlik belgede
 * "439689 karakter". Hem okunmuyor hem de dile göre farklı olması
 * gerekiyor — Türkçe'de binlik ayırıcı nokta ("439.689"), İngilizce'de
 * virgül ("439,689").
 *
 * Biçimleyici her sözlüğün **kendi dilinde** sabit: Türkçe sözlüğü seçen
 * belge zaten Türkçe. Sözlüğe dışarıdan locale geçirmek hem imzayı
 * değiştirirdi (kendi sözlüğünü yazan kullanıcıyı kırardı) hem de "Türkçe
 * metin, İngilizce sayı" gibi kendi içinde tutarsız bir sonuca kapı
 * açardı.
 *
 * Örnekler modül düzeyinde bir kez kuruluyor: `Intl.NumberFormat` kurmak
 * ucuz değil ve sayaç her değişiklikte yeniden çiziliyor.
 */
const EN = new Intl.NumberFormat("en");
const TR = new Intl.NumberFormat("tr");

export const enWordCountLabels: WordCountLabels = {
	title: "Document statistics",
	words: (n) => (n === 1 ? "1 word" : `${EN.format(n)} words`),
	characters: (n) => (n === 1 ? "1 character" : `${EN.format(n)} characters`),
	minutes: (n) => (n === 1 ? "1 min read" : `${EN.format(n)} min read`),
};

export const trWordCountLabels: WordCountLabels = {
	title: "Belge istatistikleri",
	words: (n) => `${TR.format(n)} kelime`,
	characters: (n) => `${TR.format(n)} karakter`,
	minutes: (n) => `${TR.format(n)} dk okuma`,
};

/** Belge diline göre sözlük; yalnızca dil koduna bakılıyor, bölgeye değil. */
export function labelsFor(lang: string | null | undefined): WordCountLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trWordCountLabels : enWordCountLabels;
}
