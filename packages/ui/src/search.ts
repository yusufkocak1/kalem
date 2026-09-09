/**
 * @kalem/ui — Locale duyarlı arama katlaması  (İş listesi: F3-03)
 *
 * ## Sorun
 *
 * Slash menüde `/bas` yazan kullanıcı "Başlık 1"i görmeli. Türkçe'de bu
 * iki ayrı işlem gerektiriyor ve ikisi de sıradan `toLowerCase()` ile
 * **yanlış** sonuç veriyor:
 *
 * 1. **Büyük/küçük katlaması.** `"BAŞLIK".toLowerCase()` → `"başlik"`;
 *    doğrusu `"başlık"`. Nokta`sız` I ile noktalı İ Türkçe'de ayrı
 *    harfler ve `toLocaleLowerCase("tr")` bunu biliyor.
 * 2. **Aksan katlaması.** Klavyesinde ş olmayan ya da acelesi olan
 *    kullanıcı `bas` yazıyor; `baş` ile eşleşmeli.
 *
 * ## Nokta`sız` ı sorunu
 *
 * `ı` (U+0131) bir aksanlı harf değil, **ayrı bir harf**: Unicode
 * ayrıştırması onu `i`ye indirmiyor. Bu yüzden ayrıca eşleniyor.
 * Kabul kriterinin `/ıst` ile "İstatistik"i eşleştirmesini isteyen kısmı
 * tam olarak bunu sınıyor: `İ` katlanınca `i` oluyor, `ı` da `i`ye
 * eşlenmezse ikisi buluşmuyor.
 *
 * ## Neden kütüphane yok
 *
 * `Intl.Collator` sıralama ve karşılaştırma için var, "içeriyor mu"
 * araması için değil. Aksan duyarsız arama için hazır bir web API'si yok;
 * bu 10 satır, en küçük alternatifin (~8 kB) yerini tutuyor.
 */

/**
 * Ayrı harf oldukları için Unicode ayrıştırmasıyla katlanmayan çiftler.
 *
 * Küçük harfe çevirme **önce** yapıldığı için yalnızca küçük hâlleri
 * yeterli.
 */
const AYRI_HARFLER: Readonly<Record<string, string>> = {
	ı: "i",
	ø: "o",
	æ: "ae",
	œ: "oe",
	ß: "ss",
	đ: "d",
	ł: "l",
};

/**
 * Birleştirici işaretler.
 *
 * Unicode özellik kaçışı (`\p{M}`) kullanılıyor, kod noktası aralığı
 * değil: aralık yazmak kaynağa **görünmez** karakterler koyuyor ve o
 * karakterler bir düzenlemede sessizce bozulabiliyor.
 */
const AKSANLAR = /\p{M}/gu;

/**
 * Metni arama için katlar.
 *
 * Sıra önemli: önce locale'e göre küçük harf (İ→i), sonra aksan ayırma
 * ve atma (ş→s), en sonda ayrı harfler (ı→i). Ters sırada `İ`nin noktası
 * aksan sanılıp atılır ve Türkçe kuralı hiç uygulanmaz.
 */
export function foldForSearch(value: string, locale: string): string {
	const kucuk = value.toLocaleLowerCase(locale);
	const aksansiz = kucuk.normalize("NFD").replace(AKSANLAR, "").normalize("NFC");
	let out = "";
	for (const ch of aksansiz) out += AYRI_HARFLER[ch] ?? ch;
	return out;
}

/**
 * Sorgu metinle eşleşiyor mu.
 *
 * Boş sorgu her şeyle eşleşiyor: menü ilk açıldığında tüm öğeler görünmeli.
 */
export function matches(text: string, query: string, locale: string): boolean {
	if (query === "") return true;
	return foldForSearch(text, locale).includes(foldForSearch(query, locale));
}

/**
 * Eşleşmeyi sıralama puanı.
 *
 * Baştan eşleşen üstte: `/bas` yazan kullanıcı "Başlık 1"i, "Kod bloğu"
 * içinde geçen bir "bas"tan önce görmeli. İçeride eşleşenler kendi
 * aralarında özgün sıralarını koruyor.
 */
export function score(text: string, query: string, locale: string): number {
	if (query === "") return 0;
	const katlanmis = foldForSearch(text, locale);
	const aranan = foldForSearch(query, locale);
	const index = katlanmis.indexOf(aranan);
	if (index < 0) return -1;
	return index === 0 ? 2 : 1;
}
