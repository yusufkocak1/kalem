/**
 * @kalem-editor/core/html — HTML → AST dönüştürücü  (İş listesi: F1-09)
 *
 * Yapıştırma normalleştirmesinin beyni. Word, Google Docs, Excel, Notion ve
 * genel web HTML'ini AST'ye çevirir.
 *
 * ## Neden ayrı giriş noktası
 *
 * `@kalem-editor/core/html` olarak yayımlanıyor. Yalnızca Markdown işleyen bir
 * kullanıcı bu kodu indirmemeli; yapıştırma bir **editör** ihtiyacı (F3-07
 * boru hattı bunu kullanacak). Analiz §5.3 bunu zaten öngörmüştü.
 *
 * ## Neden DOM tipleri yok
 *
 * `@kalem-editor/core` sunucuda da çalışmak zorunda ve saflık kapısı DOM globallerini
 * yasaklıyor. Bu yüzden dönüştürücü, gerçek bir `Element`'in **yapısal olarak
 * uyduğu** küçük bir arayüzle çalışır. İki kazanç:
 *
 * - HTML metnini DOM'a çevirme işi (tarayıcıya özgü) çağırana kalır.
 * - Testler jsdom olmadan, düz nesnelerle yazılabilir.
 *
 * ## Yaklaşım: beyaz liste
 *
 * Bilinmeyen etiket = **içeriği düz metne düşür**. Kara liste yaklaşımı
 * Word'ün her sürümde yeni ürettiği çöple baş edemez; beyaz liste eder.
 *
 * @module @kalem-editor/core/html
 */
import type { Block, Inline, List, Root } from "./ast.js";
import { sanitizeColor } from "./color.js";
import { isSafeUrl, NEUTRALIZED_URL } from "./security.js";

/**
 * Gerçek bir DOM düğümünün yapısal alt kümesi.
 *
 * `Element` ve `Text` bu arayüze **kendiliğinden uyar** — tip dönüşümü
 * gerekmez. Testlerde düz nesnelerle de sağlanabilir.
 */
export interface HtmlNode {
	/** 1 = eleman, 3 = metin, 8 = yorum (DOM sabitleri). */
	readonly nodeType: number;
	/** `"DIV"`, `"#text"` … */
	readonly nodeName: string;
	readonly textContent: string | null;
	readonly childNodes: ArrayLike<HtmlNode>;
	/** Yalnızca elemanlarda bulunur. */
	getAttribute?(name: string): string | null;
}

const ELEMENT = 1;
const TEXT = 3;

/** Hiç render edilmeyen etiketler — içerikleri de atılır. */
const DROPPED = new Set([
	"SCRIPT",
	"STYLE",
	"HEAD",
	"META",
	"LINK",
	"TITLE",
	"NOSCRIPT",
	"TEMPLATE",
	"O:P", // Word'ün boş paragraf işaretçisi
	"XML",
]);

/** Kendi anlamı olmayan, içeriği yukarı taşınan etiketler. */
const TRANSPARENT = new Set([
	"DIV",
	"SPAN",
	"SECTION",
	"ARTICLE",
	"MAIN",
	"HEADER",
	"FOOTER",
	"NAV",
	"ASIDE",
	"FONT",
	"BODY",
	"HTML",
	"TBODY",
	"THEAD",
	"TFOOT",
	"FIGURE",
	"CENTER",
]);

/** Satır içi biçim etiketleri → AST düğüm türü. */
const INLINE_MARKS: Record<string, "strong" | "emphasis" | "delete"> = {
	STRONG: "strong",
	B: "strong",
	EM: "emphasis",
	I: "emphasis",
	CITE: "emphasis",
	DEL: "delete",
	S: "delete",
	STRIKE: "delete",
};

export interface FromHtmlOptions {
	/**
	 * Güvenli olmayan URL'ler için davranış.
	 *
	 * Varsayılan `drop`: bağlantı kaldırılır, metni kalır. Yapıştırılan
	 * içerikte `javascript:` bağlantısı görmek, kullanıcının kendi yazdığı
	 * bir şey olmadığı için sessizce düşürmek daha doğru.
	 */
	unsafeUrls?: "drop" | "keep";
}

/** HTML ağacını Markdown AST'sine çevirir. */
export function fromHtml(root: HtmlNode, options: FromHtmlOptions = {}): Root {
	const blocks = collectBlocks(childrenOf(root), options);
	return { type: "root", children: blocks.length === 0 ? [] : blocks };
}

// ---------------------------------------------------------------------------
// Gezinme yardımcıları
// ---------------------------------------------------------------------------

function childrenOf(node: HtmlNode): HtmlNode[] {
	const out: HtmlNode[] = [];
	for (let i = 0; i < node.childNodes.length; i++) {
		const child = node.childNodes[i];
		if (child !== undefined) out.push(child);
	}
	return out;
}

function tagOf(node: HtmlNode): string {
	// kalem-locale-ok: HTML etiket adları ASCII'dir, locale kuralı zarar verir
	return node.nodeName.toUpperCase();
}

function attr(node: HtmlNode, name: string): string | null {
	return node.getAttribute?.(name) ?? null;
}

/**
 * Word'ün boş kabuk `<span>`'ları ve `mso-*` stilleri işe yaramaz.
 *
 * Word bir paragrafı onlarca iç içe boş `<span>` ile sarar; hepsi
 * `TRANSPARENT` olduğu için zaten düzleşir. Burada yalnızca **tamamen boş**
 * olanlar erkenden atılır.
 */
function isEmptyShell(node: HtmlNode): boolean {
	if (node.nodeType !== ELEMENT) return false;
	if (!TRANSPARENT.has(tagOf(node))) return false;
	return (node.textContent ?? "").trim() === "" && childrenOf(node).length === 0;
}

// ---------------------------------------------------------------------------
// Stil çıkarımı
// ---------------------------------------------------------------------------

/** `style` özniteliğini basit bir sözlüğe çevirir. */
function styleMap(node: HtmlNode): Map<string, string> {
	const map = new Map<string, string>();
	const raw = attr(node, "style");
	if (raw === null) return map;

	for (const declaration of raw.split(";")) {
		const colon = declaration.indexOf(":");
		if (colon === -1) continue;
		// kalem-locale-ok: CSS özellik adları ASCII'dir
		const key = declaration.slice(0, colon).trim().toLowerCase();
		// kalem-locale-ok: CSS değerleri burada ASCII anahtar kelime olarak karşılaştırılıyor
		const value = declaration
			.slice(colon + 1)
			.trim()
			.toLowerCase();
		if (key !== "") map.set(key, value);
	}
	return map;
}

/**
 * Stilden çıkarılan biçimler.
 *
 * Word ve Google Docs semantik etiket yerine stil kullanır: `<span
 * style="font-weight:700">` yazar, `<strong>` yazmaz. Bu çıkarım olmadan
 * yapıştırılan metnin bütün biçimi kaybolur.
 */
function marksFromStyle(node: HtmlNode): ("strong" | "emphasis" | "delete")[] {
	const style = styleMap(node);
	const marks: ("strong" | "emphasis" | "delete")[] = [];

	const weight = style.get("font-weight");
	if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) marks.push("strong");

	const fontStyle = style.get("font-style");
	if (fontStyle === "italic" || fontStyle === "oblique") marks.push("emphasis");

	const decoration = style.get("text-decoration") ?? style.get("text-decoration-line");
	if (decoration?.includes("line-through")) marks.push("delete");

	return marks;
}

/**
 * Google Docs'un `<b style="font-weight:normal">` sarmalayıcısı.
 *
 * GDocs yapıştırmanın tamamını bu etiketle sarar ve stil ile kalınlığı
 * **iptal eder**. Etiketi olduğu gibi almak bütün metni kalın yapardı —
 * bilinen ve sık karşılaşılan bir tuzak.
 */
function isFakeBold(node: HtmlNode): boolean {
	if (tagOf(node) !== "B") return false;
	const weight = styleMap(node).get("font-weight");
	return weight === "normal" || weight === "400";
}

// ---------------------------------------------------------------------------
// Blok düzeyi
// ---------------------------------------------------------------------------

function collectBlocks(nodes: readonly HtmlNode[], o: FromHtmlOptions): Block[] {
	const out: Block[] = [];
	/** Blok kabına girmeyen satır içi parçalar burada birikir. */
	let pending: Inline[] = [];

	/** Ardışık Word liste maddeleri; `flushList` onları listeye çeviriyor. */
	let wordItems: WordListItem[] = [];

	const flushList = (): void => {
		if (wordItems.length === 0) return;
		out.push(...wordList(wordItems));
		wordItems = [];
	};

	const flush = (): void => {
		const trimmed = trimInlines(pending);
		if (trimmed.length > 0) {
			flushList();
			out.push({ type: "paragraph", children: trimmed });
		}
		pending = [];
	};

	for (const node of nodes) {
		if (node.nodeType === TEXT) {
			pending.push(...textToInlines(node.textContent ?? ""));
			continue;
		}
		if (node.nodeType !== ELEMENT) continue;

		const tag = tagOf(node);
		if (DROPPED.has(tag)) continue;
		if (isEmptyShell(node)) continue;

		// Word'ün sahte liste maddeleri: ardışık olanlar biriktirilip tek
		// listeye çevriliyor (aşağıya bakın).
		const wordItem = wordListItem(node, tag, o);
		if (wordItem !== null) {
			flush();
			wordItems.push(wordItem);
			continue;
		}

		const block = toBlock(node, tag, o);
		if (block !== null) {
			flush();
			flushList();
			out.push(...block);
			continue;
		}
		pending.push(...toInlines(node, o));
	}

	flush();
	flushList();
	return out;
}

/** Eleman bir blok üretiyorsa onu, üretmiyorsa `null` döndürür. */
function toBlock(node: HtmlNode, tag: string, o: FromHtmlOptions): Block[] | null {
	switch (tag) {
		case "H1":
		case "H2":
		case "H3":
		case "H4":
		case "H5":
		case "H6":
			return [
				{
					type: "heading",
					depth: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6,
					children: trimInlines(collectInlines(childrenOf(node), o)),
				},
			];

		case "P": {
			const children = trimInlines(collectInlines(childrenOf(node), o));
			// Word dikey boşluk için `<p>&nbsp;</p>` üretir. Markdown'da bu işi
			// boş satır yapar; boş paragraf düğümü tutmak çıktıyı kirletirdi.
			return children.length === 0 ? [] : [{ type: "paragraph", children }];
		}

		case "PRE":
			return [{ type: "code", lang: null, meta: null, value: codeValue(node) }];

		case "BLOCKQUOTE":
			return [{ type: "blockquote", children: collectBlocks(childrenOf(node), o) }];

		case "HR":
			return [{ type: "thematicBreak" }];

		case "UL":
		case "OL":
			return [listFrom(node, tag === "OL", o)];

		case "TABLE":
			return [tableFrom(node, o)];

		default:
			// Saydam kaplar kendi bloklarını yukarı taşır.
			if (TRANSPARENT.has(tag)) {
				const inner = collectBlocks(childrenOf(node), o);
				return inner.length > 0 ? inner : null;
			}
			return null;
	}
}

/** `<pre>` içeriği: satır içi biçimler yok sayılır, düz metin alınır. */
function codeValue(node: HtmlNode): string {
	const text = (node.textContent ?? "").replace(/\r\n?/g, "\n");
	return text === "" ? "" : text.endsWith("\n") ? text : `${text}\n`;
}

function listFrom(node: HtmlNode, ordered: boolean, o: FromHtmlOptions): Block {
	const items = childrenOf(node)
		.filter((c) => c.nodeType === ELEMENT && tagOf(c) === "LI")
		.map((li) => {
			const blocks = collectBlocks(childrenOf(li), o);
			return {
				type: "listItem" as const,
				checked: checkedState(li),
				spread: false,
				children: blocks.length > 0 ? blocks : [{ type: "paragraph" as const, children: [] }],
			};
		});

	const start = ordered ? Number(attr(node, "start") ?? 1) : null;
	return {
		type: "list",
		ordered,
		start: start !== null && Number.isFinite(start) ? start : ordered ? 1 : null,
		spread: false,
		children: items,
	};
}

/** `<li>` içinde onay kutusu varsa görev maddesidir (GitHub, Notion). */
function checkedState(li: HtmlNode): boolean | null {
	for (const child of childrenOf(li)) {
		if (child.nodeType !== ELEMENT) continue;
		if (tagOf(child) === "INPUT" && attr(child, "type") === "checkbox") {
			return attr(child, "checked") !== null;
		}
	}
	return null;
}

function tableFrom(node: HtmlNode, o: FromHtmlOptions): Block {
	const rows: HtmlNode[] = [];
	const walk = (current: HtmlNode): void => {
		for (const child of childrenOf(current)) {
			if (child.nodeType !== ELEMENT) continue;
			if (tagOf(child) === "TR") rows.push(child);
			else walk(child);
		}
	};
	walk(node);

	const children = rows.map((row) => ({
		type: "tableRow" as const,
		children: childrenOf(row)
			.filter((c) => c.nodeType === ELEMENT && (tagOf(c) === "TD" || tagOf(c) === "TH"))
			.map((cell) => ({
				type: "tableCell" as const,
				children: cellFrom(cell, o),
			})),
	}));

	const columns = children[0]?.children.length ?? 0;
	return { type: "table", align: Array.from({ length: columns }, () => null), children };
}

/** Hücrede satır ayıran öğeler. */
const CELL_LINES = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "PRE"]);
/** Satırlarını kendi öğelerinde taşıyan sarmalayıcılar. */
const CELL_WRAPPERS = new Set(["UL", "OL", "BLOCKQUOTE"]);

/**
 * Hücrenin içeriği; paragrafları ve liste maddeleri ayrı satırlarda.
 *
 * Markdown hücresinde blok olamaz. Paragraflar bitişik yazılırsa
 * kelimeler birleşir ("BirinciIkinci"); her biri `<br>` ile ayrılmış bir
 * satır oluyor, liste maddelerinin önüne `• ` konuyor.
 */
function cellFrom(cell: HtmlNode, o: FromHtmlOptions): Inline[] {
	const lines: Inline[][] = [];
	let pending: Inline[] = [];
	/** Sıradaki satır bir liste maddesinin ilki; `<li><p>…</p></li>` tek madde imi alır. */
	let bullet = false;
	const flush = (): void => {
		const line = trimInlines(mergeText(pending));
		pending = [];
		if (line.length === 0) return;
		lines.push(bullet ? mergeText([{ type: "text", value: "• " }, ...line]) : line);
		bullet = false;
	};
	const walk = (nodes: readonly HtmlNode[]): void => {
		for (const node of nodes) {
			const tag = node.nodeType === ELEMENT ? tagOf(node) : "";
			if (CELL_WRAPPERS.has(tag)) {
				flush();
				walk(childrenOf(node));
			} else if (CELL_LINES.has(tag)) {
				flush();
				if (tag === "LI") bullet = true;
				walk(childrenOf(node));
				flush();
			} else {
				pending.push(...toInlines(node, o));
			}
		}
	};
	walk(childrenOf(cell));
	flush();
	return lines.flatMap((line, i) => (i === 0 ? line : [{ type: "break" } as Inline, ...line]));
}

// ---------------------------------------------------------------------------
// Satır içi
// ---------------------------------------------------------------------------

function collectInlines(nodes: readonly HtmlNode[], o: FromHtmlOptions): Inline[] {
	const out: Inline[] = [];
	for (const node of nodes) out.push(...toInlines(node, o));
	return mergeText(out);
}

function toInlines(node: HtmlNode, o: FromHtmlOptions): Inline[] {
	if (node.nodeType === TEXT) return textToInlines(node.textContent ?? "");
	if (node.nodeType !== ELEMENT) return [];

	const tag = tagOf(node);
	if (DROPPED.has(tag)) return [];
	// `mso-list:Ignore` Word'ün kendi işareti: "bu içerik değil, çizim".
	// Madde imleri bu şekilde geliyor ve metne karışırsa kullanıcının
	// yazısının parçası hâline geliyorlar.
	if (styleMap(node).get("mso-list") === "ignore") return [];
	if (tag === "BR") return [{ type: "break" }];

	if (tag === "IMG") {
		const url = attr(node, "src") ?? "";
		// Kaynaksız görsel yer tutucudur; Word ve GDocs bunlardan üretir.
		if (url === "") return [];
		if (!isSafeUrl(url, { image: true })) return [];
		return [{ type: "image", url, alt: attr(node, "alt"), title: attr(node, "title") }];
	}

	if (tag === "A") {
		const url = attr(node, "href") ?? "";
		const children = collectInlines(childrenOf(node), o);
		// Hedefsiz bağlantı yalnızca metindir; sarmalayıcı gürültüdür.
		if (url === "") return children;
		if (!isSafeUrl(url)) {
			// `drop` (varsayılan): bağlantı kalkar, metni kalır.
			// `keep`: bağlantı görünür kalır ama hedefi etkisizleştirilir —
			// kullanıcı orada bir bağlantı olduğunu görmek isteyebilir.
			if (o.unsafeUrls !== "keep") return children;
			return [{ type: "link", url: NEUTRALIZED_URL, title: attr(node, "title"), children }];
		}
		return [{ type: "link", url, title: attr(node, "title"), children }];
	}

	if (tag === "CODE") {
		// `<pre><code>` blok olarak ele alınır; buradaki satır içi koddur.
		return [{ type: "inlineCode", value: node.textContent ?? "" }];
	}

	const children = collectInlines(childrenOf(node), o);

	// Google Docs'un sahte kalını: sarmalayıcı açılır, biçim uygulanmaz.
	const marks = isFakeBold(node)
		? marksFromStyle(node).filter((m) => m !== "strong")
		: [...(INLINE_MARKS[tag] !== undefined ? [INLINE_MARKS[tag]] : []), ...marksFromStyle(node)];

	return withColor(applyMarks(children, dedupe(marks)), node);
}

const DEFAULT_COLORS = new Set([
	"black",
	"#000",
	"#000000",
	"windowtext",
	"inherit",
	"initial",
	"currentcolor",
]);

/**
 * Only a span whose style is the color and nothing else. Browsers copy every
 * computed property onto each span, so taking any `color` would paint pasted
 * web pages in their source theme.
 */
function withColor(children: Inline[], node: HtmlNode): Inline[] {
	if (children.length === 0 || tagOf(node) !== "SPAN") return children;
	const style = styleMap(node);
	const value = style.size === 1 ? style.get("color") : undefined;
	if (value === undefined || DEFAULT_COLORS.has(value)) return children;
	const color = sanitizeColor(value);
	return color === null ? children : [{ type: "color", color, children }];
}

/**
 * Biçimleri iç içe sarar.
 *
 * **Aynı biçim iki kez sarılmıyor.** Word semantik etiketi *ve* stili
 * birlikte yazıyor: `<b><span style="font-weight:bold">metin</span></b>`.
 * İkisi de `strong` üretiyor ve saf sarma `strong > strong` veriyor;
 * Markdown'a `__**metin**__` diye çıkıyor. `dedupe` bunu yakalayamıyor
 * çünkü işaretler **ayrı düğümlerden** geliyor.
 */
function applyMarks(children: Inline[], marks: readonly string[]): Inline[] {
	if (children.length === 0) return [];
	let out = children;
	for (const mark of marks) {
		const tek = out.length === 1 ? out[0] : undefined;
		if (tek?.type === mark) continue;
		out = [{ type: mark, children: out } as Inline];
	}
	return out;
}

function dedupe<T>(items: readonly (T | undefined)[]): T[] {
	const seen = new Set<T>();
	for (const item of items) if (item !== undefined) seen.add(item);
	return [...seen];
}

/**
 * HTML metnini satır içi düğümlere çevirir.
 *
 * HTML'de ardışık boşluklar tek boşluğa iner ve satır sonu boşluktur. Bu
 * normalleştirme yapılmazsa Word'den yapıştırılan metin onlarca gereksiz
 * boşlukla gelir.
 */
function textToInlines(value: string): Inline[] {
	const normalized = value.replace(/[\t\n\r ]+/g, " ").replace(/ /g, " ");
	return normalized === "" ? [] : [{ type: "text", value: normalized }];
}

/** Ardışık metin düğümlerini birleştirir. */
function mergeText(nodes: readonly Inline[]): Inline[] {
	const out: Inline[] = [];
	for (const node of nodes) {
		const last = out[out.length - 1];
		if (last !== undefined && last.type === "text" && node.type === "text") {
			last.value += node.value;
			continue;
		}
		out.push(node);
	}
	return out;
}

/** Baştaki ve sondaki boşluğu kırpar; tamamen boşsa listeyi boşaltır. */
function trimInlines(nodes: readonly Inline[]): Inline[] {
	const copy = nodes.map((n) => (n.type === "text" ? { ...n } : n));
	const first = copy[0];
	if (first?.type === "text") first.value = first.value.replace(/^ +/, "");
	const last = copy[copy.length - 1];
	if (last?.type === "text") last.value = last.value.replace(/ +$/, "");
	return copy.filter((n) => !(n.type === "text" && n.value === ""));
}

// ---------------------------------------------------------------------------
// Word'ün sahte listeleri
// ---------------------------------------------------------------------------

/**
 * Word listeleri `<ul>`/`<ol>` üretmez.
 *
 * Her madde ayrı bir `<p class=MsoListParagraph style='mso-list:l0 level1
 * lfo1'>` ve madde imi, paragrafın içine gömülü bir `<span
 * style='mso-list:Ignore'>·</span>` metnidir. İşlenmezse yapıştırılan
 * belgede liste diye bir şey kalmaz: ekranda "· Madde bir" yazan düz
 * paragraflar olur ve Markdown çıktısında madde imi kullanıcının **metni**
 * hâline gelir.
 *
 * Bu yüzden ardışık madde paragrafları toplanıp `level` numaralarına göre
 * yeniden iç içe listelere çevriliyor.
 */
interface WordListItem {
	readonly level: number;
	readonly ordered: boolean;
	readonly children: Inline[];
}

/** `mso-list:Ignore` taşıyan ilk torun — madde iminin kendisi. */
function msoMarker(node: HtmlNode): HtmlNode | null {
	for (const child of childrenOf(node)) {
		if (child.nodeType !== ELEMENT) continue;
		if (styleMap(child).get("mso-list") === "ignore") return child;
		const inner = msoMarker(child);
		if (inner !== null) return inner;
	}
	return null;
}

/**
 * Madde imi sıralı mı.
 *
 * Word sırasız listelerde `·`, `o`, `§` gibi simgeler; sıralı listelerde
 * `1.`, `a)`, `iv.` gibi diziler kullanır. Ayrım tek kurala iniyor: im bir
 * sayı ya da harf dizisiyse sıralı.
 */
const SIRALI_IM = /^\s*(?:\d+|[a-z]+|[ivxlcdm]+)\s*[.)]/i;

/** Paragraf bir Word liste maddesiyse onu döndürür. */
function wordListItem(node: HtmlNode, tag: string, o: FromHtmlOptions): WordListItem | null {
	if (tag !== "P") return null;
	const msoList = styleMap(node).get("mso-list");
	if (msoList === undefined) return null;

	const seviye = /level(\d+)/.exec(msoList);
	const im = msoMarker(node);
	const imMetni = (im?.textContent ?? "").trim();

	// İmin kendisi `toInlines` içinde düşüyor (`mso-list:Ignore`); burada
	// yalnızca sıralı mı sırasız mı olduğu okunuyor.
	const children = trimInlines(collectInlines(childrenOf(node), o));

	return {
		level: seviye?.[1] === undefined ? 1 : Number(seviye[1]),
		ordered: SIRALI_IM.test(imMetni),
		children,
	};
}

/**
 * Düz madde listesini iç içe listelere çevirir.
 *
 * `level` numaraları bir yığınla okunuyor: numara artınca yeni bir iç liste
 * açılıyor, azalınca kapanıyor. Word atlamalı seviye üretebiliyor
 * (1 → 3); o durumda ara seviye açılmıyor, madde en yakın kaba giriyor.
 */
function wordList(items: readonly WordListItem[]): Block[] {
	if (items.length === 0) return [];

	const yeniListe = (ordered: boolean): List => ({
		type: "list",
		ordered,
		start: ordered ? 1 : null,
		spread: false,
		children: [],
	});

	const kok = yeniListe(items[0]?.ordered === true);
	/** Açık listeler, en dıştan içe. */
	const yigin: List[] = [kok];

	for (const item of items) {
		while (yigin.length > item.level && yigin.length > 1) yigin.pop();

		while (yigin.length < item.level) {
			const ust = yigin[yigin.length - 1] as List;
			const sonMadde = ust.children[ust.children.length - 1];
			const ic = yeniListe(item.ordered);
			// İç liste bir maddenin çocuğu olmak zorunda; üst listede madde
			// yoksa (atlamalı seviye) boş bir madde açılıyor.
			if (sonMadde === undefined) {
				ust.children.push({ type: "listItem", checked: null, spread: false, children: [ic] });
			} else {
				sonMadde.children.push(ic);
			}
			yigin.push(ic);
		}

		const hedef = yigin[yigin.length - 1] as List;
		hedef.children.push({
			type: "listItem",
			checked: null,
			spread: false,
			children: [{ type: "paragraph", children: item.children }],
		});
	}

	return [kok];
}
