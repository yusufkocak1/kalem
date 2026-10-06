/**
 * @kalem-editor/core — Serileştirici (AST → Markdown)  (İş listesi: F1-07)
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
	Color,
	Definition,
	Heading,
	Inline,
	List,
	ListItem,
	Node,
	Paragraph,
	Root,
	Table,
	TableRow,
	ThematicBreak,
} from "./ast.js";
import { cellInlines, splitRow } from "./blocks.js";
import { colorOfOpenTag, colorOpenTag, sanitizeColor } from "./color.js";
import { parseInline } from "./inline.js";

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
	/**
	 * Blok başına önbellek — yalnızca **değişmeyen belgeler** için.
	 *
	 * `createSerializeCache()` ile üretilir ve çağıran tarafından saklanır;
	 * bkz. o fonksiyonun açıklaması.
	 */
	cache?: SerializeCache;
}

/**
 * Blok başına serileştirme önbelleği.
 *
 * ## Ne işe yarıyor
 *
 * Editör her tuş vuruşunda `serialize(doc)` çağırıyor ve maliyeti belge
 * boyutuyla **doğrusal** büyüyor: ölçümde 1.000 blokta 4,6 ms, 5.000'de
 * 18,9 ms, 10.000'de 39,7 ms (İş listesi F6-08). 5.000 blokta tek bir tuş
 * bir kareyi (16,7 ms) aşıyor.
 *
 * Oysa bir tuş vuruşu **tek bir bloğu** değiştiriyor. Model kalıcı
 * (persistent): `replaceAt` yalnızca dokunulan bloğu yeni bir nesneyle
 * değiştiriyor, geri kalan bloklar **aynı nesne** olarak kalıyor. Nesne
 * kimliği bu yüzden kusursuz bir anahtar.
 *
 * ## Neden varsayılan değil
 *
 * Önbellek, düğümlerin **yerinde değiştirilmediği** varsayımına dayanıyor.
 * Kalem'in kendi kodu bu sözü tutuyor ama AST herkese açık: `onChange`
 * ikinci argümanda belgeyi veriyor ve bir kullanıcı onu yerinde
 * değiştirirse önbellek bayat çıktı verir — sessizce.
 *
 * Bu yüzden varsayılan davranış değişmedi. Önbelleği yalnızca belgesinin
 * değişmezliğinden **emin olan** çağıran açıyor; editör kendi belgesini
 * kendi ürettiği için açıyor.
 */
export interface SerializeCache {
	/** @internal Anahtar düğüm nesnesi; değer imza + çıktı. */
	readonly blocks: WeakMap<object, { readonly imza: string; readonly metin: string }>;
}

/** Yeni bir blok önbelleği üretir; `serialize(doc, { cache })` ile kullanılır. */
export function createSerializeCache(): SerializeCache {
	return { blocks: new WeakMap() };
}

/**
 * Önbellek imzası: çıktıyı etkileyen tüm seçenekler.
 *
 * Aynı düğüm farklı yazım tercihleriyle farklı Markdown veriyor, yani
 * anahtar tek başına düğüm olamaz. `lineEnding` de dâhil: blok çıktısı
 * içeride hep LF kullansa da onu dışarıda bırakmak, ileride bir blok
 * türü satır sonuna dokunduğunda sessiz bir hataya dönüşürdü.
 *
 * ## Neden `JSON.stringify`, neden düz birleştirme değil
 *
 * Alanları uç uca eklemek belirsiz: `thematicBreak` serbest metin, yani
 * iki farklı seçenek kümesi aynı dizeyi üretebilir. İlk sürüm araya bir
 * kontrol karakteri koyuyordu ve `guard:purity` onu haklı olarak
 * reddetti — ham kontrol karakteri, paket bir HTML sayfasına
 * gömüldüğünde tarayıcı tarafından U+FFFD'ye çevriliyor ve bundle
 * sessizce bozuluyor (bkz. iş listesi F5-03). `JSON.stringify` hem
 * belirsizliği kaldırıyor hem de yalnızca yazdırılabilir karakter
 * üretiyor.
 *
 * Maliyeti yok sayılır: `serialize` çağrısı başına bir kez çalışıyor,
 * blok başına değil.
 */
function imzala(o: Resolved): string {
	return JSON.stringify([
		o.bulletMarker,
		o.emphasisMarker,
		o.codeFence,
		o.orderedDelimiter,
		o.thematicBreak,
		o.lineEnding,
	]);
}

interface Resolved {
	readonly bulletMarker: "-" | "*" | "+";
	readonly emphasisMarker: "*" | "_";
	readonly codeFence: "`" | "~";
	readonly orderedDelimiter: "." | ")";
	readonly thematicBreak: string;
	lineEnding: "\n" | "\r\n" | "\r";
	readonly cache: SerializeCache | undefined;
}

function resolve(options: SerializeOptions): Resolved {
	return {
		bulletMarker: options.bulletMarker ?? "-",
		emphasisMarker: options.emphasisMarker ?? "*",
		codeFence: options.codeFence ?? "`",
		orderedDelimiter: options.orderedDelimiter ?? ".",
		thematicBreak: options.thematicBreak ?? "---",
		lineEnding: options.lineEnding ?? "\n",
		cache: options.cache,
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

	/*
	 * Önbellek yalnızca **üst seviye bloklarda**.
	 *
	 * İç içe düğümleri de önbelleğe almak kazancı artırmazdı: bir bloğun
	 * çıktısı zaten bir kez üretiliyor ve kaydediliyor. Buradaki döngü ise
	 * belge boyunca dönen tek döngü, yani doğrusal maliyetin tamamı burada.
	 */
	const onbellek = o.cache?.blocks;
	const imza = onbellek === undefined ? "" : imzala(o);

	const parts: string[] = [];
	for (const child of root.children) {
		if (child.type === "yaml") {
			parts.push(`---\n${child.value}\n---`);
			continue;
		}
		if (child.type === "toml") {
			parts.push(`+++\n${child.value}\n+++`);
			continue;
		}
		if (onbellek === undefined) {
			parts.push(block(child, o));
			continue;
		}
		const kayit = onbellek.get(child);
		if (kayit !== undefined && kayit.imza === imza) {
			parts.push(kayit.metin);
			continue;
		}
		const metin = block(child, o);
		onbellek.set(child, { imza, metin });
		parts.push(metin);
	}

	let out = parts[0] ?? "";
	for (let i = 1; i < parts.length; i++) {
		out += gap(root.children[i - 1], root.children[i], "\n\n") + (parts[i] ?? "");
	}
	const bas = root.syntax?.leadingBlankLines ?? 0;
	const son = root.syntax?.trailingBlankLines ?? 0;
	if (bas > 0 && out !== "") out = "\n".repeat(bas) + out;
	if (son > 0 && out !== "") out += "\n".repeat(son);
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
		const width = Math.max(node.syntax.underlineLength ?? content.length, 1);
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

/**
 * Alıntı.
 *
 * Çocuklar tek tek önekleniyor, çünkü tembel satırlar (`syntax.lazy`) bir
 * **paragraf çocuğun** satırlarına ait: hangi çıktı satırının hangi
 * paragrafın kaçıncı satırı olduğu ancak burada biliniyor.
 *
 * Tembel satır yalnızca paragrafın ilk satırından sonra `>`sız
 * bırakılıyor. Paragraf metni serileştirilirken satır başı işaretleri
 * zaten kaçırıldığı için (`#`, `-`, `>`…) böyle bir satır yeni blok
 * açamaz; düzenlemeden sonra bayatlamış bir kayıt bile geçerli Markdown
 * üretir.
 */
function blockquote(node: Blockquote, o: Resolved): string {
	// Çocuksuz alıntı da bir alıntı: tek başına `>`.
	if (node.children.length === 0) return ">";
	const tembel = new Set((node.syntax?.lazy ?? []).map(([cocuk, satir]) => `${cocuk}:${satir}`));
	const compact = node.syntax?.compact === true;
	const parts = node.children.map((child, i) =>
		block(child, o)
			.split("\n")
			.map((line, k) => {
				if (line === "") return ">";
				const lazy = k > 0 && child.type === "paragraph" && tembel.has(`${i}:${k}`);
				if (lazy) return line;
				// Boşluksuz `>` yalnızca satır boşlukla başlamıyorsa: `>` sonrası
				// ilk boşluk işaretin parçası sayılıyor, yani `>    kod` girintili
				// kodu üç boşluklu paragrafa çevirirdi.
				return compact && line[0] !== " " && line[0] !== "\t" ? `>${line}` : `> ${line}`;
			})
			.join("\n"),
	);
	let out = parts[0] ?? "";
	for (let i = 1; i < parts.length; i++) {
		// Çocuklar arasındaki boş satırlar da alıntının içinde: `>`.
		const ara = gap(node.children[i - 1], node.children[i], "\n\n");
		out += `\n${">\n".repeat(ara.length - 1)}${parts[i] ?? ""}`;
	}
	return out;
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
	// İşaretten önceki girinti işaretin parçası sayılıyor: devam satırları
	// `listItem`de işaret uzunluğu kadar girintileniyor, yani içerik sütunu
	// kendiliğinden doğru kalıyor.
	const girinti = " ".repeat(node.syntax?.indent ?? 0);
	const bosluk = " ".repeat(node.syntax?.spacing ?? 1);
	if (!node.ordered) return `${girinti}${node.syntax?.marker ?? o.bulletMarker}${bosluk}`;

	const delimiter = node.syntax?.delimiter ?? o.orderedDelimiter;
	const start = node.start ?? 1;
	// `1. 1. 1.` yazan kullanıcıya `1. 2. 3.` üretilmez.
	const number = node.syntax?.numbering === "repeated" ? start : start + index;
	return `${girinti}${number}${delimiter}${bosluk}`;
}

function listItem(node: ListItem, isaret: string, o: Resolved): string {
	const task = node.checked === null ? "" : node.checked ? "[x] " : "[ ] ";
	// İlk çocuk bir listeyse işaretle **aynı satıra** yazılıyor; oradaki
	// girinti satır başı girintisi değil, işaret sonrası boşluk olur ve
	// anlamı değişir.
	const [ilk, ...kalan] = node.children;
	const cocuklar =
		ilk?.type === "list" && ilk.syntax?.indent !== undefined
			? [{ ...ilk, syntax: { ...ilk.syntax, indent: 0 } }, ...kalan]
			: node.children;
	const inner = task + joinBlocks(cocuklar, o, node.spread ? "\n\n" : "\n");
	// İçerik boşlukla başlıyorsa (girintili kod) işaretten sonra tek boşluk
	// olmak zorunda: CommonMark 5+ boşluğu içeriğin parçası sayıyor ve
	// kaydedilmiş `spacing` kodun girintisine eklenirdi.
	const marker = /^[ \t]/.test(inner) ? `${isaret.trimEnd()} ` : isaret;
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
	return `[${node.label}]: ${destination(node.url)}${titlePart(node.title, undefined)}`;
}

/**
 * Tablo.
 *
 * Ham metin (`syntax.raw`) **satır satır** kullanılıyor: modeldeki satır
 * ham satırla anlamca aynıysa ham satır olduğu gibi yazılıyor — hücre
 * dolgusu ve boru hizası korunuyor. Değişen satır yeniden üretiliyor.
 *
 * Önceki sürüm ham metni koşulsuz geri yazıyordu. Editör hücreleri
 * düzenlenebilir çiziyor, yani kullanıcı bir hücreye yazabiliyor, model
 * güncelleniyor ama **yazdığı hiçbir şey çıktıya girmiyordu** (F4-03'te
 * bulunan sessiz veri kaybı). Tablonun tamamını yeniden üretmek ise tek
 * kelime için bütün hizalamayı bozardı.
 *
 * Satır ekleme, silme ve hizalama arayüzü v1'de yok (Karar #5, v1.1'de
 * `@kalem-editor/plugin-table`); satır sayısı ham metinle tutmazsa tablo baştan
 * üretiliyor.
 */
function table(node: Table, o: Resolved): string {
	const raw = node.syntax?.raw;
	if (raw !== undefined) {
		const satirlar = raw.split("\n");
		// Başlık + ayraç + gövde. Satır sayısı tutmuyorsa yapı değişmiş
		// demek; ham metin artık bu tabloyu anlatmıyor.
		if (satirlar.length === node.children.length + 1) {
			return satirlar
				.map((satir, i) => {
					if (i === 1) return satir;
					const row = node.children[i === 0 ? 0 : i - 1] as TableRow;
					return ayniSatir(satir, row) ? satir : tabloSatiri(row, o, satir);
				})
				.join("\n");
		}
	}

	const rows = node.children.map((row) => tabloSatiri(row, o));
	const delimiter = `| ${node.align
		.map((a) => (a === "left" ? ":---" : a === "right" ? "---:" : a === "center" ? ":---:" : "---"))
		.join(" | ")} |`;
	return [rows[0] ?? "|  |", delimiter, ...rows.slice(1)].join("\n");
}

/**
 * Ham satırdaki hücreler modeldeki hücrelerle anlamca aynı mı.
 *
 * Metin değil **ağaç** karşılaştırılıyor: ham hücre yeniden ayrıştırılıp
 * modeldeki hücreyle kıyaslanıyor. Metin karşılaştırması kaçış farklarında
 * (`\|`, `\*`) dokunulmamış satırı "değişmiş" sayar ve hizasını bozardı.
 * `position`, `id` ve `syntax` dışarıda: editörün DOM'dan okuduğu hücre
 * yazım tercihini taşımıyor ama içerik aynıysa aynı hücredir.
 */
function ayniSatir(satir: string, row: TableRow): boolean {
	const hucreler = splitRow(satir);
	return row.children.every(
		(cell, c) =>
			hucreAnahtari(cellInlines(hucreler[c] ?? "", parseInline)) === hucreAnahtari(cell.children),
	);
}

/**
 * Bu konumdaki boru ayraç mı: önünde ters bölü yoksa evet.
 *
 * Ayrıştırıcının kuralıyla (`splitRow`) birebir aynı olmak zorunda — ve o
 * kural cmark-gfm'inki: boru hücreye bölme aşamasında, satır içi kaçışlar
 * çözülmeden önce ayrılıyor, yani önündeki **tek** ters bölüye bakılıyor.
 */
function ayracMi(metin: string, i: number): boolean {
	return metin[i - 1] !== "\\";
}

/** Hücre metninde ayraç sayılacak boruları kaçırır. */
function boruKacir(metin: string): string {
	let out = "";
	for (let i = 0; i < metin.length; i++) {
		out += metin[i] === "|" && ayracMi(metin, i) ? "\\|" : metin[i];
	}
	return out;
}

/** Ayraç borularından böler; parçaların boşlukları korunur (genişlik için). */
function boruyaGoreBol(metin: string): string[] {
	const parcalar: string[] = [];
	let bas = 0;
	for (let i = 0; i < metin.length; i++) {
		if (metin[i] === "|" && ayracMi(metin, i)) {
			parcalar.push(metin.slice(bas, i));
			bas = i + 1;
		}
	}
	parcalar.push(metin.slice(bas));
	return parcalar;
}

const ATLANAN = new Set(["position", "id", "syntax"]);

/**
 * Hücredeki satır sonu `<br>` olarak yazılır.
 *
 * Ters bölü ya da iki boşluk gerçek bir satır sonu üretir ve GFM tablo
 * satırını ikiye böler: ikinci yarısı tablonun dışına düşer, sonraki
 * açılışta hücrenin içeriği kaybolmuş olur.
 */
function hucreSatirSonu(node: Inline): Inline {
	if (node.type === "break") {
		return {
			type: "html",
			value: node.syntax?.marker === "html" ? (node.syntax.tag ?? "<br>") : "<br>",
		};
	}
	return "children" in node
		? ({ ...node, children: node.children.map(hucreSatirSonu) } as Inline)
		: node;
}

function hucreAnahtari(nodes: readonly Inline[]): string {
	return JSON.stringify(nodes, (k, v: unknown) => (ATLANAN.has(k) ? undefined : v));
}

/**
 * Bir tablo satırını yazar.
 *
 * `ornek` verilirse (değişen satırın ham hâli) onun biçimi korunuyor: kenar
 * boruları var mıydı, her hücre kaç karakter genişliğindeydi. Yeni içerik
 * eski genişliğe sığıyorsa boşlukla dolduruluyor — sütunların hizası tek
 * hücre değişti diye kaymasın. Sığmıyorsa hücre uzuyor; tabloyu yeniden
 * hizalamak dokunulmamış satırları değiştirmek olurdu.
 */
function tabloSatiri(row: TableRow, o: Resolved, ornek?: string): string {
	// Hücre içindeki boru ayraç sanılmasın.
	const icerik = row.children.map((cell) =>
		boruKacir(inlines(cell.children.map(hucreSatirSonu), o)),
	);
	if (ornek === undefined) return `| ${icerik.join(" | ")} |`;

	const govde = ornek.trim();
	const bas = govde.startsWith("|");
	const son = govde.length > 1 && govde.endsWith("|") && ayracMi(govde, govde.length - 1);
	const girinti = ornek.slice(0, ornek.length - ornek.trimStart().length);
	const ic = govde.slice(bas ? 1 : 0, son ? -1 : undefined);
	const eskiler = boruyaGoreBol(ic);

	const hucreler = icerik.map((metin, c) => {
		const eski = eskiler[c];
		if (eski === undefined) return ` ${metin} `;
		const sol = eski.length - eski.trimStart().length;
		const yeni = `${" ".repeat(sol)}${metin}`;
		// Sağdaki dolgu: en az bir boşluk (varsa), genişlik korunarak.
		const sagVardi = eski.length > eski.trimEnd().length;
		return yeni.length + (sagVardi ? 1 : 0) <= eski.length
			? yeni.padEnd(eski.length)
			: `${yeni}${sagVardi ? " " : ""}`;
	});
	return `${girinti}${bas ? "|" : ""}${hucreler.join("|")}${son ? "|" : ""}`;
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
		node.type === "color" ||
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

	/*
	 * `***metin***`: italik içinde **aynı işaretle** kalın. Üç işaret
	 * CommonMark'ta tam olarak italik(kalın(…)) okunuyor, yani burada öteki
	 * işarete geçmek gerekmiyor — geçilince `_**metin**_` çıkıyordu.
	 * Tersi (kalın içinde italik) aynı metne okunamaz; ona dokunulmuyor.
	 */
	const cift = preferred.repeat(2);
	const ucluOkunur =
		length === 1 &&
		core.startsWith(cift) &&
		core.endsWith(cift) &&
		!core.startsWith(preferred.repeat(3)) &&
		!core.endsWith(preferred.repeat(3));
	if (ucluOkunur) return wrapMarked(inner, preferred, false);

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
			// Varsayılan ters bölü, iki boşluk değil.
			//
			// Kaynakta iki boşlukla yazılmış satır sonları `syntax` sayesinde
			// olduğu gibi kalıyor; buradaki seçim yalnızca **yeni** düğümler
			// için. İki boşluk görünmez: çoğu editör, linter ve `git` yapılandırması
			// satır sonundaki boşluğu kırpar ve kırpınca satır sonu sessizce
			// kaybolur. remark de aynı sebeple ters bölü yazar.
			return node.syntax?.marker === "spaces" ? `${" ".repeat(node.syntax.width ?? 2)}\n` : "\\\n";
		case "html":
			return node.value;
		case "color":
			return colored(node, inlines(node.children, o, false, enclosing));
	}
}

function colored(node: Color, inner: string): string {
	const color = sanitizeColor(node.color);
	if (color === null || inner === "") return inner;
	const raw = node.syntax;
	const open =
		raw !== undefined && colorOfOpenTag(raw.open) === color ? raw.open : colorOpenTag(color);
	return `${open}${inner}${raw?.close ?? "</span>"}`;
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

	return `[${label}](${destination(node.url)}${titlePart(node.title, node.syntax?.titleDelimiter)})`;
}

function image(node: Extract<Inline, { type: "image" }>): string {
	return `![${node.alt ?? ""}](${destination(node.url)}${titlePart(node.title, node.syntax?.titleDelimiter)})`;
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

/**
 * Hedefi yazar.
 *
 * AST çözülmüş değeri taşıdığı için (`\(` orada zaten `(`), kaçışı burada
 * geri koymak gerekiyor. İki biçim var ve seçim içeriğe bakıyor:
 *
 * - Boşluk ya da açılı ayraç varsa `<…>` — okunur ve tek kuralla doğru.
 * - Değilse çıplak. Parantezler **dengeliyse dokunulmuyor**: `foo(bar)`
 *   böyle yazılabilir ve gidiş-dönüş byte-birebir kalır. Dengesizse
 *   hepsi kaçışlanır, yoksa bağlantı erken kapanır.
 */
function destination(url: string): string {
	if (url === "" || /[\s<>]/.test(url)) return `<${url.replace(/[\\<>]/g, "\\$&")}>`;
	const escaped = url.replace(/\\/g, "\\\\");
	return balancedParens(escaped) ? escaped : escaped.replace(/[()]/g, "\\$&");
}

/** Parantezler dengeli mi — hiçbir ön ek eksiye düşmüyor ve sonuç sıfır. */
function balancedParens(value: string): boolean {
	let depth = 0;
	for (const ch of value) {
		if (ch === "(") depth++;
		else if (ch === ")" && --depth < 0) return false;
	}
	return depth === 0;
}

/**
 * Başlığı yazar.
 *
 * Ayraç kaynaktaki tercihtir (`'x'` yazan `"x"` görmemeli). Kapanış
 * karakteri ve ters bölü kaçışlanıyor; başka hiçbir şeye dokunulmuyor.
 */
function titlePart(title: string | null, delimiter: '"' | "'" | "(" | undefined): string {
	if (title === null) return "";
	const open = delimiter ?? '"';
	const close = open === "(" ? ")" : open;
	let escaped = title.split("\\").join("\\\\");
	escaped =
		open === "("
			? escaped.split("(").join("\\(").split(")").join("\\)")
			: escaped.split(close).join(`\\${close}`);
	return ` ${open}${escaped}${close}`;
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

/** CommonMark'ta ters bölüyle kaçırılabilen ASCII noktalama. */
const KACIRILABILIR = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

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
 * Bu `_` gerçekten eşleşebilecek bir `_` ile birlikte mi.
 *
 * `hasPartner` satırdaki **herhangi** bir `_`'yi eş sayıyor. Alt çizgide
 * bu fazla temkinli: kelime içindeki `_` (`under_score`) CommonMark'ta ne
 * açabilir ne kapatabilir. `under_score_` yazan kullanıcı, sondaki `_` için
 * `under_score\_` görüyordu.
 *
 * Burada açma/kapama yeteneği yaklaşık hesaplanıyor: açabilmek için sonraki
 * karakter boşluk olmamalı ve önceki kelime harfi olmamalı; kapatmak için
 * tersi. Noktalama inceliklerinde yaklaşım **daha fazla** eş buluyor, yani
 * hata payı kaçış yönünde — fazladan bir `\` çirkin ama yanlış değil.
 */
function hasUnderscorePartner(line: string, i: number): boolean {
	// `__` gibi diziler birlikte tek bir işaret: tek tek karakterin yeteneğine
	// bakmak orada yanlış. Dizide eski temkinli kurala dönülüyor.
	const dizide = (j: number) => line[j - 1] === "_" || line[j + 1] === "_";
	if (dizide(i)) return hasPartner(line, i, "_");

	const acabilir = (j: number) => !isSpaceOrEdge(line[j + 1]) && !isWordChar(line[j - 1]);
	const kapatabilir = (j: number) => !isSpaceOrEdge(line[j - 1]) && !isWordChar(line[j + 1]);
	for (let j = 0; j < line.length; j++) {
		if (j === i || line[j] !== "_") continue;
		if (dizide(j)) return true;
		if (j > i && acabilir(i) && kapatabilir(j)) return true;
		if (j < i && kapatabilir(i) && acabilir(j)) return true;
	}
	return false;
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

	// Ters bölü yalnızca bir noktalama işaretinin ya da satır sonunun
	// önündeyse anlam taşıyor; `C:\Users` içindeki ters bölü düz metin ve
	// kaçırılırsa ikiye katlanıyordu. Satırın (ya da düğümün) sonunda sonraki
	// karakter bilinmiyor — orada temkinli davranılıyor.
	if (ch === "\\") return next === undefined || KACIRILABILIR.includes(next);
	if (ch === "[" || ch === "]" || ch === "`") return true;

	if (ch === "~") {
		// Üstü çizili bir EŞ gerektirir. Tek başına duran `~` — "~1 hafta"
		// gibi "yaklaşık" anlamındaki kullanımlar — kaçırılmamalı; kaçırmak
		// hem gürültü hem gidiş-dönüş kaybı olurdu.
		if (isSpaceOrEdge(prev) && isSpaceOrEdge(next)) return false;
		return hasPartner(line, i, ch);
	}
	if (ch === "*" || ch === "_") {
		// Satır başında blok açıyorsa (liste ya da yatay çizgi) kaçırılmalı.
		// "İki yanı boşluk" kuralından **önce**: `*    ` satırı iki yanı boş
		// bir yıldız ama boş bir liste maddesi açıyor.
		if (atLineStart && i === 0 && (LIST_PREFIX.test(line) || THEMATIC_LINE.test(line))) return true;
		if (isSpaceOrEdge(prev) && isSpaceOrEdge(next)) return false;
		// Kelime içindeki alt çizgi vurgu açmaz: `dosya_adi_uzun` bozulmamalı.
		if (ch === "_" && isWordChar(prev) && isWordChar(next)) return false;
		// Vurgu bir EŞ gerektirir; eşi olmayan işaret düz metindir.
		if (ch === "_") return hasUnderscorePartner(line, i);
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
