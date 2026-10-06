/**
 * @kalem-editor/plugin-find-replace — Metinler  (İş listesi: F4-03)
 *
 * Kullanıcıya görünen her metin burada. `@kalem-editor/plugin-image-upload` ile
 * aynı kalıp: düz bir nesne, çeviri kütüphanesi yok, `@kalem-editor/ui`ye
 * bağımlılık yok (kendi arayüzünü yazan uygulama, bul-değiştir için bütün
 * arayüz katmanını indirmemeli).
 *
 * `count` bir fonksiyon: "3 / 12" biçimi her dilde aynı değil ve sayıyı
 * dizeye gömen bir şablon, çeviride sırayı sabitleyip kilitliyor.
 */

export interface FindLabels {
	/** Panelin erişilebilir adı. */
	readonly panel: string;
	readonly find: string;
	readonly replace: string;
	readonly next: string;
	readonly previous: string;
	readonly replaceOne: string;
	readonly replaceAll: string;
	readonly close: string;
	readonly caseSensitive: string;
	readonly wholeWord: string;
	/** Sonuç yok. */
	readonly noResults: string;
	/** "3 / 12" gibi bir sayaç. */
	readonly count: (current: number, total: number) => string;
	/** Sınıra takılan sonuç sayısı ("5000+"). */
	readonly limited: (total: number) => string;
	/** Ekran okuyucuya bildirilen sonuç ("12 sonuç"). */
	readonly results: (total: number) => string;
	/** Salt okunur belgede değiştirme denendiğinde. */
	readonly readOnly: string;
	/**
	 * Arama modları ve diğer seçenekler. Sonradan eklendiler; verilmezse
	 * İngilizce metin kullanılıyor (kendi sözlüğünü veren uygulama bozulmasın).
	 */
	/** Mod seçicinin adı. */
	readonly mode?: string;
	readonly modeNormal?: string;
	readonly modeExtended?: string;
	readonly modeRegex?: string;
	readonly wrapAround?: string;
	/** Geçersiz düzenli ifade. */
	readonly invalidPattern?: string;
	/** Başa sarma kapalıyken belgenin sonuna (ya da başına) gelindi. */
	readonly endReached?: string;
}

export const enFindLabels: FindLabels = {
	panel: "Find and replace",
	find: "Find",
	replace: "Replace with",
	next: "Next match",
	previous: "Previous match",
	replaceOne: "Replace",
	replaceAll: "Replace all",
	close: "Close",
	caseSensitive: "Match case",
	wholeWord: "Whole word",
	noResults: "No results",
	count: (current, total) => `${current} / ${total}`,
	limited: (total) => `${total}+`,
	results: (total) => (total === 1 ? "1 result" : `${total} results`),
	readOnly: "This document is read-only",
	mode: "Search mode",
	modeNormal: "Normal",
	modeExtended: "Extended (\\n, \\t, \\x…)",
	modeRegex: "Regular expression",
	wrapAround: "Wrap around",
	invalidPattern: "Invalid expression",
	endReached: "Reached the end",
};

export const trFindLabels: FindLabels = {
	panel: "Bul ve değiştir",
	find: "Bul",
	replace: "Şununla değiştir",
	next: "Sonraki eşleşme",
	previous: "Önceki eşleşme",
	replaceOne: "Değiştir",
	replaceAll: "Tümünü değiştir",
	close: "Kapat",
	caseSensitive: "Büyük/küçük harf duyarlı",
	wholeWord: "Tam kelime",
	noResults: "Sonuç yok",
	count: (current, total) => `${current} / ${total}`,
	limited: (total) => `${total}+`,
	results: (total) => `${total} sonuç`,
	readOnly: "Bu belge salt okunur",
	mode: "Arama modu",
	modeNormal: "Normal",
	modeExtended: "Genişletilmiş (\\n, \\t, \\x…)",
	modeRegex: "Düzenli ifade",
	wrapAround: "Başa sar",
	invalidPattern: "Geçersiz ifade",
	endReached: "Sona ulaşıldı",
};

/** Belge diline göre sözlük; yalnızca dil koduna bakılıyor, bölgeye değil. */
export function labelsFor(lang: string | null | undefined): FindLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trFindLabels : enFindLabels;
}
