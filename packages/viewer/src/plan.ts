/**
 * @kalem/viewer — Render planı (AST → element tarifi)  (İş listesi: F2-01, F2-02)
 *
 * ## Neden araya bir katman giriyor
 *
 * İki render hedefi var: `renderToDOM` (tarayıcı) ve `renderToString` (SSR).
 * İş listesi F2-02'nin kabul kriteri ikisinin **aynı çıktıyı** üretmesini
 * şart koşuyor. Bunu iki ayrı gövde yazıp "aynı olsun" diye ummak yerine,
 * karar veren tek bir saf fonksiyon var: bu dosya. İki hedef de yalnızca
 * çeviri yapar.
 *
 * Sonuç, testlerde ölçülebilir bir eşitlik: `renderToString(ast)` çıktısı,
 * `renderToDOM` ile kurulan kapsayıcının `innerHTML`'ine **byte-birebir**
 * eşit. Bu SSR hidrasyonu için de gereken şeyin ta kendisi.
 *
 * ## Bu dosya DOM'a dokunmaz
 *
 * `document` yok, `Element` yok. Node'da, worker'da, sunucuda çalışır.
 * Kaçışlama da burada **yapılmaz** — metin ham hâliyle taşınır, kaçışlamayı
 * string hedefi yapar, DOM hedefi ise `textContent` ile hiç yapmaz. Planın
 * içinde kaçışlanmış metin taşımak, iki hedefin çıktısını ayırırdı.
 */
import type { Block, Definition, Frontmatter, HtmlPolicy, Inline, Node, Root } from "@kalem/core";
import { sanitizeUrl } from "@kalem/core";

// ---------------------------------------------------------------------------
// Plan düğümleri
// ---------------------------------------------------------------------------

/** Bir HTML elemanı tarifi. */
export interface RenderElement {
	readonly kind: "element";
	readonly tag: string;
	/**
	 * Öznitelikler **sıralı** tutuluyor, nesne olarak değil.
	 *
	 * Tarayıcı `innerHTML` üretirken öznitelikleri eklenme sırasına göre
	 * yazar. String hedefiyle byte-birebir eşitlik ancak sıra korunursa
	 * mümkün; `Record` bunu garanti etmez.
	 */
	readonly attrs: readonly (readonly [string, string])[];
	readonly children: readonly RenderNode[];
}

/** Düz metin. Kaçışlama hedefe bırakılır. */
export interface RenderText {
	readonly kind: "text";
	readonly value: string;
}

/**
 * Ham HTML. Yalnızca `html: "allow"` politikasıyla üretilir.
 *
 * `renderToString` bunu olduğu gibi basar. `renderToDOM` **basamaz**:
 * kütüphanede `innerHTML` kullanılmıyor (analiz §5.6). Orada
 * `renderRawHtml` kancası yoksa metne düşer.
 */
export interface RenderRaw {
	readonly kind: "raw";
	readonly value: string;
}

export type RenderNode = RenderElement | RenderText | RenderRaw;

/**
 * İçeriği olmayan (void) etiketler.
 *
 * String hedefi bunlara kapanış etiketi yazmaz; HTML5 sözdizimi `<br>`,
 * `<br/>` değil — tarayıcının `innerHTML` çıktısı da böyle.
 */
export const VOID_TAGS: ReadonlySet<string> = new Set(["br", "hr", "img", "input", "wbr", "col"]);

// ---------------------------------------------------------------------------
// Seçenekler
// ---------------------------------------------------------------------------

export interface ViewerOptions {
	/** Ham HTML düğümlerine ne yapılacağı (varsayılan `"escape"`). */
	html?: HtmlPolicy;
	/** `html: "allow"` seçildiğinde HTML'i temizleme kancası. */
	sanitizeHtml?: (html: string) => string;
	/**
	 * CSS sınıf öneki (varsayılan `"kalem-"`).
	 *
	 * Sınıf yalnızca etiketin kendisinin anlatmadığı yerlerde veriliyor:
	 * görev listesi, hücre hizalaması, kod dili. "Her elemana bir sınıf"
	 * yaklaşımı hem boyut hem gürültü demek.
	 */
	classPrefix?: string;
	/** Frontmatter (`---` bloğu) gösterilsin mi (varsayılan `false`). */
	frontmatter?: boolean;
}

interface Resolved {
	readonly html: HtmlPolicy;
	readonly sanitizeHtml: ((html: string) => string) | undefined;
	readonly prefix: string;
	readonly frontmatter: boolean;
}

interface Ctx {
	readonly o: Resolved;
	readonly defs: ReadonlyMap<string, Definition>;
}

function resolve(options: ViewerOptions): Resolved {
	return {
		html: options.html ?? "escape",
		sanitizeHtml: options.sanitizeHtml,
		prefix: options.classPrefix ?? "kalem-",
		frontmatter: options.frontmatter ?? false,
	};
}

// ---------------------------------------------------------------------------
// Kısa yapıcılar
// ---------------------------------------------------------------------------

function el(
	tag: string,
	attrs: readonly (readonly [string, string])[],
	children: readonly RenderNode[],
): RenderElement {
	return { kind: "element", tag, attrs, children };
}

function txt(value: string): RenderText {
	return { kind: "text", value };
}

/** Sarmalayıcısız eleman — en sık hâl. */
function wrap(tag: string, children: readonly RenderNode[]): RenderElement {
	return el(tag, [], children);
}

// ---------------------------------------------------------------------------
// Tanım (link definition) toplama
// ---------------------------------------------------------------------------

/**
 * Ağaçtaki tüm `definition` düğümlerini kimliklerine göre toplar.
 *
 * `walk` yerine elle iniyoruz: `@kalem/core`'un `walk`'ı ziyaretçi
 * arayüzü kuruyor ve viewer'ın tek ihtiyacı düz bir tarama. 14 kB'lık
 * bütçede bu fark ölçülür.
 *
 * CommonMark'a göre **ilk** tanım kazanır; sonrakiler yok sayılır.
 */
function collectDefinitions(root: Root): ReadonlyMap<string, Definition> {
	const defs = new Map<string, Definition>();
	const stack: Node[] = [root];
	while (stack.length > 0) {
		const node = stack.pop() as Node;
		if (node.type === "definition") {
			if (!defs.has(node.identifier)) defs.set(node.identifier, node);
			continue;
		}
		const children = (node as { children?: readonly Node[] }).children;
		if (children !== undefined) {
			for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as Node);
		}
	}
	return defs;
}

// ---------------------------------------------------------------------------
// Bloklar
// ---------------------------------------------------------------------------

/** AST kökünü render planına çevirir. */
export function buildPlan(root: Root, options: ViewerOptions = {}): readonly RenderNode[] {
	const ctx: Ctx = { o: resolve(options), defs: collectDefinitions(root) };
	return blocks(root.children, ctx);
}

function blocks(list: readonly (Block | Frontmatter)[], ctx: Ctx): RenderNode[] {
	const out: RenderNode[] = [];
	for (const node of list) {
		const rendered = block(node, ctx);
		if (rendered !== null) out.push(rendered);
	}
	return out;
}

function block(node: Block | Frontmatter, ctx: Ctx): RenderNode | null {
	switch (node.type) {
		case "paragraph":
			return wrap("p", inlines(node.children, ctx));
		case "heading":
			return wrap(`h${node.depth}`, inlines(node.children, ctx));
		case "blockquote":
			return wrap("blockquote", blocks(node.children, ctx));
		case "thematicBreak":
			return el("hr", [], []);
		case "code":
			return codeBlock(node.lang, node.value);
		case "list":
			return listBlock(node, ctx);
		case "table":
			return tableBlock(node, ctx);
		case "html":
			return rawHtml(node.value, ctx);
		case "definition":
			// Tanımlar görünmez: yalnızca referansları çözmeye yarar.
			return null;
		case "yaml":
		case "toml":
			return ctx.o.frontmatter ? codeBlock(node.type, node.value) : null;
		default:
			// Bilinmeyen blok tipi sessizce atlanır: ileride eklenecek bir
			// düğüm (dipnot, matematik) viewer'ı patlatmamalı.
			return null;
	}
}

function codeBlock(lang: string | null, value: string): RenderElement {
	// `language-` öneki Prism/highlight.js sözleşmesi; F4-02 buna bağlanacak.
	// Sınıf öneki burada bilerek kullanılmıyor — bu isim ekosistemin.
	const attrs: (readonly [string, string])[] =
		lang === null || lang === "" ? [] : [["class", `language-${lang}`] as const];
	// Sondaki satır sonu geleneksel: `<pre>` içinde son satır görünür olsun.
	const body = value === "" || value.endsWith("\n") ? value : `${value}\n`;
	return wrap("pre", [el("code", attrs, [txt(body)])]);
}

function listBlock(node: Extract<Block, { type: "list" }>, ctx: Ctx): RenderElement {
	const attrs: (readonly [string, string])[] = [];
	if (node.ordered && node.start !== null && node.start !== 1) {
		attrs.push(["start", String(node.start)]);
	}
	const items = node.children.map((item) => listItem(item, node.spread, ctx));
	return el(node.ordered ? "ol" : "ul", attrs, items);
}

function listItem(
	item: Extract<Block, { type: "list" }>["children"][number],
	listSpread: boolean,
	ctx: Ctx,
): RenderElement {
	// CommonMark: sıkı (tight) listede madde paragrafları `<p>` almaz.
	// Gevşeklik ya listenin ya da maddenin kendisinden gelir.
	const loose = listSpread || item.spread;
	const children: RenderNode[] = [];

	if (item.checked !== null) {
		const attrs: (readonly [string, string])[] = [["type", "checkbox"]];
		// Boole öznitelikleri `checked=""` olarak yazılıyor: tarayıcının
		// `innerHTML` çıktısı da böyle, string hedefiyle eşitlik korunuyor.
		if (item.checked) attrs.push(["checked", ""]);
		attrs.push(["disabled", ""]);
		children.push(el("input", attrs, []));
		children.push(txt(" "));
	}

	for (const child of item.children) {
		if (!loose && child.type === "paragraph") {
			children.push(...inlines(child.children, ctx));
			continue;
		}
		const rendered = block(child, ctx);
		if (rendered !== null) children.push(rendered);
	}

	const attrs: (readonly [string, string])[] =
		item.checked === null ? [] : [["class", `${ctx.o.prefix}task`]];
	return el("li", attrs, children);
}

function tableBlock(node: Extract<Block, { type: "table" }>, ctx: Ctx): RenderElement {
	const [head, ...body] = node.children;
	const sections: RenderNode[] = [];
	if (head !== undefined) {
		sections.push(wrap("thead", [tableRow(head, node.align, "th", ctx)]));
	}
	if (body.length > 0) {
		sections.push(
			wrap(
				"tbody",
				body.map((row) => tableRow(row, node.align, "td", ctx)),
			),
		);
	}
	return wrap("table", sections);
}

function tableRow(
	row: Extract<Block, { type: "table" }>["children"][number],
	align: readonly (string | null)[],
	cellTag: "th" | "td",
	ctx: Ctx,
): RenderElement {
	const cells = row.children.map((cell, i) => {
		const a = align[i];
		// Hizalama satır içi `style` yerine sınıfla veriliyor: `style-src`
		// kısıtlayan CSP'lerde satır içi stil engellenir, sınıf engellenmez.
		const attrs: (readonly [string, string])[] =
			a === undefined || a === null ? [] : [[`class`, `${ctx.o.prefix}align-${a}`] as const];
		return el(cellTag, attrs, inlines(cell.children, ctx));
	});
	return wrap("tr", cells);
}

/**
 * Ham HTML düğümünü politikaya göre çevirir.
 *
 * `@kalem/core`'un `applyHtmlPolicy`'si burada **kasten** kullanılmıyor:
 * o fonksiyon `escape` politikasında metni önceden kaçışlar. Plan
 * kaçışlanmış metin taşırsa DOM hedefi onu `textContent` ile basıp
 * `&lt;b&gt;` gösterir — iki hedef ayrışır. Politika kararı aynı, uygulama
 * yeri farklı.
 */
function rawHtml(value: string, ctx: Ctx): RenderNode | null {
	if (ctx.o.html === "strip") return null;
	if (ctx.o.html === "escape") return txt(value);
	const cleaned = ctx.o.sanitizeHtml?.(value) ?? value;
	return { kind: "raw", value: cleaned };
}

// ---------------------------------------------------------------------------
// Satır içi
// ---------------------------------------------------------------------------

function inlines(list: readonly Inline[], ctx: Ctx): RenderNode[] {
	const out: RenderNode[] = [];
	for (const node of list) inline(node, out, ctx);
	return out;
}

function inline(node: Inline, out: RenderNode[], ctx: Ctx): void {
	switch (node.type) {
		case "text":
			out.push(txt(node.value));
			return;
		case "emphasis":
			out.push(wrap("em", inlines(node.children, ctx)));
			return;
		case "strong":
			out.push(wrap("strong", inlines(node.children, ctx)));
			return;
		case "delete":
			out.push(wrap("del", inlines(node.children, ctx)));
			return;
		case "inlineCode":
			out.push(wrap("code", [txt(node.value)]));
			return;
		case "break":
			out.push(el("br", [], []));
			return;
		case "link":
			out.push(el("a", linkAttrs(node.url, node.title, false), inlines(node.children, ctx)));
			return;
		case "image":
			out.push(el("img", imageAttrs(node.url, node.alt, node.title), []));
			return;
		case "linkReference":
		case "imageReference":
			reference(node, out, ctx);
			return;
		case "html": {
			const rendered = rawHtml(node.value, ctx);
			if (rendered !== null) out.push(rendered);
			return;
		}
		default:
			return;
	}
}

function linkAttrs(
	url: string,
	title: string | null,
	image: boolean,
): (readonly [string, string])[] {
	const attrs: (readonly [string, string])[] = [
		[image ? "src" : "href", sanitizeUrl(url, image ? { image: true } : {})],
	];
	if (title !== null) attrs.push(["title", title]);
	return attrs;
}

function imageAttrs(
	url: string,
	alt: string | null,
	title: string | null,
): (readonly [string, string])[] {
	// Sıra `src`, `alt`, `title`: `alt` her zaman yazılıyor (boş olsa bile),
	// çünkü `alt`'sız görsel ekran okuyucuda dosya adını okur.
	const attrs: (readonly [string, string])[] = [
		["src", sanitizeUrl(url, { image: true })],
		["alt", alt ?? ""],
	];
	if (title !== null) attrs.push(["title", title]);
	return attrs;
}

/**
 * Referanslı bağlantı/görseli çözer.
 *
 * Tanım bulunamazsa CommonMark davranışı: düğüm **düz metne döner**.
 * Sessizce kaybolmaz, boş bağlantıya da dönmez — kullanıcı yazdığı şeyi
 * ekranda görür ve eksik tanımı fark eder.
 */
function reference(
	node: Extract<Inline, { type: "linkReference" | "imageReference" }>,
	out: RenderNode[],
	ctx: Ctx,
): void {
	const def = ctx.defs.get(node.identifier);
	const image = node.type === "imageReference";

	if (def !== undefined) {
		if (image) {
			out.push(el("img", imageAttrs(def.url, node.alt, def.title), []));
		} else {
			out.push(el("a", linkAttrs(def.url, def.title, false), inlines(node.children, ctx)));
		}
		return;
	}

	const type = node.syntax?.referenceType ?? "shortcut";
	out.push(txt(image ? `![${node.alt ?? node.label}]` : "["));
	if (!image) {
		out.push(...inlines(node.children, ctx));
		out.push(txt("]"));
	}
	if (type === "collapsed") out.push(txt("[]"));
	else if (type === "full") out.push(txt(`[${node.label}]`));
}
