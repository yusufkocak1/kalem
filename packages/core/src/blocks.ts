/**
 * @kalem-editor/core — Blok ayrıştırıcı  (İş listesi: F1-03)
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
 * ## Satır içi katman
 *
 * Metin varsayılan olarak tek bir `text` düğümü olarak bırakılır; gerçek
 * satır içi ayrıştırma `parseInline` seçeneğiyle takılır (`parse.ts` bunu
 * yapar). Ayrım bilinçli: blok yapısı satır içi ayrıştırıcıdan bağımsız
 * test edilebiliyor.
 */
import type {
	AlignType,
	Block,
	Code,
	Frontmatter,
	Heading,
	Inline,
	ListItem,
	Paragraph,
	Point,
	Root,
	TableCell,
	TableRow,
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
		throw new Error(`blocks: internal consistency error — expected ${what}, found nothing`);
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

/** CommonMark'ın blok düzeyi kabul ettiği HTML etiketleri (tip 6). */
const HTML_BLOCK_TAGS =
	"address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";

/**
 * CommonMark'ın yedi HTML blok türü.
 *
 * `close` doluysa blok o desen görülene kadar sürer; `null` ise ilk boş satır
 * bitirir. `canInterrupt` yalnızca 7. tür için kapalıdır: tek başına duran
 * herhangi bir etiket, süregelen bir paragrafı bölmemelidir.
 */
const HTML_BLOCK_RULES: readonly {
	readonly open: RegExp;
	readonly close: RegExp | null;
	readonly canInterrupt: boolean;
}[] = [
	{
		open: /^ {0,3}<(script|pre|style|textarea)(?:[ \t]|>|$)/i,
		close: /<\/(script|pre|style|textarea)>/i,
		canInterrupt: true,
	},
	{ open: /^ {0,3}<!--/, close: /-->/, canInterrupt: true },
	{ open: /^ {0,3}<\?/, close: /\?>/, canInterrupt: true },
	{ open: /^ {0,3}<![A-Za-z]/, close: />/, canInterrupt: true },
	{ open: /^ {0,3}<!\[CDATA\[/, close: /]]>/, canInterrupt: true },
	{
		open: new RegExp(`^ {0,3}</?(?:${HTML_BLOCK_TAGS})(?:[ \\t]|/?>|$)`, "i"),
		close: null,
		canInterrupt: true,
	},
	{
		open: /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/,
		close: null,
		canInterrupt: false,
	},
];

/** GFM görev listesi işareti: `- [ ]` ya da `- [x]`. */
const TASK_MARKER = /^\[([ xX])\][ \t]+/;

/**
 * GFM tablo ayraç satırı: `| --- | :--: |`
 *
 * Tabloyu tablo yapan budur — üstündeki satır tek başına başlık değildir.
 */
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * Frontmatter sınırlayıcıları.
 *
 * `---` YAML, `+++` TOML. Yalnızca **dosyanın ilk satırında** geçerlidir;
 * ortadaki `---` yatay çizgidir.
 */
const FRONTMATTER_FENCES = [
	{ fence: "---", type: "yaml" },
	{ fence: "+++", type: "toml" },
] as const;

/**
 * Bağlantı tanımı: `[etiket]: hedef "başlık"`
 *
 * **Bilinen kısıt:** yalnızca tek satırlık tanımlar tanınıyor. CommonMark
 * hedefin ve başlığın sonraki satırlara taşmasına izin verir; gerçek
 * belgelerde çok nadir olduğu için v1'de kapsam dışı bırakıldı.
 */
const DEFINITION =
	/^ {0,3}\[((?:[^\\[\]]|\\.)+)\]:[ \t]*(<[^<>\n]*>|[^\s<][^\s]*)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^()]*)\)))?[ \t]*$/;

// ---------------------------------------------------------------------------
// Giriş noktası
// ---------------------------------------------------------------------------

/** Markdown kaynağını blok düzeyinde ayrıştırır. */
export function parseBlocks(source: string, options: ParseBlocksOptions = {}): Root {
	const { lines, lineEnding, finalNewline, bom } = scan(source);
	const inline = options.parseInline ?? rawText;

	// `scan` her zaman en az bir satır döndürür — boş kaynakta bile.
	const first = must(lines[0], "first line");
	const last = must(lines[lines.length - 1], "last line");

	// Frontmatter yalnızca dosyanın en başında olabilir.
	const front = readFrontmatter(lines);
	const children: Root["children"] = front === null ? [] : [front.node];
	children.push(...parseLines(lines.slice(front?.next ?? 0), inline));

	/*
	 * İlk bloktan önceki boş satırlar. Bloklar arasındaki boşluk konumdan
	 * okunuyor (bkz. `serialize.ts` → `gap`), ama ilk bloğun öncesinde
	 * karşılaştırılacak bir blok yok. Frontmatter varsa o zaten ilk satırda.
	 */
	let leadingBlankLines = 0;
	if (front === null && children.length > 0) {
		while (isBlank(must(lines[leadingBlankLines], "leading line").value)) leadingBlankLines++;
	}
	// Son bloğun bitişinden sonraki satırlar boş olmak zorunda — yoksa
	// bir bloğa ait olurlardı.
	const sonBlok = children[children.length - 1]?.position?.end.line;
	const trailingBlankLines = sonBlok === undefined ? 0 : last.line - sonBlok;

	return {
		type: "root",
		children,
		syntax: {
			lineEnding,
			finalNewline,
			bom,
			...(leadingBlankLines > 0 ? { leadingBlankLines } : {}),
			...(trailingBlankLines > 0 ? { trailingBlankLines } : {}),
		},
		position: { start: point(first, 0), end: point(last, last.value.length) },
	};
}

/**
 * Frontmatter'ı **ayrıştırmaz, olduğu gibi korur** (F1-06).
 *
 * YAML ayrıştırıcısı eklemek çekirdeğe 3rd-party bağımlılık sokardı ve
 * projenin temel vaadini bozardı. Kullanıcının frontmatter'ına ihtiyacı olan
 * kendi ayrıştırıcısını `yaml.value` üzerinde çalıştırır; biz yalnızca
 * bozmadan taşırız.
 */
function readFrontmatter(lines: readonly Line[]): { node: Frontmatter; next: number } | null {
	// `scan` boş kaynakta bile bir satır döndürür.
	const openLine = must(lines[0], "frontmatter opening line");
	const rule = FRONTMATTER_FENCES.find((f) => openLine.value === f.fence);
	if (rule === undefined) return null;

	const body: string[] = [];
	for (let i = 1; i < lines.length; i++) {
		const line = must(lines[i], "frontmatter line");
		if (line.value === rule.fence) {
			return {
				node: {
					type: rule.type,
					value: body.join("\n"),
					position: span(openLine, line),
				},
				next: i + 1,
			};
		}
		body.push(line.value);
	}

	// Kapanmamış sınırlayıcı frontmatter değildir — `---` yatay çizgiye,
	// `+++` paragrafa düşer.
	return null;
}

// ---------------------------------------------------------------------------
// Ana döngü
// ---------------------------------------------------------------------------

function parseLines(lines: readonly Line[], inline: InlineParser): Block[] {
	const blocks: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = must(lines[i], "current line");

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

		const html = htmlBlockRule(line, true);
		if (html !== null) {
			i = readHtmlBlock(lines, i, html, blocks);
			continue;
		}

		const definition = DEFINITION.exec(line.value);
		if (definition !== null) {
			blocks.push(makeDefinition(line, definition));
			i++;
			continue;
		}

		if (BLOCKQUOTE.test(line.value)) {
			i = readBlockquote(lines, i, blocks, inline);
			continue;
		}

		// Tablo, ikinci satırındaki ayraçtan tanınır — tek satıra bakarak
		// anlaşılamaz, bu yüzden liste ve paragraftan önce denenir.
		if (isTableStart(lines, i)) {
			i = readTable(lines, i, blocks, inline);
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
	const hashes = must(match[1], "hash run");
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
	const fence = must(match[2], "fence");
	const info = must(match[3], "info string");
	return !(fence.startsWith("`") && info.includes("`"));
}

function readFencedCode(
	lines: readonly Line[],
	start: number,
	match: RegExpExecArray,
	blocks: Block[],
): number {
	const openLine = must(lines[start], "fence opening line");
	const openIndent = must(match[1], "fence indent").length;
	const fence = must(match[2], "fence");
	const marker = fence.startsWith("~") ? "~" : "`";
	const info = must(match[3], "info string").trim();

	const closeRe = new RegExp(`^ {0,3}\\${marker}{${fence.length},}[ \\t]*$`);

	const body: string[] = [];
	let i = start + 1;
	let closingLine: Line | undefined;

	while (i < lines.length) {
		const line = must(lines[i], "fence body line");
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
	const endLine = closingLine ?? must(lines[i - 1], "fence closing line");

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
	const openLine = must(lines[start], "indented code opening line");

	const body: string[] = [];
	/** Sondaki boş satırlar kod bloğuna dahil değildir. */
	let lastContent = start;
	let i = start;

	while (i < lines.length) {
		const line = must(lines[i], "indented code line");

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
	const endLine = must(lines[lastContent], "indented code closing line");

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
	const collected: Line[] = [must(lines[start], "paragraph opening line")];
	let i = start + 1;

	while (i < lines.length) {
		const line = must(lines[i], "paragraph continuation line");
		if (isBlank(line.value)) break;

		// Setext alt çizgisi: paragrafı başlığa çevirir.
		const setext = SETEXT.exec(line.value);
		if (setext !== null && indentWidth(line.value) < INDENTED_CODE_COLUMNS) {
			const cizgi = must(setext[1], "setext underline");
			blocks.push(makeSetextHeading(collected, line, cizgi, inline));
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
	// HTML bloklarının 7. türü (tek başına duran herhangi bir etiket) paragrafı
	// kesemez; diğer altı tür keser. Bağlantı tanımı da paragrafı kesemez —
	// bu yüzden burada aranmıyor.
	if (htmlBlockRule(line, false) !== null) return true;
	const fence = FENCE_OPEN.exec(line.value);
	if (fence !== null && isValidFence(fence)) return true;
	// Liste paragrafı yalnızca boş olmayan bir maddeyle kesebilir; ayrıca
	// sıralı listede numara 1 olmalıdır. `2020. yılında` diye başlayan bir
	// satır liste başlatmamalı.
	const item = listItemStart(line);
	if (item === null) return false;
	return item.content !== "" && (item.number === null || item.number === 1);
}

/**
 * Paragraf satırlarını ham içeriğe çevirir.
 *
 * CommonMark her satırın **baştaki** boşluğunu atar ama sondakini atmaz:
 * satır sonundaki iki boşluk sert satır sonu demektir ve satır içi
 * ayrıştırıcıya ulaşması gerekir.
 *
 * CommonMark paragrafın **en sonundaki** boşluğu da atar. Paragrafta
 * atılmıyor (`keepTrailing`): anlamı yok ama kullanıcının dosyasında
 * duruyor, ve atılırsa dokunulmamış satır ilk kaydetmede değişir. HTML'de
 * görünmez. Setext başlıkta atılıyor — metinle alt çizgi arasında anlamsız.
 */
function paragraphContent(collected: readonly Line[], keepTrailing = false): string {
	const joined = collected.map((l) => l.value.replace(/^[ \t]+/, "")).join("\n");
	return keepTrailing ? joined : joined.replace(/[ \t]+$/, "");
}

function makeParagraph(collected: readonly Line[], inline: InlineParser): Paragraph {
	const first = must(collected[0], "paragraph first line");
	const last = must(collected[collected.length - 1], "paragraph last line");

	return {
		type: "paragraph",
		children: inline(paragraphContent(collected, true)),
		position: span(first, last),
	};
}

function makeSetextHeading(
	collected: readonly Line[],
	underline: Line,
	cizgi: string,
	inline: InlineParser,
): Heading {
	const first = must(collected[0], "setext first line");
	const marker = cizgi.startsWith("=") ? "=" : "-";
	const metin = paragraphContent(collected);

	return {
		type: "heading",
		depth: marker === "=" ? 1 : 2,
		children: inline(metin),
		syntax: {
			style: "setext",
			underline: marker,
			// Metin kadar çekilmiş çizgi kaydedilmiyor: metin değişince o da
			// uzamalı. Farklı uzunluktaki çizgi ise yazarın tercihi.
			...(cizgi.length !== metin.length ? { underlineLength: cizgi.length } : {}),
		},
		position: span(first, underline),
	};
}

// ---------------------------------------------------------------------------
// HTML blokları
//
// Ham HTML **korunur, çalıştırılmaz**. Viewer varsayılan olarak kaçırarak
// metin gibi gösterir (bkz. SECURITY.md); ayrıştırıcının görevi yalnızca
// nerede başlayıp bittiğini doğru bulmak.
// ---------------------------------------------------------------------------

type HtmlRule = (typeof HTML_BLOCK_RULES)[number];

/** Satır bir HTML bloğu açıyorsa kuralını verir. */
function htmlBlockRule(line: Line, allowNonInterrupting: boolean): HtmlRule | null {
	for (const rule of HTML_BLOCK_RULES) {
		if (!rule.canInterrupt && !allowNonInterrupting) continue;
		if (rule.open.test(line.value)) return rule;
	}
	return null;
}

function readHtmlBlock(
	lines: readonly Line[],
	start: number,
	rule: HtmlRule,
	blocks: Block[],
): number {
	const openLine = must(lines[start], "HTML opening line");
	const body: string[] = [];
	let i = start;
	let endLine = openLine;

	while (i < lines.length) {
		const line = must(lines[i], "HTML line");

		// Kapanış deseni olmayan türlerde bloğu ilk boş satır bitirir; boş satır
		// bloğa dahil edilmez.
		if (rule.close === null && isBlank(line.value)) break;

		body.push(line.value);
		endLine = line;
		i++;

		// Kapanış deseni AÇILIŞ satırında da bulunabilir: `<!-- yorum -->`.
		if (rule.close?.test(line.value)) break;
	}

	blocks.push({
		type: "html",
		value: body.join("\n"),
		position: span(openLine, endLine),
	});
	return i;
}

// ---------------------------------------------------------------------------
// GFM tabloları
//
// v1'de tablo **düzenleme arayüzü yok** (Karar #5) ama ayrıştırıcı tabloyu
// kayıpsız korumak zorunda — kullanıcının dosyasını bozmamak için. Bu yüzden
// tablo hem gerçek bir ağaç olarak (viewer render edebilsin) hem ham metin
// olarak (`syntax.raw`, byte düzeyinde geri yazılabilsin) tutuluyor.
// ---------------------------------------------------------------------------

/** Satır bir tablo başlatıyor mu — ikinci satırdaki ayraç belirler. */
function isTableStart(lines: readonly Line[], index: number): boolean {
	const header = lines[index];
	const delimiter = lines[index + 1];
	if (header === undefined || delimiter === undefined) return false;
	if (!header.value.includes("|")) return false;
	if (!TABLE_DELIMITER.test(delimiter.value)) return false;
	// Başlık ve ayraç satırındaki hücre sayıları uyuşmalı.
	return splitRow(header.value).length === splitRow(delimiter.value).length;
}

/**
 * Tablo satırını hücrelere böler.
 *
 * Kenardaki borular isteğe bağlıdır; `\|` kaçırılmış boru hücre ayracı
 * değildir, hücre içeriğidir.
 *
 * Serileştirici de kullanıyor (değişen tablo satırını bulmak için); genel
 * API'nin parçası değil, `index.ts`ten dışa aktarılmıyor.
 */
export function splitRow(value: string): string[] {
	const trimmed = value
		.trim()
		.replace(/^\|/, "")
		.replace(/(?<!\\)\|[ \t]*$/, "");
	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (ch === "\\" && trimmed[i + 1] === "|") {
			current += "|";
			i++;
			continue;
		}
		if (ch === "|") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	cells.push(current.trim());
	return cells;
}

/** Ayraç satırından sütun hizalamalarını çıkarır. */
function readAlignments(value: string): (AlignType | null)[] {
	return splitRow(value).map((cell) => {
		const left = cell.startsWith(":");
		const right = cell.endsWith(":");
		if (left && right) return "center";
		if (left) return "left";
		if (right) return "right";
		return null;
	});
}

function readTable(
	lines: readonly Line[],
	start: number,
	blocks: Block[],
	inline: InlineParser,
): number {
	const headerLine = must(lines[start], "table header row");
	const delimiterLine = must(lines[start + 1], "table delimiter row");
	const align = readAlignments(delimiterLine.value);
	const columns = align.length;

	const rows: TableRow[] = [makeRow(headerLine, columns, inline)];
	const raw: string[] = [headerLine.value, delimiterLine.value];
	let endLine = delimiterLine;
	let i = start + 2;

	while (i < lines.length) {
		const line = must(lines[i], "table body row");
		// Tablo, boş satırda ya da boru içermeyen satırda biter.
		if (isBlank(line.value) || !line.value.includes("|")) break;
		rows.push(makeRow(line, columns, inline));
		raw.push(line.value);
		endLine = line;
		i++;
	}

	blocks.push({
		type: "table",
		align,
		children: rows,
		syntax: { raw: raw.join("\n") },
		position: span(headerLine, endLine),
	});
	return i;
}

/** Satırı hücrelere böler; eksik hücreleri boşla tamamlar, fazlasını atar. */
function makeRow(line: Line, columns: number, inline: InlineParser): TableRow {
	const cells = splitRow(line.value);
	const children: TableCell[] = [];
	for (let c = 0; c < columns; c++) {
		children.push({ type: "tableCell", children: cellInlines(cells[c] ?? "", inline) });
	}
	return { type: "tableRow", children, position: span(line, line) };
}

const BR = /^<br\s*\/?>$/i;

/**
 * Hücrenin satır içi içeriği; `<br>` gerçek satır sonu olur.
 *
 * GFM hücresi tek satır: hücre içindeki satır sonunun tek yazılışı `<br>`
 * (GitHub da böyle gösterir). Ham HTML olarak kalsaydı editörde etiket
 * metni görünür, hücrede yeni satıra geçmek de mümkün olmazdı.
 */
export function cellInlines(raw: string, inline: InlineParser): Inline[] {
	return inline(raw).map(cellBreaks);
}

function cellBreaks(node: Inline): Inline {
	if (node.type === "html" && BR.test(node.value)) {
		const tag = node.value === "<br>" ? {} : { tag: node.value };
		return {
			type: "break",
			syntax: { marker: "html", ...tag },
			...(node.position === undefined ? {} : { position: node.position }),
		};
	}
	return "children" in node
		? ({ ...node, children: node.children.map(cellBreaks) } as Inline)
		: node;
}

// ---------------------------------------------------------------------------
// Bağlantı tanımları
// ---------------------------------------------------------------------------

/**
 * Bağlantı etiketini eşleştirme için normalleştirir.
 *
 * CommonMark etiketleri **locale'den bağımsız** Unicode büyük/küçük harf
 * katlamasıyla eşleştirir. Türkçe kurallarını uygulamak (`İ` → `i̇` yerine
 * `i`) aynı belgeyi başka bir Markdown aracıyla farklı çözerdi — yani burada
 * locale duyarlılığı **istenmeyen** şeydir.
 */
function normalizeLabel(label: string): string {
	const sadelestirilmis = label.trim().replace(/[ \t\r\n]+/g, " ");
	// kalem-locale-ok: CommonMark etiket eşleştirmesi locale'den bağımsız olmalı
	return sadelestirilmis.toLowerCase();
}

function makeDefinition(line: Line, match: RegExpExecArray): Block {
	const label = must(match[1], "definition label");
	const rawUrl = must(match[2], "definition destination");
	// `<...>` sarmalı hedefin parçası değil.
	const url = rawUrl.startsWith("<") && rawUrl.endsWith(">") ? rawUrl.slice(1, -1) : rawUrl;
	const title = match[3] ?? match[4] ?? match[5] ?? null;

	return {
		type: "definition",
		identifier: normalizeLabel(label),
		label,
		url,
		title,
		position: span(line, line),
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
	const openLine = must(lines[start], "blockquote opening line");
	const inner: Line[] = [];
	/** `>` olmadan gelen satırların kaynak satır numaraları. */
	const tembel = new Set<number>();
	let i = start;
	let lastWasContent = false;

	while (i < lines.length) {
		const line = must(lines[i], "blockquote line");
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
			tembel.add(line.line);
			i++;
			continue;
		}
		break;
	}

	const endLine = must(lines[i - 1], "blockquote closing line");
	const children = parseLines(inner, inline);
	const lazy = tembelSatirlar(children, tembel);
	// `>metin`: işaretten sonra boşluk yok ve satırda içerik var. Boş `>`
	// satırı karar vermiyor — orada boşluk zaten hiç yazılmıyor.
	const ilk = must(BLOCKQUOTE.exec(openLine.value)?.[0], "blockquote marker");
	// Desen `> ` içindeki boşluğu işarete katıyor; boşluksuz yazımda işaret
	// `>` ile bitiyor ve ardından sekme de gelmiyor.
	const sonraki = openLine.value[ilk.length];
	const compact = ilk.endsWith(">") && sonraki !== undefined && sonraki !== "\t";
	const syntax = {
		...(lazy.length > 0 ? { lazy } : {}),
		...(compact ? { compact: true } : {}),
	};
	blocks.push({
		type: "blockquote",
		children,
		...(Object.keys(syntax).length > 0 ? { syntax } : {}),
		position: span(openLine, endLine),
	});
	return i;
}

/**
 * Tembel satırları `[çocuk sırası, çocuk içindeki satır]` çiftlerine çevirir.
 *
 * Yalnızca doğrudan paragraf çocuklar: tembel devam CommonMark'ta zaten
 * yalnızca paragraf metnine uygulanıyor. İç içe bir kabın (alıntı içinde
 * liste ya da alıntı) tembel satırı kaydedilmiyor ve serileştirici oraya
 * `>` koyuyor — anlamı aynı, nadir bir durum.
 */
function tembelSatirlar(
	children: readonly Block[],
	tembel: ReadonlySet<number>,
): [number, number][] {
	const out: [number, number][] = [];
	if (tembel.size === 0) return out;
	for (const [i, child] of children.entries()) {
		if (child.type !== "paragraph" || child.position === undefined) continue;
		const bas = child.position.start.line;
		for (let satir = bas + 1; satir <= child.position.end.line; satir++) {
			if (tembel.has(satir)) out.push([i, satir - bas]);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Listeler
// ---------------------------------------------------------------------------

/** İşaretin satırdaki ölçüleri — sırasız ve sıralı maddede ortak. */
interface MarkerGeometry {
	/** İşaretten önceki boşluk sayısı (desen yalnızca boşluk yakalıyor). */
	readonly indent: number;
	/** İşaretle içerik arasındaki etkin boşluk (1–4); boş maddede 1. */
	readonly spacing: number;
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
			indent: must(bullet[1], "list item indent"),
			markerWidth: 1,
			spaces: must(bullet[3], "space after marker"),
			content: must(bullet[4], "list item content"),
		});
		if (geo === null) return null;
		return {
			...geo,
			bullet: must(bullet[2], "bullet marker") as "-" | "*" | "+",
			delimiter: null,
			number: null,
		};
	}

	const ordered = ORDERED_ITEM.exec(line.value);
	if (ordered !== null) {
		const digits = must(ordered[2], "list item number");
		const geo = geometry({
			indent: must(ordered[1], "list item indent"),
			markerWidth: digits.length + 1,
			spaces: must(ordered[4], "space after marker"),
			content: must(ordered[5], "list item content"),
		});
		if (geo === null) return null;
		return {
			...geo,
			bullet: null,
			delimiter: must(ordered[3], "ordered list delimiter") as "." | ")",
			number: Number(digits),
		};
	}

	return null;
}

/** İşaret ölçülerini hesaplar; satır liste maddesi değilse `null`. */
function geometry(p: {
	indent: string;
	markerWidth: number;
	spaces: string;
	content: string;
}): MarkerGeometry | null {
	const indent = p.indent.length;
	// İşaretten sonra boşluk yoksa ve içerik varsa bu bir liste değildir:
	// `-metin` paragraftır. `-` tek başına ise boş maddedir.
	if (p.spaces === "" && p.content !== "") return null;

	const spaceWidth = indentWidth(p.spaces);
	// Boş madde ya da 5+ boşluk: içerik sütunu işaret + 1. Fazla boşluk
	// maddenin İÇİNDE girintili kod olur.
	const effective = p.content === "" || spaceWidth > MAX_MARKER_SPACES ? 1 : spaceWidth;

	return {
		indent,
		// Sekmeli boşluk korunmuyor: genişliği sütuna bağlı ve serileştirici
		// boşluk yazıyor.
		spacing: /^ *$/.test(p.spaces) ? effective : 1,
		contentColumn: indent + p.markerWidth + effective,
		markerChars: indent + p.markerWidth + (p.content === "" ? p.spaces.length : effective),
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
	const openLine = must(lines[start], "list opening line");
	const items: ListItem[] = [];
	let i = start;
	let current: ListItemStart | null = first;
	/** Maddelerin numaraları — `1. 1. 1.` yazımını tanımak için. */
	const numaralar: number[] = [];
	/** Maddeler arasında boş satır görüldü mü — gevşek listenin ölçütü. */
	let looseBetween = false;
	let looseInside = false;
	let lastConsumed = start;

	while (current !== null && i < lines.length) {
		const read = readListItem(lines, i, current, inline);
		items.push(read.item);
		if (current.number !== null) numaralar.push(current.number);
		looseInside ||= read.spread;
		lastConsumed = read.lastContent;
		i = read.next;

		// Sonraki maddeye kadar boş satırları atla.
		let blanks = 0;
		while (i < lines.length && isBlank(must(lines[i], "list blank line").value)) {
			blanks++;
			i++;
		}
		if (i >= lines.length) break;

		const next = listItemStart(must(lines[i], "next list item line"));
		if (next === null || !sameList(current, next)) break;

		if (blanks > 0) looseBetween = true;
		current = next;
	}

	const endLine = must(lines[lastConsumed], "list closing line");
	/*
	 * `1. 1. 1.` — iki ya da daha çok madde ve hepsi ilkiyle aynı numara.
	 * Tek maddeli listede ayırt edilemez; artan varsayılıyor, çünkü editörde
	 * eklenen ikinci madde çoğu yazar için `2.` olmalı.
	 */
	const numbering =
		numaralar.length > 1 && numaralar.every((n) => n === first.number)
			? "repeated"
			: "incrementing";
	const indent = {
		...(first.indent > 0 ? { indent: first.indent } : {}),
		...(first.spacing > 1 ? { spacing: first.spacing } : {}),
	};
	blocks.push({
		type: "list",
		ordered: first.bullet === null,
		start: first.number,
		spread: looseBetween || looseInside,
		children: items,
		syntax:
			first.bullet !== null
				? { marker: first.bullet, ...indent }
				: { delimiter: first.delimiter, numbering, ...indent },
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
	const openLine = must(lines[start], "list item opening line");
	const firstInner = sliceLine(openLine, info.markerChars);

	// GFM görev listesi: içerik `[ ]` ya da `[x]` ile başlıyorsa madde bir
	// göreve dönüşür ve işaret içerikten çıkarılır.
	const task = TASK_MARKER.exec(firstInner.value);
	// Desen zaten yalnızca " ", "x" ya da "X" yakalıyor; boşluk olmayan her
	// şey işaretli demek. Büyük/küçük harf katlaması gerekmiyor — gereksiz
	// bir locale bağımlılığı yaratmamak için de tercih edilmedi.
	const checked = task === null ? null : must(task[1], "task marker") !== " ";
	const inner: Line[] = [task === null ? firstInner : sliceLine(firstInner, task[0].length)];

	let i = start + 1;
	let lastContent = start;
	let sawBlank = false;
	/** Madde içinde boş satırdan SONRA içerik geldi mi — gevşek maddenin ölçütü. */
	let spread = false;

	while (i < lines.length) {
		const line = must(lines[i], "list item continuation line");

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
			checked,
			spread,
			children: parseLines(kept, inline),
			position: span(openLine, must(lines[lastContent], "list item closing line")),
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
