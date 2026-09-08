/**
 * @kalem/core — Blok ayrıştırıcı  (İş listesi: F1-03)
 *
 * Kaynağı satır satır okuyup blok düğümleri üretir. Satır düzeyi ayrıntılar
 * (sekme genişletme, satır sonları, ofsetler) `scanner.ts`'te çözülmüş durumda.
 *
 * ## Yaklaşım
 *
 * CommonMark'ın referans algoritması "açık blok yığını" tutar. Biz **satır
 * aralıkları üzerinde özyinelemeli iniş** yapıyoruz: her satırda hangi bloğun
 * başladığına bakılır, o blok kaç satır tutuyorsa tüketilir. Kapsayıcılar
 * (blockquote, liste) kendi öneklerini soyup aynı fonksiyonu yeniden çağırır.
 *
 * Gerekçe: yığın makinesi %100 uyum için gerekli, ama analiz (§5.3) v1 hedefini
 * **ölçülen ve şeffaf yayımlanan** bir uyum oranı olarak koydu, %100 olarak
 * değil. Özyinelemeli iniş okunması ve test edilmesi belirgin şekilde kolay.
 *
 * ## İki şey pazarlıksız
 *
 * 1. **`position`** — her düğüm kaynaktaki yerini taşır.
 * 2. **Yazım tercihi (`syntax`)** — `-` mi `*` mi, ATX mi setext mi, ``` mi
 *    ~~~ mi. Kendi ayrıştırıcımızı yazma gerekçemiz bu (analiz §5.3).
 *
 * ## Şu an kapsam dışı
 *
 * Kapsayıcı bloklar (blockquote, liste), HTML blokları ve bağlantı tanımları
 * sonraki adımlarda. Satır içi ayrıştırma F1-04 — şimdilik metin tek bir
 * `text` düğümü olarak bırakılıyor, `parseInline` seçeneğiyle takılacak.
 */
import type { Block, Code, Heading, Inline, Paragraph, Point, Root, ThematicBreak } from "./ast.js";
import { consumeIndent, indentWidth, isBlank, type Line, scan } from "./scanner.js";

/** Satır içi ayrıştırıcıyı takmak için — F1-04 buraya bağlanacak. */
export type InlineParser = (raw: string) => Inline[];

export interface ParseBlocksOptions {
	/**
	 * Ham metni satır içi düğümlere çevirir.
	 *
	 * Varsayılan, metni tek bir `text` düğümü olarak bırakır: blok yapısı
	 * satır içi ayrıştırıcıdan bağımsız test edilebilsin diye.
	 */
	parseInline?: InlineParser;
}

const rawText: InlineParser = (raw) => (raw === "" ? [] : [{ type: "text", value: raw }]);

/**
 * Var olduğu akıştan kesin olan bir değeri açar.
 *
 * `noUncheckedIndexedAccess` açık olduğu için `lines[i]` ve eşleşmiş regex
 * grupları `T | undefined` görünür. Her birine `?? varsayılan` yazmak, asla
 * çalışmayacak onlarca dal üretir — kapsam raporunu kirletir ve gerçek bir
 * mantık hatasını sessizce yutar. Bunun yerine tek bir kontrol noktası:
 * buraya `undefined` gelirse ayrıştırıcıda hata vardır ve duyulmalıdır.
 *
 * Genel API'nin parçası değildir (`index.ts`'ten dışa aktarılmaz).
 */
export function must<T>(value: T | undefined, what: string): T {
	if (value === undefined) {
		throw new Error(`blocks: iç tutarlılık hatası — ${what} beklenirken bulunamadı`);
	}
	return value;
}

// ---------------------------------------------------------------------------
// Satır sınıflandırma desenleri
// ---------------------------------------------------------------------------

/** `#` … `######` + boşluk. `#etiket` başlık DEĞİLDİR. */
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|)$/;

/** `***`, `---`, `___` — 3+ aynı karakter, aralarında boşluk olabilir. */
const THEMATIC_BREAK = /^ {0,3}([*\-_])[ \t]*(?:\1[ \t]*){2,}$/;

/** Setext alt çizgisi: yalnızca `=` ya da yalnızca `-`. */
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

/** Çit açılışı: 3+ ters tırnak ya da tilde, ardından bilgi dizisi. */
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** ATX başlığın sonundaki kapanış diyezleri: `## Başlık ##`. */
const ATX_CLOSING = /(^|[ \t])#+[ \t]*$/;

/** Girintili kod bloğunun eşiği. */
const INDENTED_CODE_COLUMNS = 4;

// ---------------------------------------------------------------------------
// Giriş noktası
// ---------------------------------------------------------------------------

/** Markdown kaynağını blok düzeyinde ayrıştırır. */
export function parseBlocks(source: string, options: ParseBlocksOptions = {}): Root {
	const { lines, lineEnding, finalNewline, bom } = scan(source);
	const inline = options.parseInline ?? rawText;

	// `scan` her zaman en az bir satır döndürür — boş kaynakta bile.
	const first = must(lines[0], "ilk satır");
	const last = must(lines[lines.length - 1], "son satır");

	return {
		type: "root",
		children: parseLines(lines, inline),
		syntax: { lineEnding, finalNewline, bom },
		position: { start: point(first, 0), end: point(last, last.value.length) },
	};
}

// ---------------------------------------------------------------------------
// Ana döngü
// ---------------------------------------------------------------------------

function parseLines(lines: readonly Line[], inline: InlineParser): Block[] {
	const blocks: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = must(lines[i], "geçerli satır");

		// Boş satırlar blok üretmez; blokları ayırırlar.
		if (isBlank(line.value)) {
			i++;
			continue;
		}

		// Girintili kod, paragraf devamı olmadığı sürece 4 sütunda başlar.
		if (indentWidth(line.value) >= INDENTED_CODE_COLUMNS) {
			i = readIndentedCode(lines, i, blocks);
			continue;
		}

		const fence = FENCE_OPEN.exec(line.value);
		if (fence !== null && isValidFence(fence)) {
			i = readFencedCode(lines, i, fence, blocks);
			continue;
		}

		if (THEMATIC_BREAK.test(line.value)) {
			blocks.push(makeThematicBreak(line));
			i++;
			continue;
		}

		const atx = ATX.exec(line.value);
		if (atx !== null) {
			blocks.push(makeAtxHeading(line, atx, inline));
			i++;
			continue;
		}

		i = readParagraph(lines, i, blocks, inline);
	}

	return blocks;
}

// ---------------------------------------------------------------------------
// Yaprak bloklar
// ---------------------------------------------------------------------------

function makeThematicBreak(line: Line): ThematicBreak {
	return {
		type: "thematicBreak",
		// Ham yazılış saklanıyor: `---`, `* * *`, `___` hepsi geçerli ve farklı.
		syntax: { raw: line.value.trim() },
		position: span(line, line),
	};
}

function makeAtxHeading(line: Line, match: RegExpExecArray, inline: InlineParser): Heading {
	const hashes = must(match[1], "diyez dizisi");
	// 2. grup gerçekten isteğe bağlı: `#` tek başına geçerli bir başlıktır.
	const rest = match[2] ?? "";

	// Kapanış diyezleri (`## Başlık ##`) içerik değildir — ama `## Başlık#`
	// öyledir: kapanış dizisi boşlukla önlenmeli.
	const closed = ATX_CLOSING.test(rest);
	const content = (closed ? rest.replace(ATX_CLOSING, "") : rest).trim();

	return {
		type: "heading",
		depth: hashes.length as Heading["depth"],
		children: inline(content),
		syntax: { style: "atx", closed },
		position: span(line, line),
	};
}

/**
 * Çit açılışı geçerli mi.
 *
 * Ters tırnak çitinde bilgi dizisi ters tırnak **içeremez** — yoksa satır içi
 * kod içeren normal metinler yanlışlıkla kod bloğu açardı.
 */
function isValidFence(match: RegExpExecArray): boolean {
	const fence = must(match[2], "çit");
	const info = must(match[3], "bilgi dizisi");
	return !(fence.startsWith("`") && info.includes("`"));
}

function readFencedCode(
	lines: readonly Line[],
	start: number,
	match: RegExpExecArray,
	blocks: Block[],
): number {
	const openLine = must(lines[start], "çit açılış satırı");
	const openIndent = must(match[1], "çit girintisi").length;
	const fence = must(match[2], "çit");
	const marker = fence.startsWith("~") ? "~" : "`";
	const info = must(match[3], "bilgi dizisi").trim();

	const closeRe = new RegExp(`^ {0,3}\\${marker}{${fence.length},}[ \\t]*$`);

	const body: string[] = [];
	let i = start + 1;
	let closingLine: Line | undefined;

	while (i < lines.length) {
		const line = must(lines[i], "çit gövde satırı");
		if (closeRe.test(line.value)) {
			closingLine = line;
			i++;
			break;
		}
		// İçerik satırlarından açılış çitinin girintisi kadarı soyulur.
		body.push(consumeIndent(line.value, openIndent).rest);
		i++;
	}

	const [lang, meta] = splitInfo(info);
	// Kapanmamış çit dosya sonuna kadar sürer; o zaman son okunan satır biterdir.
	const endLine = closingLine ?? must(lines[i - 1], "çit bitiş satırı");

	blocks.push({
		type: "code",
		lang,
		meta,
		value: body.length === 0 ? "" : `${body.join("\n")}\n`,
		syntax: { style: "fenced", fence: marker, fenceLength: fence.length },
		position: span(openLine, endLine),
	} satisfies Code);
	return i;
}

/**
 * Bilgi dizisini dil ve kalan bilgi olarak ayırır: ` ```ts twoslash `
 *
 * Girdi burada kırpılır; kırpılmış bir dizide boşluk varsa ardından mutlaka
 * içerik gelir, bu yüzden `meta` boş dönemez.
 */
function splitInfo(raw: string): [string | null, string | null] {
	const info = raw.trim();
	if (info === "") return [null, null];
	const space = info.search(/[ \t]/);
	if (space === -1) return [info, null];
	return [info.slice(0, space), info.slice(space).trim()];
}

function readIndentedCode(lines: readonly Line[], start: number, blocks: Block[]): number {
	const openLine = must(lines[start], "girintili kod açılış satırı");

	const body: string[] = [];
	/** Sondaki boş satırlar kod bloğuna dahil değildir. */
	let lastContent = start;
	let i = start;

	while (i < lines.length) {
		const line = must(lines[i], "girintili kod satırı");

		if (isBlank(line.value)) {
			// Boş satır kod bloğunu bitirmez — ama devamı gelmezse dahil edilmez.
			body.push(consumeIndent(line.value, INDENTED_CODE_COLUMNS).rest);
			i++;
			continue;
		}
		if (indentWidth(line.value) < INDENTED_CODE_COLUMNS) break;

		body.push(consumeIndent(line.value, INDENTED_CODE_COLUMNS).rest);
		lastContent = i;
		i++;
	}

	const kept = body.slice(0, lastContent - start + 1);
	const endLine = must(lines[lastContent], "girintili kod bitiş satırı");

	blocks.push({
		type: "code",
		lang: null,
		meta: null,
		value: `${kept.join("\n")}\n`,
		syntax: { style: "indented" },
		position: span(openLine, endLine),
	} satisfies Code);
	return lastContent + 1;
}

/**
 * Paragraf — ve onu setext başlığa çeviren alt çizgi.
 *
 * Paragraf, boş satıra ya da yeni bir blok başlangıcına kadar sürer.
 * CommonMark gereği her satırın baştaki boşluğu atılır; bu, girintili devam
 * satırları olan belgelerde byte düzeyinde gidiş-dönüşü bozan bilinen bir
 * noktadır (F1-08'de ölçülecek).
 */
function readParagraph(
	lines: readonly Line[],
	start: number,
	blocks: Block[],
	inline: InlineParser,
): number {
	const collected: Line[] = [must(lines[start], "paragraf açılış satırı")];
	let i = start + 1;

	while (i < lines.length) {
		const line = must(lines[i], "paragraf devam satırı");
		if (isBlank(line.value)) break;

		// Setext alt çizgisi: paragrafı başlığa çevirir.
		const setext = SETEXT.exec(line.value);
		if (setext !== null && indentWidth(line.value) < INDENTED_CODE_COLUMNS) {
			const marker = must(setext[1], "setext alt çizgisi").startsWith("=") ? "=" : "-";
			blocks.push(makeSetextHeading(collected, line, marker, inline));
			return i + 1;
		}

		if (startsNewBlock(line)) break;

		collected.push(line);
		i++;
	}

	blocks.push(makeParagraph(collected, inline));
	return i;
}

/** Paragrafı kesen blok başlangıçları. */
function startsNewBlock(line: Line): boolean {
	if (indentWidth(line.value) >= INDENTED_CODE_COLUMNS) return false; // paragraf devamı
	if (THEMATIC_BREAK.test(line.value)) return true;
	if (ATX.test(line.value)) return true;
	const fence = FENCE_OPEN.exec(line.value);
	return fence !== null && isValidFence(fence);
}

function makeParagraph(collected: readonly Line[], inline: InlineParser): Paragraph {
	const first = must(collected[0], "paragraf ilk satırı");
	const last = must(collected[collected.length - 1], "paragraf son satırı");

	return {
		type: "paragraph",
		children: inline(collected.map((l) => l.value.trim()).join("\n")),
		position: span(first, last),
	};
}

function makeSetextHeading(
	collected: readonly Line[],
	underline: Line,
	marker: "=" | "-",
	inline: InlineParser,
): Heading {
	const first = must(collected[0], "setext ilk satırı");

	return {
		type: "heading",
		depth: marker === "=" ? 1 : 2,
		children: inline(collected.map((l) => l.value.trim()).join("\n")),
		syntax: { style: "setext", underline: marker },
		position: span(first, underline),
	};
}

// ---------------------------------------------------------------------------
// Konum
// ---------------------------------------------------------------------------

/** Satırın belirli bir sütunundaki nokta. `column` 1 tabanlıdır. */
function point(line: Line, columnOffset: number): Point {
	return { line: line.line, column: columnOffset + 1, offset: line.start + columnOffset };
}

/** İlk satırın başından son satırın sonuna uzanan aralık. */
function span(first: Line, last: Line): { start: Point; end: Point } {
	return { start: point(first, 0), end: point(last, last.value.length) };
}
