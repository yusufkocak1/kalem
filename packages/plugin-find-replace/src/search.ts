/**
 * @kalem-editor/plugin-find-replace — Arama  (İş listesi: F4-03)
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
 * Düzenli ifade yine de **ayrı bir mod** olarak var (`mode: "regex"`):
 * Notepad++ kullanıcısı onu bekliyor ve seçen kullanıcı yazdığının desen
 * olduğunu biliyor. Varsayılan mod yukarıdaki gerekçelerle düz metin.
 *
 * ## Performans
 *
 * Kabul kriteri "100 sayfalık dokümanda takılmadan çalışıyor". Tarama
 * belge uzunluğunda doğrusal; asıl bedel **katlama**, çünkü her karakter
 * için bir eşleme tablosu üretiyor. Bu yüzden katlanmış metin bölge
 * bölge önbelleğe alınıyor (`createIndex`): kullanıcı arama kutusuna her
 * harf eklediğinde belge yeniden katlanmıyor, yalnızca yeniden taranıyor.
 */
import type { Root } from "@kalem-editor/core";
import type { FoldedText } from "./fold.js";
import { atWordBoundary, foldCase } from "./fold.js";
import type { Region } from "./regions.js";
import { regionsOf } from "./regions.js";

/**
 * Sorgunun nasıl okunduğu (Notepad++'taki üç mod).
 *
 * - `normal`: yazılan metin aynen aranıyor.
 * - `extended`: `\n`, `\t`, `\r`, `\0`, `\xHH`, `\uHHHH` ve `\\` kaçışları
 *   çözülüyor; paragraf içindeki satır sonu `\n` ile bulunabiliyor.
 * - `regex`: JavaScript düzenli ifadesi. Bkz. üstteki not: kullanıcının
 *   **açıkça seçtiği** bir mod; büyük/küçük harf katlaması burada
 *   locale'siz (`i` bayrağı), `^` ve `$` her bölgede satır başı/sonu.
 */
export type SearchMode = "normal" | "extended" | "regex";

export interface SearchOptions {
	/** Varsayılan `normal`. */
	readonly mode?: SearchMode;
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

const KACISLAR: Readonly<Record<string, string>> = { n: "\n", r: "\r", t: "\t", "0": "\0" };

/** Genişletilmiş moddaki kaçışları çözer; tanınmayan `\x` yalnızca `x` olur. */
export function unescapeExtended(text: string): string {
	return text.replace(
		/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|([\s\S]))/g,
		(_, hex?: string, uni?: string, ch?: string) =>
			hex !== undefined || uni !== undefined
				? String.fromCharCode(Number.parseInt((hex ?? uni) as string, 16))
				: (KACISLAR[ch as string] ?? (ch as string)),
	);
}

/**
 * Düzenli ifade modunda sorgunun deseni.
 *
 * Geçersiz desende `SyntaxError` fırlatıyor; panel bunu "geçersiz ifade"
 * olarak gösteriyor.
 */
export function compilePattern(query: string, caseSensitive: boolean, sticky = false): RegExp {
	return new RegExp(query, `${sticky ? "y" : "g"}m${caseSensitive ? "" : "i"}`);
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
	if (options.mode === "regex")
		return desenle(index, compilePattern(query, duyarli), tamKelime, limit);

	const metinSorgu = options.mode === "extended" ? unescapeExtended(query) : query;
	const aranan = duyarli ? metinSorgu : foldCase(metinSorgu, index.locale).text;
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

function desenle(index: SearchIndex, desen: RegExp, tamKelime: boolean, limit: number): Match[] {
	const out: Match[] = [];
	for (const [regionIndex, region] of index.regions.entries()) {
		const metin = region.text;
		desen.lastIndex = 0;
		for (let m = desen.exec(metin); m !== null; m = desen.exec(metin)) {
			const from = m.index;
			const to = from + m[0].length;
			// Boş eşleşme (`a*`, `^`) bir şey bulmuyor; yerinde saymak sonsuz döngü olurdu.
			if (to === from) {
				desen.lastIndex = from + 1;
				continue;
			}
			if (tamKelime && !atWordBoundary(metin, from, to)) continue;
			out.push({ regionIndex, blockIndex: region.blockIndex, path: region.path, from, to });
			if (out.length >= limit) return out;
		}
	}
	return out;
}

/**
 * Eşleşmenin yerine konacak metin.
 *
 * Düzenli ifadede `$1`, `$&`, `$<ad>` eşleşmenin kendi gruplarıyla
 * dolduruluyor. Desen bölgenin bütün metni üzerinde, eşleşmenin başından
 * yapışkan (`y`) çalıştırılıyor: geriye bakan (`(?<=…)`) desenler
 * eşleşmenin solundaki metni görebilsin.
 */
export function replacementFor(
	index: SearchIndex,
	match: Match,
	query: string,
	replacement: string,
	options: SearchOptions = {},
): string {
	if (options.mode === "extended") return unescapeExtended(replacement);
	if (options.mode !== "regex") return replacement;
	const metin = index.regions[match.regionIndex]?.text ?? "";
	const desen = compilePattern(query, options.caseSensitive === true, true);
	desen.lastIndex = match.from;
	const sonuc = metin.replace(desen, replacement);
	return sonuc.slice(match.from, sonuc.length - (metin.length - match.to));
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
