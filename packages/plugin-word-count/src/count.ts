/**
 * @kalem-editor/plugin-word-count — Sayma  (İş listesi: F4-05)
 *
 * Saf katman: belge girdi, sayılar çıktı.
 *
 * ## Kelime nedir
 *
 * "Boşluklara böl" cevabı yalnızca boşluk kullanan diller için doğru.
 * Japonca ve Çince'de bir cümle tek bir "kelime" sayılır, yani sayaç
 * o belgelerde **1** yazar. Bu yüzden `Intl.Segmenter` kullanılıyor:
 * tarayıcının kendi sözcük sınırı tablosu, bizim yazacağımız hiçbir
 * düzenli ifadenin ulaşamayacağı bir doğrulukta ve zaten orada — ek bir
 * byte indirilmiyor.
 *
 * `Segmenter` yoksa (eski tarayıcı) boşluk ayırmaya düşülüyor: Türkçe ve
 * Batı dilleri için doğru, CJK için düşük. Sayaç kırılmıyor, yalnızca
 * kabalaşıyor.
 *
 * ## Okuma süresi neden kelimeden
 *
 * Okuma hızı araştırmaları kelime/dakika veriyor ve ortalama sessiz okuma
 * 200–250 arası. Varsayılan 200: düşük tahmin, kullanıcıyı "daha uzun
 * sürdü" diye şaşırtmıyor. Boşluk kullanmayan diller kelime yerine
 * karakterle ölçülüyor (`cjkCharsPerMinute`), çünkü orada kelime sayısı
 * zaten sözcük sınırından geliyor ve dakika başına düşen miktar farklı.
 */

export interface Counts {
	readonly words: number;
	readonly characters: number;
	/** Boşluksuz karakter — yayıncılıkta kullanılan ölçü. */
	readonly charactersNoSpaces: number;
	/** Dakika cinsinden okuma süresi, yukarı yuvarlanmış (en az 1). */
	readonly minutes: number;
}

export interface CountOptions {
	/** Kelime sınırı için dil; belgenin `lang`'i. */
	readonly locale?: string;
	/** Kelime/dakika (varsayılan 200). */
	readonly wordsPerMinute?: number;
}

const BOSLUK = /\s+/u;
/** Yalnızca noktalama ve sembollerden oluşan parçalar kelime değil. */
const HARF = /[\p{L}\p{N}]/u;

/**
 * Segmenter örnekleri locale başına saklanıyor.
 *
 * Kurulumu pahalı (dil verisi yükleniyor) ve sayaç her tuş vuruşunda
 * çalışıyor; her çağrıda yenisini kurmak, sayacın kendisini belgenin en
 * yavaş parçası yapardı.
 */
const boluculer = new Map<string, Intl.Segmenter | null>();

function bolucu(locale: string): Intl.Segmenter | null {
	const hazir = boluculer.get(locale);
	if (hazir !== undefined) return hazir;
	let yeni: Intl.Segmenter | null = null;
	try {
		yeni = new Intl.Segmenter(locale, { granularity: "word" });
	} catch {
		// `Intl.Segmenter` yok ya da locale geçersiz: boşluk ayırmaya düşüyoruz.
		yeni = null;
	}
	boluculer.set(locale, yeni);
	return yeni;
}

/** Metindeki kelime sayısı. */
export function countWords(text: string, locale = "en"): number {
	if (text.trim() === "") return 0;

	const seg = bolucu(locale);
	if (seg === null) {
		return text.split(BOSLUK).filter((parca) => HARF.test(parca)).length;
	}

	let n = 0;
	for (const parca of seg.segment(text)) {
		// `isWordLike` noktalama ve boşluğu eliyor; "merhaba, dünya!" iki
		// kelime, dört değil.
		if (parca.isWordLike === true) n += 1;
	}
	return n;
}

/** Metnin sayıları. */
export function countText(text: string, options: CountOptions = {}): Counts {
	const words = countWords(text, options.locale ?? "en");
	const wpm = options.wordsPerMinute ?? 200;
	return {
		words,
		characters: [...text].length,
		charactersNoSpaces: [...text.replace(/\s+/gu, "")].length,
		// Boş belge 0 dakika; bir kelime bile varsa en az 1 dakika yazıyor —
		// "0 dakika" hiçbir şey söylemiyor.
		minutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / wpm)),
	};
}

/**
 * Karakter neden `[...text].length`
 *
 * `String.length` kod **birimi** sayıyor: bir emoji 2, bazı yazılar 4
 * çıkıyor. Kullanıcının "karakter" dediği şey kod noktası; yayıncılıkta
 * sınırlar da öyle sayılıyor.
 */
