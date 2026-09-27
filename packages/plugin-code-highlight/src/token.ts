/**
 * @kalem-editor/plugin-code-highlight — Belirteçleyici  (İş listesi: F4-02)
 *
 * ## Neden kendi belirteçleyicimiz var
 *
 * Vurgulama için hazır kütüphaneler var (Prism, Shiki, highlight.js) ve
 * hiçbiri bu paketin bağımlılığı değil — iş listesi bunu açıkça istiyor.
 * Sebebi boyut: Shiki tek başına bu kütüphanenin tamamından büyük, Prism
 * ise `innerHTML` üreten bir arayüz sunuyor ve Kalem hiçbir aşamada metni
 * HTML olarak ayrıştırmıyor (analiz §5.6).
 *
 * Geriye iki seçenek kalıyordu: hiç vurgulama vermemek ya da küçük bir
 * belirteçleyici yazmak. Buradaki ~80 satır ikincisi. **Doğru ayrıştırıcı
 * değil** ve öyle olduğunu iddia etmiyor: sözdizimini anlamıyor, düzenli
 * ifadelerle tarıyor. Kod okunurluğu için yeterli, derleyici için değil.
 *
 * Yetmediğinde çıkış yolu açık: `highlight` seçeneği kendi vurgulayıcını
 * takmanı sağlıyor (`adapters.ts`).
 *
 * ## Neden `Token[]`, HTML değil
 *
 * Vurgulayıcıların çoğu HTML dizesi döndürüyor. Onu ekrana koymanın tek
 * yolu `innerHTML` ve o kapı bir kez açıldığında, kod bloğunun içeriği
 * kullanıcının yazdığı metin olduğu için doğrudan bir XSS yüzeyi oluyor.
 * Belirteç listesi bu kapıyı hiç açmıyor: her belirteç `textContent` ile
 * yazılıyor.
 *
 * ## Tarama nasıl çalışıyor
 *
 * Her kuralın **bir sonraki eşleşmesi** önbellekte tutuluyor; her adımda
 * en erken başlayan kazanıyor, eşitlikte gramerde önce yazılan. Naif yol
 * (her karakterde her kuralı denemek) 100 KB'lık bir dosyada kural sayısı
 * kadar tarama demek olurdu; burada her kural metni en fazla bir kez
 * geziyor.
 */

/**
 * Belirteç türleri.
 *
 * Kasten kısa: her tür bir CSS sınıfı ve her sınıf iki temada okunabilir
 * bir renk demek. Uzun liste, ayırt edilemeyen renkler üretir.
 */
export type TokenType =
	| "text"
	| "comment"
	| "string"
	| "number"
	| "keyword"
	| "boolean"
	| "function"
	| "type"
	| "property"
	| "tag"
	| "attr"
	| "variable"
	| "operator"
	| "punctuation";

export interface Token {
	readonly type: TokenType;
	readonly text: string;
	/**
	 * Doğrudan renk — yalnızca **tema taşıyan** vurgulayıcılar için.
	 *
	 * Shiki gibi araçlar tür değil renk üretir (`adapters.ts`). Verilirse
	 * CSS sınıfının yerine geçiyor; verilmezse renk temadan geliyor ki
	 * asıl istenen o: kullanıcının koyu/açık teması kod bloğunda da
	 * geçerli olsun.
	 */
	readonly color?: string;
}

export interface Rule {
	readonly type: TokenType;
	/**
	 * Eşleşen metnin **tamamı** boyanıyor.
	 *
	 * Yakalama grubu desteği yok; gerektiğinde ileri bakış kullanılıyor
	 * (`/\w+(?=\s*\()/`). Geri bakış (`(?<=)`) **yasak**: eski Safari onu
	 * ayrıştıramıyor ve düzenli ifade değişmez olarak yazıldığı için hata
	 * modülün tamamını yükletmiyor.
	 */
	readonly pattern: RegExp;
}

export interface Grammar {
	/** Dilin adı; hata ayıklama ve `adapters.ts` için. */
	readonly name: string;
	/** Sıra öncelik demek: eşit konumda önce yazılan kural kazanıyor. */
	readonly rules: readonly Rule[];
}

/**
 * Gramer başına derlenmiş düzenli ifadeler.
 *
 * `lastIndex` ile arama yapabilmek için `g` bayrağı şart; gramer yazarını
 * bunu hatırlamaya zorlamak yerine burada ekleniyor. Sonuç önbelleğe
 * alınıyor: gramer modül düzeyinde sabit, her çağrıda yeniden derlemek
 * boşuna.
 */
const derlenmis = new WeakMap<Grammar, RegExp[]>();

function desenler(grammar: Grammar): RegExp[] {
	const onbellek = derlenmis.get(grammar);
	if (onbellek !== undefined) return onbellek;
	const yeni = grammar.rules.map((kural) => {
		const bayrak = kural.pattern.flags;
		return new RegExp(kural.pattern.source, bayrak.includes("g") ? bayrak : `${bayrak}g`);
	});
	derlenmis.set(grammar, yeni);
	return yeni;
}

/**
 * Bir kuralın `from`dan itibaren ilk eşleşmesi.
 *
 * Sıfır uzunluklu eşleşme atlanıyor: `/\b/` gibi bir desen sonsuz döngü
 * yapardı ve gramer yazarının hatası tüm sayfayı kilitlerdi.
 */
function ara(re: RegExp, code: string, from: number): RegExpExecArray | null {
	let konum = from;
	while (konum <= code.length) {
		re.lastIndex = konum;
		const m = re.exec(code);
		if (m === null) return null;
		if (m[0].length > 0) return m;
		konum = m.index + 1;
	}
	return null;
}

/** Kaynağı belirteçlere böler. Boyanmayan aralıklar `text` olarak kalıyor. */
export function tokenize(code: string, grammar: Grammar): Token[] {
	const kurallar = grammar.rules;
	const res = desenler(grammar);
	/** Kuralın bilinen sonraki eşleşmesi; `null` = bir daha eşleşmiyor. */
	const bulunan: (RegExpExecArray | null)[] = new Array(kurallar.length).fill(null);
	/** Kural hiç aranmadıysa `false`. */
	const arandi: boolean[] = new Array(kurallar.length).fill(false);

	const out: Token[] = [];
	/** Henüz belirtece dönüşmemiş metnin başlangıcı. */
	let duz = 0;
	let pos = 0;

	while (pos < code.length) {
		let enIyi: RegExpExecArray | null = null;
		let enIyiKural = -1;

		for (let i = 0; i < kurallar.length; i++) {
			let m = bulunan[i] ?? null;
			// Eşleşme bulunamamış olması kalıcı: `pos` yalnızca ileri gidiyor.
			if (!arandi[i] || (m !== null && m.index < pos)) {
				m = ara(res[i] as RegExp, code, pos);
				bulunan[i] = m;
				arandi[i] = true;
			}
			if (m === null) continue;
			if (enIyi === null || m.index < enIyi.index) {
				enIyi = m;
				enIyiKural = i;
			}
			// `pos`tan daha erken başlayan bir eşleşme olamaz.
			if (enIyi.index === pos) break;
		}

		if (enIyi === null) break;

		const kural = kurallar[enIyiKural] as Rule;
		if (enIyi.index > duz) out.push({ type: "text", text: code.slice(duz, enIyi.index) });
		out.push({ type: kural.type, text: enIyi[0] });
		pos = enIyi.index + enIyi[0].length;
		duz = pos;
	}

	if (duz < code.length) out.push({ type: "text", text: code.slice(duz) });
	return out;
}
