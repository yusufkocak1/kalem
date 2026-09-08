/**
 * @kalem/core — Serileştirici (AST → Markdown)  (İş listesi: F1-07)
 *
 * ## Tek kural
 *
 * **Kullanıcının yazdığı gibi geri yaz.** Ayrıştırıcının sakladığı `syntax`
 * alanları burada kullanılır: `*` yazan `*` görür, `~~~` kullanan `~~~`
 * görür, setext başlık setext kalır. Bu, kendi ayrıştırıcımızı yazma
 * gerekçemizin (analiz §5.3) karşılığını aldığımız yer.
 *
 * `syntax` yoksa — düğüm editörde yeni oluşturulmuşsa — yapılandırılmış
 * varsayılana düşülür.
 *
 * ## Kaçışlama
 *
 * Metin içindeki `*`, `_`, `#`, `[` gibi karakterler yanlışlıkla işaret
 * olarak okunmamalı. Ama her karakteri kaçırmak da gürültü olur: cümle
 * ortasındaki `a * b` zaten vurgu açmaz. Bu yüzden kaçışlama **bağlama
 * duyarlıdır** — satır başındaki `#` kaçırılır, ortadaki kaçırılmaz.
 *
 * ## Boş düğümler
 *
 * İçeriği olmayan vurgu ve kod düğümleri **yazılmaz**. `**` ya da `` `` ``
 * geçerli Markdown değildir; yazılırsa yeniden ayrıştırılınca düz metne
 * döner ve her turda biraz daha kaçırılır — idempotans kaybı. Bu kuralı
 * özellik tabanlı test (`property.test.ts`) buldu.
 */
import type {
	Block,
	Blockquote,
	Code,
	Definition,
	Heading,
	Inline,
	List,
	ListItem,
	Node,
	Paragraph,
	Root,
	Table,
	ThematicBreak,
} from "./ast.js";

/** Yeni düğümler için yazım varsayılanları. */
export interface SerializeOptions {
	/** Sırasız liste işareti (varsayılan `-`). */
	bulletMarker?: "-" | "*" | "+";
	/** Vurgu işareti (varsayılan `*`). */
	emphasisMarker?: "*" | "_";
	/** Kod bloğu çiti (varsayılan ```` ``` ````). */
	codeFence?: "`" | "~";
	/** Sıralı liste ayracı (varsayılan `.`). */
	orderedDelimiter?: "." | ")";
	/** Yatay çizgi (varsayılan `---`). */
	thematicBreak?: string;
	/** Satır sonu; kökün `syntax`'ı varsa o kazanır. */
	lineEnding?: "\n" | "\r\n" | "\r";
}

interface Resolved {
	readonly bulletMarker: "-" | "*" | "+";
	readonly emphasisMarker: "*" | "_";
	readonly codeFence: "`" | "~";
	readonly orderedDelimiter: "." | ")";
	readonly thematicBreak: string;
	lineEnding: "\n" | "\r\n" | "\r";
}

function resolve(options: SerializeOptions): Resolved {
	return {
		bulletMarker: options.bulletMarker ?? "-",
		emphasisMarker: options.emphasisMarker ?? "*",
		codeFence: options.codeFence ?? "`",
		orderedDelimiter: options.orderedDelimiter ?? ".",
		thematicBreak: options.thematicBreak ?? "---",
		lineEnding: options.lineEnding ?? "\n",
	};
}

/** AST'yi Markdown metnine çevirir. */
export function serialize(node: Node, options: SerializeOptions = {}): string {
	const o = resolve(options);

	if (node.type === "root") return serializeRoot(node, o);
	if (isInlineNode(node)) return inlines([node], o);
	return blocks([node as Block], o).join(`${o.lineEnding}${o.lineEnding}`);
}

function serializeRoot(root: Root, o: Resolved): string {
	// Belge düzeyi yazım bilgisi seçenekleri ezer: dosya CRLF ise CRLF kalır.
	if (root.syntax !== undefined) o.lineEnding = root.syntax.lineEnding;

	const parts: string[] = [];
	for (const child of root.children) {
		if (child.type === "yaml") parts.push(`---\n${child.value}\n---`);
		else if (child.type === "toml") parts.push(`+++\n${child.value}\n+++`);
		else parts.push(block(child, o));
	}

	let out = parts[0] ?? "";
	for (let i = 1; i < parts.length; i++) {
		out += gap(root.children[i - 1], root.children[i], "\n\n") + (parts[i] ?? "");
	}
	if (root.syntax?.finalNewline !== false && out !== "") out += "\n";
	if (root.syntax?.bom === true) out = `﻿${out}`;
	// Satır sonu normalleştirmesi en sonda, tek yerde yapılır.
	return o.lineEnding === "\n" ? out : out.replace(/\n/g, o.lineEnding);
}

// ---------------------------------------------------------------------------
// Bloklar
// ---------------------------------------------------------------------------

function blocks(list: readonly Block[], o: Resolved): string[] {
	return list.map((b) => block(b, o));
}

/**
 * Blokları aralarındaki **özgün boş satır sayısıyla** birleştirir.
 *
 * F1-01'de boş satırlar için ayrı bir alan açmamıştım; gerekçe, bilginin
 * zaten `position` içinde olmasıydı. Burası o kararın karşılığını aldığı
 * yer: iki bloğun satır numaraları arasındaki fark, aradaki boş satır
 * sayısını verir. Konum yoksa (editörde yeni oluşturulmuş düğüm) varsayılana
 * düşülür.
 */
function joinBlocks(list: readonly Block[], o: Resolved, fallback: string): string {
	const parts = blocks(list, o);
	let out = parts[0] ?? "";
	for (let i = 1; i < parts.length; i++) {
		out += gap(list[i - 1], list[i], fallback) + (parts[i] ?? "");
	}
	return out;
}

/** İki düğüm arasındaki satır sonu dizisi. */
function gap(prev: Node | undefined, next: Node | undefined, fallback: string): string {
	const end = prev?.position?.end.line;
	const start = next?.position?.start.line;
	if (end === undefined || start === undefined) return fallback;
	const blanks = Math.max(0, start - end - 1);
	return "\n".repeat(blanks + 1);
}

function block(node: Block, o: Resolved): string {
	switch (node.type) {
		case "paragraph":
			return paragraph(node, o);
		case "heading":
			return heading(node, o);
		case "thematicBreak":
			return thematicBreak(node, o);
		case "code":
			return code(node, o);
		case "blockquote":
			return blockquote(node, o);
		case "list":
			return list(node, o);
		case "html":
			return node.value;
		case "definition":
			return definition(node);
		case "table":
			return table(node, o);
	}
}

function paragraph(node: Paragraph, o: Resolved): string {
	// Paragraf, blok işaretlerinin anlamlı olduğu tek yer.
	return inlines(node.children, o, true);
}

function heading(node: Heading, o: Resolved): string {
	const content = inlines(node.children, o);

	// Setext yalnızca 1. ve 2. seviyede mümkün; derin başlık ATX'e düşer.
	if (node.syntax?.style === "setext" && node.depth <= 2) {
		const marker = node.syntax.underline ?? (node.depth === 1 ? "=" : "-");
		const width = Math.max(content.length, 1);
		return `${content}\n${marker.repeat(width)}`;
	}

	const hashes = "#".repeat(node.depth);
	const body = content === "" ? hashes : `${hashes} ${content}`;
	return node.syntax?.closed === true ? `${body} ${hashes}` : body;
}

function thematicBreak(node: ThematicBreak, o: Resolved): string {
	return node.syntax?.raw ?? o.thematicBreak;
}

function code(node: Code, o: Resolved): string {
	if (node.syntax?.style === "indented") {
		return node.value
			.replace(/\n$/, "")
			.split("\n")
			.map((line) => (line === "" ? "" : `    ${line}`))
			.join("\n");
	}

	const marker = node.syntax?.fence ?? o.codeFence;
	// Çit, içerikteki en uzun çit dizisinden uzun olmalı — yoksa kod bloğu
	// kendi içinde erken kapanır.
	const longest = longestFenceRun(node.value, marker);
	const length = Math.max(node.syntax?.fenceLength ?? 3, 3, longest + 1);
	const fence = marker.repeat(length);
	const info = [node.lang, node.meta].filter((x) => x !== null && x !== "").join(" ");
	const body = node.value.replace(/\n$/, "");
	return `${fence}${info}\n${body}\n${fence}`;
}

/** İçerikteki en uzun ardışık çit karakteri dizisi. */
function longestFenceRun(value: string, marker: string): number {
	let longest = 0;
	let current = 0;
	for (const ch of value) {
		if (ch === marker) {
			current++;
			longest = Math.max(longest, current);
		} else current = 0;
	}
	return longest;
}

function blockquote(node: Blockquote, o: Resolved): string {
	const inner = joinBlocks(node.children, o, "\n\n");
	return prefixLines(inner, ">", "> ");
}

/** Her satıra önek koyar; boş satırlar kısa öneki alır (sondaki boşluk olmasın). */
function prefixLines(text: string, blankPrefix: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => (line === "" ? blankPrefix : prefix + line))
		.join("\n");
}

function list(node: List, o: Resolved): string {
	// Sıkı/gevşek yalnızca **varsayılan**; gerçek boşluk konumdan okunur, çünkü
	// gevşek bir listede bile maddelerin bazıları bitişik olabilir.
	const fallback = node.spread ? "\n\n" : "\n";
	const items = node.children.map((item, index) => listItem(item, itemMarker(node, index, o), o));

	let out = items[0] ?? "";
	for (let i = 1; i < items.length; i++) {
		out += gap(node.children[i - 1], node.children[i], fallback) + (items[i] ?? "");
	}
	return out;
}

/** Maddenin işaretini üretir: `- `, `1. `, `3) ` … */
function itemMarker(node: List, index: number, o: Resolved): string {
	if (!node.ordered) return `${node.syntax?.marker ?? o.bulletMarker} `;

	const delimiter = node.syntax?.delimiter ?? o.orderedDelimiter;
	const start = node.start ?? 1;
	// `1. 1. 1.` yazan kullanıcıya `1. 2. 3.` üretilmez.
	const number = node.syntax?.numbering === "repeated" ? start : start + index;
	return `${number}${delimiter} `;
}

function listItem(node: ListItem, marker: string, o: Resolved): string {
	const task = node.checked === null ? "" : node.checked ? "[x] " : "[ ] ";
	const inner = task + joinBlocks(node.children, o, node.spread ? "\n\n" : "\n");
	const indent = " ".repeat(marker.length);

	const lines = inner.split("\n");
	return lines
		.map((line, i) => {
			// Boş maddede işaretin ardındaki boşluk yazılmaz: `- ` yerine `-`.
			// Sondaki görünmez boşluk hem gürültü hem birçok linter için hata.
			if (i === 0) return line === "" ? marker.trimEnd() : marker + line;
			return line === "" ? "" : indent + line;
		})
		.join("\n");
}

function definition(node: Definition): string {
	const url = /[ \t]/.test(node.url) ? `<${node.url}>` : node.url;
	const title = node.title === null ? "" : ` "${node.title}"`;
	return `[${node.label}]: ${url}${title}`;
}

/**
 * Tablo.
 *
 * v1'de düzenleme arayüzü olmadığı için ham metin varsa **olduğu gibi**
 * geri yazılır — hücre dolgusu ve boru hizası korunur. Düzenleme geldiğinde
 * (v1.1) buraya gerçek bir üretici gelecek.
 */
function table(node: Table, o: Resolved): string {
	if (node.syntax?.raw !== undefined) return node.syntax.raw;

	const rows = node.children.map(
		(row) => `| ${row.children.map((cell) => inlines(cell.children, o)).join(" | ")} |`,
	);
	const delimiter = `| ${node.align
		.map((a) => (a === "left" ? ":---" : a === "right" ? "---:" : a === "center" ? ":---:" : "---"))
		.join(" | ")} |`;
	return [rows[0] ?? "|  |", delimiter, ...rows.slice(1)].join("\n");
}

// ---------------------------------------------------------------------------
// Satır içi
// ---------------------------------------------------------------------------

function isInlineNode(node: Node): node is Inline {
	return (
		node.type === "text" ||
		node.type === "emphasis" ||
		node.type === "strong" ||
		node.type === "delete" ||
		node.type === "inlineCode" ||
		node.type === "link" ||
		node.type === "image" ||
		node.type === "linkReference" ||
		node.type === "imageReference" ||
		node.type === "break"
	);
}

/**
 * Satır içi düğümleri metne çevirir.
 *
 * `startsLine`, listenin **satır başında** olup olmadığını söyler. Yalnızca
 * paragraflar bunu `true` verir: `### 1. Başlık` içindeki `1.` liste açamaz,
 * çünkü satır zaten `###` ile başlamıştır. Bu bağlam olmadan kaçışlama
 * gereksiz yere `\1.` üretir ve gidiş-dönüş bozulur.
 */
function inlines(list: readonly Inline[], o: Resolved, startsLine = false, enclosing = ""): string {
	let out = "";
	let atLineStart = startsLine;
	for (const node of trimBreaks(list)) {
		const parca = inline(node, o, atLineStart, enclosing);
		// `!` + `[` görsel açar. İki karakter ayrı düğümlerden geliyorsa metin
		// kaçışlayıcısı bunu göremez — komşuluk ancak burada bilinir.
		if (parca.startsWith("[") && out.endsWith("!") && !out.endsWith("\\!")) {
			out = `${out.slice(0, -1)}\\!`;
		}
		out += parca;
		// Sert satır sonundan ve `\n` ile biten metinden sonra yeni satır başlar.
		atLineStart = node.type === "break" || (node.type === "text" && node.value.endsWith("\n"));
	}
	return out;
}

/**
 * İçeriği vurgu işaretiyle sarar — **boşluğu dışarıda bırakarak.**
 *
 * CommonMark vurgu işaretinin hemen yanında boşluk kabul etmez: `* a *`
 * vurgu değil, düz metindir. İçeriği olduğu gibi sarmak geçersiz Markdown
 * üretir ve her turda biraz daha kaçırılır. Doğrusu boşluğu işaretin dışına
 * taşımak: `**​ kalın ​**` yerine `​ **kalın** ​`.
 *
 * İçerik tamamen boşluksa işaret hiç yazılmaz.
 */
function wrapMarked(inner: string, marker: string, escapeBoundary: boolean): string {
	if (inner.trim() === "") return inner;
	const lead = inner.slice(0, inner.length - inner.trimStart().length);
	const tail = inner.slice(inner.trimEnd().length);
	let core = inner.slice(lead.length, inner.length - tail.length);

	// Sınır çakışması: içerik işaretle aynı karakterle başlıyor/bitiyorsa
	// `~~` + `~x` birleşip `~~~` olur ve ayrıştırıcı farklı okur.
	if (escapeBoundary) {
		const ch = marker[0] as string;
		if (core.startsWith(ch)) core = `\\${core}`;
		if (core.endsWith(ch) && !core.endsWith(`\\${ch}`)) core = `${core.slice(0, -1)}\\${ch}`;
	}
	return `${lead}${marker}${core}${marker}${tail}`;
}

/**
 * Vurguyu sarar; sınır çakışmasında **öteki işarete geçer.**
 *
 * `*` ve `_` aynı anlama gelir. İçerik `*` ile başlıyorsa `*` ile sarmak
 * `**` üretir ve ayrıştırıcı kalın okur; `_` ile sarmak sorunu anlamı
 * değiştirmeden çözer. Kaçırmak burada yanlış olurdu: içerikteki `*`
 * çoğu zaman **iç içe bir vurgunun** kendi işaretidir, kaçırılırsa o vurgu
 * bozulur.
 */
function wrapEmphasis(inner: string, preferred: "*" | "_", length: 1 | 2): string {
	if (inner.trim() === "") return inner;
	const core = inner.trim();
	const alternate = preferred === "*" ? "_" : "*";

	const uygun =
		core.startsWith(preferred) || core.endsWith(preferred)
			? core.startsWith(alternate) || core.endsWith(alternate)
				? null
				: alternate
			: preferred;

	// İki işaret de çakışıyorsa kaçışa düşülür.
	if (uygun === null) return wrapMarked(inner, preferred.repeat(length), true);
	return wrapMarked(inner, uygun.repeat(length), false);
}

/**
 * Baştaki ve sondaki sert satır sonlarını atar.
 *
 * Sert satır sonu **iki yanında da içerik** ister: paragrafın başındaki bir
 * `break` kıracak bir şey bulamaz, sonundaki ise CommonMark tarafından zaten
 * yok sayılır. Yazılırlarsa satır sonunda görünmez boşluk bırakır ve yeniden
 * ayrıştırılınca kaybolurlar — idempotans kaybı. Özellik testi buldu.
 */
function trimBreaks(list: readonly Inline[]): readonly Inline[] {
	let start = 0;
	let end = list.length;
	while (start < end && list[start]?.type === "break") start++;
	while (end > start && list[end - 1]?.type === "break") end--;
	return start === 0 && end === list.length ? list : list.slice(start, end);
}

function inline(node: Inline, o: Resolved, startsLine = false, enclosing = ""): string {
	switch (node.type) {
		case "text":
			return escapeText(node.value, startsLine, enclosing);
		case "emphasis": {
			const m = node.syntax?.marker ?? o.emphasisMarker;
			// Sarılan metin, kendisini saran işareti artık kaçırmak zorunda.
			return wrapEmphasis(inlines(node.children, o, false, `${enclosing}*_`), m, 1);
		}
		case "strong": {
			const m = node.syntax?.marker ?? o.emphasisMarker;
			return wrapEmphasis(inlines(node.children, o, false, `${enclosing}*_`), m, 2);
		}
		case "delete":
			return wrapMarked(
				inlines(node.children, o, false, `${enclosing}~`),
				"~".repeat(node.syntax?.length ?? 2),
				true,
			);
		case "inlineCode":
			// Boş kod span'i Markdown'da temsil edilemez: `` `` `` iki ters
			// tırnaktır, kod değil. Yazılırsa yeniden ayrıştırılınca düz metne
			// döner ve her turda farklı kaçırılır — idempotans kaybı.
			if (node.value === "") return "";
			return inlineCode(node.value, node.syntax?.fenceLength, node.syntax?.padded);
		case "link":
			return link(node, o);
		case "image":
			return image(node);
		case "linkReference":
			return reference(inlines(node.children, o), node.label, node.syntax?.referenceType, false);
		case "imageReference":
			return reference(node.alt ?? "", node.label, node.syntax?.referenceType, true);
		case "break":
			return node.syntax?.marker === "backslash" ? "\\\n" : "  \n";
		case "html":
			return node.value;
	}
}

/**
 * Satır içi kodu yazar.
 *
 * Çit uzunluğu, içerikteki en uzun diziden **uzun** olmak zorunda değil —
 * içerikte **bulunmayan** en kısa uzunluk yeterlidir. Kod span, kendi
 * uzunluğuna eşit ilk diziyle kapanır; daha uzun dizileri atlar. Bu yüzden
 * ``` `fence: '```'` ``` tek ters tırnakla yazılabilir ve öyle yazılmalıdır:
 * kullanıcının yazdığını 4 tırnağa çevirmek gidiş-dönüşü bozar.
 */
function inlineCode(value: string, preferred?: number, padded?: boolean): string {
	const mevcut = fenceRunLengths(value);
	let length = Math.max(preferred ?? 1, 1);
	while (mevcut.has(length)) length++;

	const fence = "`".repeat(length);
	// Dolgu ya kaynakta vardı (ayrıştırıcı kaydetti) ya da zorunlu: içerik
	// ters tırnakla başlıyor/bitiyorsa boşluksuz yazılamaz.
	const zorunlu = value.startsWith("`") || value.endsWith("`");
	const pad = padded === true || zorunlu ? " " : "";
	return `${fence}${pad}${value}${pad}${fence}`;
}

/** İçerikteki ters tırnak dizilerinin uzunlukları. */
function fenceRunLengths(value: string): Set<number> {
	const lengths = new Set<number>();
	let current = 0;
	for (const ch of value) {
		if (ch === "`") current++;
		else if (current > 0) {
			lengths.add(current);
			current = 0;
		}
	}
	if (current > 0) lengths.add(current);
	return lengths;
}

function link(node: Extract<Inline, { type: "link" }>, o: Resolved): string {
	const style = node.syntax?.style;
	const label = inlines(node.children, o);

	// Autolink ve GFM literali kendi metinlerini taşır; sarmalanmazlar.
	if (style === "autolink") return `<${plain(node.children)}>`;
	if (style === "literal") return plain(node.children);

	return `[${label}](${destination(node.url)}${titlePart(node.title)})`;
}

function image(node: Extract<Inline, { type: "image" }>): string {
	return `![${node.alt ?? ""}](${destination(node.url)}${titlePart(node.title)})`;
}

function reference(
	inner: string,
	label: string,
	type: "full" | "collapsed" | "shortcut" | undefined,
	image: boolean,
): string {
	const prefix = image ? "!" : "";
	if (type === "shortcut") return `${prefix}[${label}]`;
	if (type === "collapsed") return `${prefix}[${label}][]`;
	return `${prefix}[${inner}][${label}]`;
}

/** Boşluk içeren hedef açılı ayraca alınır. */
function destination(url: string): string {
	return url === "" || /[ \t<>]/.test(url) ? `<${url}>` : url;
}

function titlePart(title: string | null): string {
	return title === null ? "" : ` "${title}"`;
}

/** Alt ağaçtaki düz metin — autolink ve literal için. */
function plain(nodes: readonly Inline[]): string {
	let out = "";
	for (const node of nodes) {
		if (node.type === "text" || node.type === "inlineCode" || node.type === "html")
			out += node.value;
		else if ("children" in node) out += plain(node.children);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Kaçışlama
// ---------------------------------------------------------------------------

/**
 * Metni, yeniden ayrıştırıldığında aynı metni verecek şekilde kaçırır.
 *
 * Bağlama duyarlı: satır başındaki `#` başlık açar, ortadaki açmaz. Her
 * karakteri kaçırmak teknik olarak doğru olurdu ama çıktı okunmaz hale
 * gelir — Markdown'ın amacı okunabilirlik.
 */
function escapeText(value: string, startsLine: boolean, enclosing = ""): string {
	return value
		.split("\n")
		.map((line, i) => escapeLine(line, i > 0 || startsLine, enclosing))
		.join("\n");
}

function escapeLine(line: string, atLineStart: boolean, enclosing: string): string {
	let out = "";
	for (let i = 0; i < line.length; i++) {
		out += needsEscape(line, i, atLineStart, enclosing) ? `\\${line[i]}` : line[i];
	}
	return out;
}

/** Geçerli bir ATX başlık öneki: 1–6 diyez, ardından boşluk ya da satır sonu. */
const ATX_PREFIX = /^#{1,6}(?:[ \t]|$)/;

/** Liste maddesi açılışı: işaret + boşluk (ya da yalnız işaret). */
const LIST_PREFIX = /^[-+*](?:[ \t]|$)/;

/** Yatay çizgi: 3+ aynı işaret. */
const THEMATIC_LINE = /^([-*_])[ \t]*(?:\1[ \t]*){2,}$/;

/** Setext alt çizgisi: satırın tamamı `=` ya da `-`. */
const SETEXT_LINE = /^(?:=+|-+)[ \t]*$/;

/** Boşluk ya da satır sınırı — ikisi de vurgu için "boşluk" sayılır. */
function isSpaceOrEdge(ch: string | undefined): boolean {
	return ch === undefined || ch === " " || ch === "\t";
}

function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Aynı satırda bu işaretin bir **eşi** var mı.
 *
 * Vurgu ve üstü çizili çift gerektirir; eşi olmayan tek bir `*` ya da `~`
 * düz metindir ve kaçırılmamalıdır. Arama satırla sınırlı: satır dışına
 * taşan bir eşleşme zaten farklı bir düğüme aittir.
 */
function hasPartner(line: string, i: number, ch: string): boolean {
	if (line.indexOf(ch, i + 1) !== -1) return true;
	return i > 0 && line.lastIndexOf(ch, i - 1) !== -1;
}

/**
 * Bu karakter kaçırılmalı mı.
 *
 * Kaçışlama bağlama duyarlı olmak zorunda: `5 * 3 * 2` yazan kullanıcıya
 * `5 \* 3 \* 2` üretmek teknik olarak doğru ama çıktıyı okunmaz yapar —
 * ve Markdown'ın varlık sebebi okunabilirlik. Her iki yanı boşluk olan bir
 * yıldız zaten vurgu açamaz (CommonMark'ın sol/sağ taraflı dizi kuralı),
 * dolayısıyla kaçırmaya gerek yok.
 */
function needsEscape(line: string, i: number, atLineStart: boolean, enclosing: string): boolean {
	const ch = line[i];
	// Bizi saran işaret, metindeki aynı karaktere bir EŞ sağlar; artık
	// "eşi yok" gerekçesiyle kaçışsız bırakılamaz.
	if (ch !== undefined && enclosing.includes(ch)) return true;
	const prev = i === 0 ? undefined : line[i - 1];
	const next = line[i + 1];

	// Her yerde tehlikeli olanlar.
	if (ch === "\\" || ch === "[" || ch === "]" || ch === "`") return true;

	if (ch === "~") {
		// Üstü çizili bir EŞ gerektirir. Tek başına duran `~` — "~1 hafta"
		// gibi "yaklaşık" anlamındaki kullanımlar — kaçırılmamalı; kaçırmak
		// hem gürültü hem gidiş-dönüş kaybı olurdu.
		if (isSpaceOrEdge(prev) && isSpaceOrEdge(next)) return false;
		return hasPartner(line, i, ch);
	}
	if (ch === "*" || ch === "_") {
		if (isSpaceOrEdge(prev) && isSpaceOrEdge(next)) return false;
		// Kelime içindeki alt çizgi vurgu açmaz: `dosya_adi_uzun` bozulmamalı.
		if (ch === "_" && isWordChar(prev) && isWordChar(next)) return false;
		// Satır başında blok açıyorsa (liste ya da yatay çizgi) kaçırılmalı.
		if (atLineStart && i === 0 && (LIST_PREFIX.test(line) || THEMATIC_LINE.test(line))) return true;
		// Vurgu bir EŞ gerektirir; eşi olmayan işaret düz metindir.
		return hasPartner(line, i, ch);
	}

	// Satır başı işaretleri **yalnızca gerçekten blok açıyorsa** kaçırılır.
	// Aksi hâlde `#5 bolt`, `+++`, `===` gibi sıradan metinler ters bölüyle
	// dolar — teknik olarak güvenli ama okunmaz, ve gidiş-dönüşü bozar.
	if (atLineStart && i === 0) {
		if (ch === ">") return true;
		if (ch === "#") return ATX_PREFIX.test(line);
		if (ch === "-" || ch === "+") {
			return LIST_PREFIX.test(line) || THEMATIC_LINE.test(line) || SETEXT_LINE.test(line);
		}
		if (ch === "=") return SETEXT_LINE.test(line);
	}
	// `1. ` gibi bir liste açılışı yalnızca satır başında anlamlı.
	//
	// Kaçırılan karakter **ayraç** olmalı, rakam değil: CommonMark yalnızca
	// noktalamanın kaçırılmasına izin verir, `\1` diye bir kaçış yoktur ve
	// ters bölü metinde olduğu gibi kalırdı.
	if (atLineStart && (ch === "." || ch === ")")) {
		const liste = /^(\d+)[.)][ \t]/.exec(line);
		if (liste !== null && i === (liste[1] as string).length) return true;
	}
	return false;
}
