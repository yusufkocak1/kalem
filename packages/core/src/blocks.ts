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
 * HTML blokları, bağlantı tanımları (`[etiket]: url`) ve GFM tabloları sonraki
 * adımlarda. GFM görev listesi (`- [ ]`) F1-05'te; `listItem.checked` şimdilik
 * hep `null`. Satır içi ayrıştırma F1-04 — metin tek bir `text` düğümü olarak
 * bırakılıyor, `parseInline` seçeneğiyle takılacak.
 */
import type {
	Block,
	Code,
	Heading,
	Inline,
	ListItem,
	Paragraph,
	Point,
	Root,
	ThematicBreak,
} from "./ast.js";
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

/** `> ` alıntı öneki. `>` sonrası tek boşluk isteğe bağlı ve içeriğe dahil değil. */
const BLOCKQUOTE = /^ {0,3}> ?/;

/** Sırasız liste maddesi: `- `, `* `, `+ ` (ya da yalnız işaret). */
const BULLET_ITEM = /^( {0,3})([-+*])([ \t]*)(.*)$/;

/** Sıralı liste maddesi: `1. `, `12) ` — en çok 9 basamak. */
const ORDERED_ITEM = /^( {0,3})(\d{1,9})([.)])([ \t]*)(.*)$/;

/**
 * İşaretten sonra bu kadar boşluk varsa fazlası içeriğe (girintili kod)
 * sayılır; içerik sütunu işaret + 1 kabul edilir. CommonMark kuralı.
 */
const MAX_MARKER_SPACES = 4;

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

		// Yatay çizgi liste maddesinden ÖNCE denenmeli: `- - -` her ikisine de
		// uyar ve CommonMark yatay çizgiyi seçer.
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

		if (BLOCKQUOTE.test(line.value)) {
			i = readBlockquote(lines, i, blocks, inline);
			continue;
		}

		const item = listItemStart(line);
		if (item !== null) {
			i = readList(lines, i, item, blocks, inline);
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
	if (BLOCKQUOTE.test(line.value)) return true;
	const fence = FENCE_OPEN.exec(line.value);
	if (fence !== null && isValidFence(fence)) return true;
	// Liste paragrafı yalnızca boş olmayan bir maddeyle kesebilir; ayrıca
	// sıralı listede numara 1 olmalıdır. `2020. yılında` diye başlayan bir
	// satır liste başlatmamalı.
	const item = listItemStart(line);
	if (item === null) return false;
	return item.content !== "" && (item.number === null || item.number === 1);
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
// Kapsayıcı bloklar
//
// Kapsayıcılar kendi öneklerini soyup `parseLines`'ı yeniden çağırır. Soyulan
// satırlar **türetilmiş** satırlardır: ofsetleri kaydırılmış olsa da hâlâ
// özgün kaynağı gösterirler, böylece iç bloklar da doğru `position` alır.
// ---------------------------------------------------------------------------

/** Satırın baştan `chars` karakterini atarak türetilmiş satır üretir. */
function sliceLine(line: Line, chars: number): Line {
	return {
		value: line.value.slice(chars),
		line: line.line,
		start: line.start + chars,
		end: line.end,
		ending: line.ending,
	};
}

/**
 * Satırdan `columns` sütunluk girinti soyar.
 *
 * **Bilinen kısıt:** kısmen tüketilen bir sekme boşluğa çevrildiğinden
 * (CommonMark kuralı) o satırın karakter uzunluğu değişir ve türetilmiş
 * ofset bir miktar kayar. Yalnızca sekmeyle girintilenmiş iç içe listelerde
 * görülür; içerik doğru, `position` yaklaşıktır.
 */
function sliceColumns(line: Line, columns: number): Line {
	const { rest } = consumeIndent(line.value, columns);
	const chars = Math.max(0, line.value.length - rest.length);
	return {
		value: rest,
		line: line.line,
		start: line.start + chars,
		end: line.end,
		ending: line.ending,
	};
}

function readBlockquote(
	lines: readonly Line[],
	start: number,
	blocks: Block[],
	inline: InlineParser,
): number {
	const openLine = must(lines[start], "alıntı açılış satırı");
	const inner: Line[] = [];
	let i = start;
	let lastWasContent = false;

	while (i < lines.length) {
		const line = must(lines[i], "alıntı satırı");
		const marker = BLOCKQUOTE.exec(line.value);

		if (marker !== null) {
			inner.push(sliceLine(line, marker[0].length));
			lastWasContent = !isBlank(line.value.slice(marker[0].length));
			i++;
			continue;
		}

		// Tembel devam: alıntı içindeki bir paragraf, `>` olmadan da sürebilir.
		// Ama yeni bir blok başlatan satır alıntıyı bitirir.
		if (lastWasContent && !isBlank(line.value) && !startsNewBlock(line)) {
			inner.push(line);
			i++;
			continue;
		}
		break;
	}

	const endLine = must(lines[i - 1], "alıntı bitiş satırı");
	blocks.push({
		type: "blockquote",
		children: parseLines(inner, inline),
		position: span(openLine, endLine),
	});
	return i;
}

// ---------------------------------------------------------------------------
// Listeler
// ---------------------------------------------------------------------------

/** İşaretin satırdaki ölçüleri — sırasız ve sıralı maddede ortak. */
interface MarkerGeometry {
	/** İçeriğin başladığı sütun — devam satırlarının uyması gereken girinti. */
	readonly contentColumn: number;
	/** İşaret ve ardındaki boşluğun karakter uzunluğu. */
	readonly markerChars: number;
	/** İşaretten sonra bu satırda kalan içerik. */
	readonly content: string;
}

/**
 * Bir liste maddesi başlangıcı.
 *
 * Ayrık birlik olmasının sebebi: `bullet` doluysa `delimiter` ve `number`
 * kesinlikle boştur, tersi de doğrudur. Üçünü de "olabilir null" yapmak,
 * derleyicinin bildiği bu ilişkiyi saklar ve her kullanım yerinde asla
 * çalışmayacak null kontrolleri gerektirirdi.
 */
type ListItemStart =
	| (MarkerGeometry & {
			readonly bullet: "-" | "*" | "+";
			readonly delimiter: null;
			readonly number: null;
	  })
	| (MarkerGeometry & {
			readonly bullet: null;
			readonly delimiter: "." | ")";
			readonly number: number;
	  });

/** Satır bir liste maddesi başlatıyorsa çözümler, başlatmıyorsa `null`. */
function listItemStart(line: Line): ListItemStart | null {
	// Yatay çizgi liste maddesi değildir; `- - -` çizgidir.
	if (THEMATIC_BREAK.test(line.value)) return null;

	const bullet = BULLET_ITEM.exec(line.value);
	if (bullet !== null) {
		const geo = geometry({
			indent: must(bullet[1], "madde girintisi").length,
			markerWidth: 1,
			spaces: must(bullet[3], "işaret sonrası boşluk"),
			content: must(bullet[4], "madde içeriği"),
		});
		if (geo === null) return null;
		return {
			...geo,
			bullet: must(bullet[2], "madde işareti") as "-" | "*" | "+",
			delimiter: null,
			number: null,
		};
	}

	const ordered = ORDERED_ITEM.exec(line.value);
	if (ordered !== null) {
		const digits = must(ordered[2], "madde numarası");
		const geo = geometry({
			indent: must(ordered[1], "madde girintisi").length,
			markerWidth: digits.length + 1,
			spaces: must(ordered[4], "işaret sonrası boşluk"),
			content: must(ordered[5], "madde içeriği"),
		});
		if (geo === null) return null;
		return {
			...geo,
			bullet: null,
			delimiter: must(ordered[3], "madde ayracı") as "." | ")",
			number: Number(digits),
		};
	}

	return null;
}

/** İşaret ölçülerini hesaplar; satır liste maddesi değilse `null`. */
function geometry(p: {
	indent: number;
	markerWidth: number;
	spaces: string;
	content: string;
}): MarkerGeometry | null {
	// İşaretten sonra boşluk yoksa ve içerik varsa bu bir liste değildir:
	// `-metin` paragraftır. `-` tek başına ise boş maddedir.
	if (p.spaces === "" && p.content !== "") return null;

	const spaceWidth = indentWidth(p.spaces);
	// Boş madde ya da 5+ boşluk: içerik sütunu işaret + 1. Fazla boşluk
	// maddenin İÇİNDE girintili kod olur.
	const effective = p.content === "" || spaceWidth > MAX_MARKER_SPACES ? 1 : spaceWidth;

	return {
		contentColumn: p.indent + p.markerWidth + effective,
		markerChars: p.indent + p.markerWidth + (p.content === "" ? p.spaces.length : effective),
		content: p.content,
	};
}

/** İki madde aynı listeye mi ait — işaret türü değişirse yeni liste başlar. */
function sameList(a: ListItemStart, b: ListItemStart): boolean {
	return a.bullet === b.bullet && a.delimiter === b.delimiter;
}

function readList(
	lines: readonly Line[],
	start: number,
	first: ListItemStart,
	blocks: Block[],
	inline: InlineParser,
): number {
	const openLine = must(lines[start], "liste açılış satırı");
	const items: ListItem[] = [];
	let i = start;
	let current: ListItemStart | null = first;
	/** Maddeler arasında boş satır görüldü mü — gevşek listenin ölçütü. */
	let looseBetween = false;
	let looseInside = false;
	let lastConsumed = start;

	while (current !== null && i < lines.length) {
		const read = readListItem(lines, i, current, inline);
		items.push(read.item);
		looseInside ||= read.spread;
		lastConsumed = read.lastContent;
		i = read.next;

		// Sonraki maddeye kadar boş satırları atla.
		let blanks = 0;
		while (i < lines.length && isBlank(must(lines[i], "liste boş satırı").value)) {
			blanks++;
			i++;
		}
		if (i >= lines.length) break;

		const next = listItemStart(must(lines[i], "sonraki madde satırı"));
		if (next === null || !sameList(current, next)) break;

		if (blanks > 0) looseBetween = true;
		current = next;
	}

	const endLine = must(lines[lastConsumed], "liste bitiş satırı");
	blocks.push({
		type: "list",
		ordered: first.bullet === null,
		start: first.number,
		spread: looseBetween || looseInside,
		children: items,
		syntax:
			first.bullet !== null
				? { marker: first.bullet }
				: { delimiter: first.delimiter, numbering: "incrementing" },
		position: span(openLine, endLine),
	});
	return i;
}

interface ReadItem {
	readonly item: ListItem;
	readonly next: number;
	readonly lastContent: number;
	readonly spread: boolean;
}

function readListItem(
	lines: readonly Line[],
	start: number,
	info: ListItemStart,
	inline: InlineParser,
): ReadItem {
	const openLine = must(lines[start], "madde açılış satırı");
	const inner: Line[] = [sliceLine(openLine, info.markerChars)];

	let i = start + 1;
	let lastContent = start;
	let sawBlank = false;
	/** Madde içinde boş satırdan SONRA içerik geldi mi — gevşek maddenin ölçütü. */
	let spread = false;

	while (i < lines.length) {
		const line = must(lines[i], "madde devam satırı");

		if (isBlank(line.value)) {
			inner.push(sliceLine(line, 0));
			sawBlank = true;
			i++;
			continue;
		}

		if (indentWidth(line.value) >= info.contentColumn) {
			inner.push(sliceColumns(line, info.contentColumn));
			if (sawBlank) spread = true;
			lastContent = i;
			sawBlank = false;
			i++;
			continue;
		}

		// Tembel devam: maddedeki paragraf, girintisiz de sürebilir — ama
		// boş satırdan sonra ya da yeni bir blok başlangıcıysa sürmez.
		if (!sawBlank && !startsNewBlock(line) && listItemStart(line) === null) {
			inner.push(line);
			lastContent = i;
			i++;
			continue;
		}
		break;
	}

	// Maddenin sonundaki boş satırlar maddeye ait değil.
	const kept = inner.slice(0, lastContent - start + 1);

	return {
		item: {
			type: "listItem",
			// GFM görev listesi (`- [ ]`) F1-05'te; şimdilik görev değil.
			checked: null,
			spread,
			children: parseLines(kept, inline),
			position: span(openLine, must(lines[lastContent], "madde bitiş satırı")),
		},
		next: lastContent + 1,
		lastContent,
		spread,
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
