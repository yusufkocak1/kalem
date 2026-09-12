/**
 * @kalem/core — Kaynak tarayıcı  (İş listesi: F1-03'ün temeli)
 *
 * Blok ayrıştırıcısı satır satır çalışır. Bu dosya kaynağı satırlara böler ve
 * CommonMark'ın satır düzeyindeki kurallarını tek yerde toplar: satır sonu
 * çeşitleri, sekme genişletme, girinti tüketme, boş satır tanımı.
 *
 * **Neden ayrı bir dosya:** sekme genişletme CommonMark'ın en sinsi
 * ayrıntılarından biri. Sekme bir karakter değil, **bir sonraki 4'ün katına
 * kadar olan boşluktur** — `\tfoo` dört sütun girintiliyken `a\tfoo` üç
 * sütunluk bir sekme taşır. Bu mantık ayrıştırıcının içine dağılırsa hata
 * kaynağı olur.
 *
 * Her satır kaynaktaki ofsetini taşır; `position` bilgisi (gidiş-dönüş
 * sadakatinin önkoşulu) buradan üretilir.
 */

/** CommonMark sekme durağı genişliği. */
const TAB_SIZE = 4;

/** Bir satırı bitiren karakterler. Dosyanın son satırında `""` olabilir. */
export type LineEnding = "\n" | "\r\n" | "\r";

/** Taranmış tek bir satır. */
export interface Line {
	/** Satır içeriği — satır sonu karakterleri **hariç**. */
	readonly value: string;
	/** 1 tabanlı satır numarası. */
	readonly line: number;
	/** Kaynaktaki başlangıç ofseti (0 tabanlı). */
	readonly start: number;
	/** İçeriğin bittiği ofset; satır sonu karakterleri buna dahil değil. */
	readonly end: number;
	/** Bu satırı bitiren karakterler. Dosya satır sonu olmadan bitmişse `""`. */
	readonly ending: LineEnding | "";
}

/** Tarama sonucu. */
export interface ScanResult {
	readonly lines: readonly Line[];
	/**
	 * Belgede baskın satır sonu. Karışık kullanımda çoğunluk kazanır;
	 * eşitlikte ilk görülen. Serileştirici (F1-07) bunu kullanır.
	 */
	readonly lineEnding: LineEnding;
	/** Dosya satır sonuyla bitiyor mu. */
	readonly finalNewline: boolean;
	/** Kaynak bayt sırası işaretiyle (BOM) başlıyor muydu. */
	readonly bom: boolean;
}

/**
 * Kaynağı satırlara böler.
 *
 * CommonMark gereği iki normalleştirme yapılır ve **ikisi de byte düzeyinde
 * gidiş-dönüşü bozar** — bilinçli ve belgelenmiş istisnalar:
 *
 * 1. `U+0000` (NUL) → `U+FFFD`. CommonMark'ın güvenlik kuralı.
 * 2. Baştaki BOM atılır. Ama `bom` alanında kaydedilir, böylece serileştirici
 *    geri koyabilir — yani BOM aslında gidiş-dönüşten sağ çıkar.
 *
 * Karışık satır sonu kullanan dosyalar tek bir baskın sona normalleşir; bu,
 * gidiş-dönüşün korunamadığı bilinen tek durumdur.
 */
export function scan(source: string): ScanResult {
	const bom = source.charCodeAt(0) === 0xfeff;
	const text = (bom ? source.slice(1) : source).replace(/\0/g, "\ufffd");

	const lines: Line[] = [];
	const counts = { "\n": 0, "\r\n": 0, "\r": 0 };

	let start = 0;
	let lineNo = 1;
	let i = 0;

	while (i <= text.length) {
		if (i === text.length) {
			// Son satır: yalnızca içerik varsa ya da dosya tamamen boşsa eklenir.
			if (start < i || lines.length === 0) {
				lines.push({ value: text.slice(start, i), line: lineNo, start, end: i, ending: "" });
			}
			break;
		}

		const ch = text[i];
		if (ch === "\n" || ch === "\r") {
			const crlf = ch === "\r" && text[i + 1] === "\n";
			const ending: LineEnding = crlf ? "\r\n" : ch === "\r" ? "\r" : "\n";
			lines.push({ value: text.slice(start, i), line: lineNo, start, end: i, ending });
			counts[ending]++;
			i += ending.length;
			start = i;
			lineNo++;
			continue;
		}
		i++;
	}

	const finalNewline = text.length > 0 && (text.endsWith("\n") || text.endsWith("\r"));

	return { lines, lineEnding: dominantEnding(counts), finalNewline, bom };
}

/** Çoğunluk satır sonu; hiç yoksa `\n`. Eşitlikte ilk görülen kazanır. */
function dominantEnding(counts: Record<LineEnding, number>): LineEnding {
	let best: LineEnding = "\n";
	let bestCount = 0;
	// Sıra önemli: eşitlikte önce gelen kazansın diye ">"" kullanılıyor.
	for (const ending of ["\n", "\r\n", "\r"] as const) {
		if (counts[ending] > bestCount) {
			best = ending;
			bestCount = counts[ending];
		}
	}
	return best;
}

/** Satır yalnızca boşluk ve sekmeden mi oluşuyor (ya da tamamen boş mu). */
export function isBlank(value: string): boolean {
	for (const ch of value) {
		if (ch !== " " && ch !== "\t") return false;
	}
	return true;
}

/**
 * Satırın baştaki girinti genişliği — sekmeler 4'lük duraklara açılmış olarak.
 *
 * `"\tx"` → 4 · `"  \tx"` → 4 (sekme 2. sütundan 4'e taşır) · `"   x"` → 3
 */
export function indentWidth(value: string): number {
	let column = 0;
	for (const ch of value) {
		if (ch === " ") column += 1;
		else if (ch === "\t") column += TAB_SIZE - (column % TAB_SIZE);
		else break;
	}
	return column;
}

/** `consumeIndent` sonucu. */
export interface ConsumedIndent {
	/** Girinti tüketildikten sonra kalan metin. */
	readonly rest: string;
	/** Gerçekten tüketilen sütun sayısı (istenen kadar girinti yoksa daha az). */
	readonly consumed: number;
}

/**
 * Satır başından en çok `columns` sütunluk girinti tüketir.
 *
 * Bir sekmenin **ortasında** durmak gerekirse (ör. `"\tfoo"` içinden 2 sütun),
 * sekmenin kalan kısmı boşluğa çevrilir: sonuç `"  foo"`. CommonMark'ın
 * kuralı budur ve iç içe listelerde sürekli devreye girer.
 */
export function consumeIndent(value: string, columns: number): ConsumedIndent {
	if (columns <= 0) return { rest: value, consumed: 0 };

	let column = 0;
	let i = 0;
	while (i < value.length && column < columns) {
		const ch = value[i];
		if (ch === " ") {
			column += 1;
			i++;
		} else if (ch === "\t") {
			const width = TAB_SIZE - (column % TAB_SIZE);
			if (column + width > columns) {
				// Sekmenin içinde kaldık: aşan kısmı boşluğa çevir.
				const overshoot = column + width - columns;
				return { rest: " ".repeat(overshoot) + value.slice(i + 1), consumed: columns };
			}
			column += width;
			i++;
		} else {
			break;
		}
	}
	return { rest: value.slice(i), consumed: column };
}

/**
 * Satırın girintisini atlar; içerik ve kaç sütun atlandığı döner.
 *
 * `indentWidth` + `consumeIndent` birleşimi olan bu kısayol, blok
 * ayrıştırıcısının en sık yaptığı işlem.
 */
export function stripIndent(value: string): ConsumedIndent {
	return consumeIndent(value, indentWidth(value));
}
