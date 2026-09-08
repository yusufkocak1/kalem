/**
 * @kalem/core/html — HTML → AST dönüştürücü  (İş listesi: F1-09)
 *
 * Yapıştırma normalleştirmesinin beyni. Word, Google Docs, Excel, Notion ve
 * genel web HTML'ini AST'ye çevirir.
 *
 * ## Neden ayrı giriş noktası
 *
 * `@kalem/core/html` olarak yayımlanıyor. Yalnızca Markdown işleyen bir
 * kullanıcı bu kodu indirmemeli; yapıştırma bir **editör** ihtiyacı (F3-07
 * boru hattı bunu kullanacak). Analiz §5.3 bunu zaten öngörmüştü.
 *
 * ## Neden DOM tipleri yok
 *
 * `@kalem/core` sunucuda da çalışmak zorunda ve saflık kapısı DOM globallerini
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
 */
import type { Block, Inline, Root } from "./ast.js";
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

	const flush = (): void => {
		const trimmed = trimInlines(pending);
		if (trimmed.length > 0) out.push({ type: "paragraph", children: trimmed });
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

		const block = toBlock(node, tag, o);
		if (block !== null) {
			flush();
			out.push(...block);
			continue;
		}
		pending.push(...toInlines(node, o));
	}

	flush();
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
				children: trimInlines(collectInlines(childrenOf(cell), o)),
			})),
	}));

	const columns = children[0]?.children.length ?? 0;
	return { type: "table", align: Array.from({ length: columns }, () => null), children };
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

	return applyMarks(children, dedupe(marks));
}

/** Biçimleri iç içe sarar. */
function applyMarks(children: Inline[], marks: readonly string[]): Inline[] {
	if (children.length === 0) return [];
	let out = children;
	for (const mark of marks) {
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
