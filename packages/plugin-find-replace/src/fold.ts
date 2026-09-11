/**
 * @kalem/plugin-find-replace — Büyük/küçük harf katlaması  (İş listesi: F4-03)
 *
 * ## Neden `@kalem/ui`nin `foldForSearch`u kullanılmadı
 *
 * F3-03'te slash menüsü için yazılan katlama **aksanları da atıyor**
 * (`baş` → `bas`). Orada doğru: menüde `/bas` yazan kullanıcı "Başlık"ı
 * görmeli. Burada **yanlış**, çünkü kabul kriteri tam tersini istiyor:
 *
 *     ışık ↔ IŞIK   eşleşmeli   (aynı kelime, farklı kasa)
 *     iyi  ↔ İYİ    eşleşmeli
 *     ışık ↔ İŞİK   eşleşmemeli (farklı kelimeler)
 *
 * Aksan katlaması üçüncü çifti de eşleştirirdi — bir belgede "ışık"
 * ararken "işik" bulmak, kullanıcının istemediği bir yeri değiştirmek
 * demek. Bul-değiştir'de yanlış eşleşmenin bedeli, menüde kaçırılan bir
 * öğeden çok daha ağır.
 *
 * Dolayısıyla burada yalnızca **kasa** katlanıyor ve o da locale'e göre:
 * `"IŞIK".toLocaleLowerCase("tr")` → `"ışık"`, çıplak `toLowerCase()` ise
 * `"ışik"` verir ve `ışık` araması kendi büyük hâlini bulamaz.
 *
 * ## Katlama uzunluğu değiştiriyor
 *
 * Bu, ofsetle çalışan her aramanın sessiz hatası: katlanmış metinde
 * bulunan konum, özgün metinde **aynı yer değil**.
 *
 *     "İ".toLocaleLowerCase("en")  →  "i̇"   (i + birleştirici nokta, 2 kod birimi)
 *     "ß".toLocaleUpperCase("de")  →  "SS"  (2 harf)
 *
 * Eşleşme konumu özgün metne göre verilmek zorunda — değiştirme işlemi
 * orada yapılıyor. Bu yüzden katlama karakter karakter yapılıyor ve her
 * katlanmış kod birimi için özgün indis bir tabloda tutuluyor
 * (`FoldedText.map`). Tablo olmadan `"İstanbul"` içinde arama yapmak,
 * İngilizce locale'de bir karakter kaymış bir aralık üretirdi.
 */

/** Katlanmış metin ve özgün metne geri eşleme. */
export interface FoldedText {
	/** Katlanmış hâli; arama bunun üzerinde yapılıyor. */
	readonly text: string;
	/**
	 * `map[i]` = katlanmış metnin `i`. kod biriminin geldiği özgün indis.
	 *
	 * Uzunluğu `text.length + 1`: son eleman özgün metnin sonu, yani
	 * bir eşleşmenin bitiş sınırı da tablodan okunabiliyor.
	 */
	readonly map: readonly number[];
}

/**
 * Metni arama için katlar.
 *
 * Kod **noktası** başına katlanıyor, kod birimi başına değil: vekil çift
 * (emoji, bazı tarihi yazılar) tek başına katlanamaz ve ikiye bölünmüş
 * bir çift geçersiz metin üretir. `for…of` kod noktalarını veriyor.
 */
export function foldCase(value: string, locale: string): FoldedText {
	let text = "";
	const map: number[] = [];
	let i = 0;
	for (const ch of value) {
		const katlanmis = ch.toLocaleLowerCase(locale);
		for (let k = 0; k < katlanmis.length; k++) map.push(i);
		text += katlanmis;
		i += ch.length;
	}
	map.push(value.length);
	return { text, map };
}

/**
 * Harf ya da rakam mı — "tam kelime" seçeneği için.
 *
 * `\b` **kullanılmıyor**: ASCII tanımlı, yani `şeker` kelimesinin
 * içindeki `ş` sınır sayılıyor ve `eker` araması "tam kelime" olarak
 * eşleşiyor. `\p{L}` Unicode harflerinin tamamını kapsıyor; Türkçe,
 * Yunanca, Kiril ve emoji'siz her belge için doğru cevap bu.
 *
 * Alt çizgi de kelime karakteri sayılıyor: `kod_adi` ararken `adi`nin tam
 * kelime olarak bulunmaması, programcı belgelerinde beklenen davranış.
 */
const KELIME = /[\p{L}\p{N}_]/u;

export function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && KELIME.test(ch);
}

/**
 * `[from, to)` aralığı tam kelime sınırında mı.
 *
 * Sınır kontrolü **katlanmış** metinde yapılıyor: katlama kasa dışında
 * bir şey değiştirmediği için harf/harf-değil ayrımı korunuyor ve
 * özgün metne geri dönmek gereksiz bir adım olurdu.
 */
export function atWordBoundary(text: string, from: number, to: number): boolean {
	return !isWordChar(text[from - 1]) && !isWordChar(text[to]);
}
