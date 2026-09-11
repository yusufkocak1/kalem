/**
 * @kalem/plugin-find-replace — Arama  (İş listesi: F4-03)
 *
 * Saf katman: belge girdi, eşleşme listesi çıktı. DOM yok, olay yok — bu
 * yüzden Türkçe kabul kriteri (`ışık` ↔ `IŞIK` eşleşiyor, `ışık` ↔ `İŞİK`
 * eşleşmiyor) tarayıcı açmadan sabitlenebiliyor.
 *
 * ## Neden düzenli ifade değil
 *
 * "Arama" denince akla `new RegExp(sorgu)` geliyor ve üç yerden yanlış:
 *
 * - Kullanıcının yazdığı metin desen değil **metin**: `C++` araması
 *   düzenli ifade olarak geçersiz, `a.b` ise `axb`yi de bulur.
 * - Kaçırma (`escape`) eklemek bunu çözüyor ama `i` bayrağı Türkçe'yi
 *   bilmiyor: `IŞIK` ile `ışık` eşleşmiyor, kabul kriteri düşüyor.
 * - Kullanıcının yazdığı desenin çalışma süresi denetlenemiyor
 *   (katastrofik geri izleme).
 *
 * Bunun yerine katlanmış metinde `indexOf` taranıyor: öngörülebilir,
 * locale'i doğru ve 100 sayfalık belgede taranan karakter sayısı kadar
 * iş yapıyor.
 *
 * ## Performans
 *
 * Kabul kriteri "100 sayfalık dokümanda takılmadan çalışıyor". Tarama
 * belge uzunluğunda doğrusal; asıl bedel **katlama**, çünkü her karakter
 * için bir eşleme tablosu üretiyor. Bu yüzden katlanmış metin bölge
 * bölge önbelleğe alınıyor (`createIndex`): kullanıcı arama kutusuna her
 * harf eklediğinde belge yeniden katlanmıyor, yalnızca yeniden taranıyor.
 */
import type { Root } from "@kalem/core";
import type { FoldedText } from "./fold.js";
import { atWordBoundary, foldCase } from "./fold.js";
import type { Region } from "./regions.js";
import { regionsOf } from "./regions.js";

export interface SearchOptions {
	/** Büyük/küçük harf duyarlı arama (varsayılan: değil). */
	readonly caseSensitive?: boolean;
	/** Yalnızca tam kelime eşleşmeleri. */
	readonly wholeWord?: boolean;
	/**
	 * Eşleşme üst sınırı (varsayılan 5000).
	 *
	 * Tek harflik bir aramada eşleşme sayısı belgenin karakter sayısına
	 * yaklaşıyor ve hepsini boyamak, arama kutusundaki her tuş vuruşunda
	 * on binlerce `<span>` demek. Sınır, "e" yazan kullanıcının editörü
	 * kilitlememesi için.
	 */
	readonly limit?: number;
}

/** Belgedeki bir eşleşme. */
export interface Match {
	/** Bölgenin `regionsOf` sırasındaki indisi. */
	readonly regionIndex: number;
	readonly blockIndex: number;
	readonly path: readonly number[];
	/** Bölge metnindeki aralık — özgün metne göre, katlanmışa göre değil. */
	readonly from: number;
	readonly to: number;
}

/**
 * Yeniden kullanılabilir arama dizini.
 *
 * Belge değişmediği sürece katlama tekrar yapılmıyor. Sorgu her tuşta
 * değişiyor, belge değişmiyor — pahalı olanı önbelleğe alan ayrım bu.
 */
export interface SearchIndex {
	readonly regions: readonly Region[];
	/** Bölge başına katlanmış metin; duyarlı aramada kullanılmıyor. */
	readonly folded: readonly FoldedText[];
	readonly locale: string;
}

export function createIndex(doc: Root, locale = "en"): SearchIndex {
	const regions = regionsOf(doc);
	return { regions, folded: regions.map((r) => foldCase(r.text, locale)), locale };
}

/**
 * Sorgunun belgedeki bütün eşleşmeleri, belge sırasında.
 *
 * Boş sorgu hiçbir şeyle eşleşmiyor. (Slash menüsündeki kuralın tersi:
 * orada boş sorgu "hepsini göster" demek, burada "hiçbir şey arama".)
 */
export function findMatches(
	index: SearchIndex,
	query: string,
	options: SearchOptions = {},
): Match[] {
	const out: Match[] = [];
	if (query === "") return out;

	const limit = options.limit ?? 5000;
	const duyarli = options.caseSensitive === true;
	const tamKelime = options.wholeWord === true;
	const aranan = duyarli ? query : foldCase(query, index.locale).text;
	if (aranan === "") return out;

	for (const [regionIndex, region] of index.regions.entries()) {
		const katlanmis = index.folded[regionIndex] as FoldedText;
		const metin = duyarli ? region.text : katlanmis.text;

		let pos = metin.indexOf(aranan);
		while (pos >= 0) {
			const bit = pos + aranan.length;
			if (!tamKelime || atWordBoundary(metin, pos, bit)) {
				// Duyarlı aramada metin zaten özgün; duyarsızda katlanmış
				// konumu özgün indise çeviriyoruz (bkz. `fold.ts`).
				const from = duyarli ? pos : (katlanmis.map[pos] as number);
				const to = duyarli ? bit : (katlanmis.map[bit] as number);
				out.push({ regionIndex, blockIndex: region.blockIndex, path: region.path, from, to });
				if (out.length >= limit) return out;
			}
			// Örtüşen eşleşme yok: "aaa" içinde "aa" bir kez bulunuyor.
			// Değiştirme örtüşen aralıklarla anlamsız olurdu.
			pos = metin.indexOf(aranan, bit);
		}
	}

	return out;
}

/**
 * İmleçten sonraki ilk eşleşmenin indisi; yoksa başa dönüyor.
 *
 * Kullanıcı Ctrl+F'ye bastığında arama, baktığı yerden ileri gitmeli —
 * belgenin başına atlamak, uzun bir belgede okuduğu yeri kaybettiriyor.
 * Sonuna gelindiğinde başa sarıyor (Word ve tarayıcı aramasıyla aynı).
 */
export function nextFrom(matches: readonly Match[], regionIndex: number, offset: number): number {
	if (matches.length === 0) return -1;
	for (const [i, m] of matches.entries()) {
		if (m.regionIndex > regionIndex || (m.regionIndex === regionIndex && m.from >= offset)) {
			return i;
		}
	}
	return 0;
}

/** Bölge dizinindeki konumdan önceki son eşleşme; yoksa sona sarıyor. */
export function previousFrom(
	matches: readonly Match[],
	regionIndex: number,
	offset: number,
): number {
	if (matches.length === 0) return -1;
	for (let i = matches.length - 1; i >= 0; i--) {
		const m = matches[i] as Match;
		if (m.regionIndex < regionIndex || (m.regionIndex === regionIndex && m.to <= offset)) return i;
	}
	return matches.length - 1;
}
