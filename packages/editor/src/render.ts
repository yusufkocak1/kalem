/**
 * @kalem/editor — Model → DOM  (İş listesi: F2-05)
 *
 * ## Neden viewer'ı kullanmıyor
 *
 * `@kalem/viewer` salt okunur çıktı üretir: tek yönlü, kimliksiz, yamasız.
 * Editörün ihtiyacı farklı — her üst düzey blok kendi `contenteditable`
 * elemanı olmalı, her elemanın kimliği ve modeldeki karşılığına giden yolu
 * bilinmeli. Ortak bir soyutlama ikisini de bozardı; render mantığı ucuz,
 * yanlış soyutlama pahalı.
 *
 * ## `data-kalem-path`
 *
 * Satır içi içeriği tutan elemanlara, blok kökünden o düğüme giden yol
 * yazılıyor (`"0.1"`). Kullanıcı yazınca yalnızca o düğümün `children`'ı
 * DOM'dan yeniden okunuyor — blok yapısı modelden geliyor, satır içi
 * içerik DOM'dan. Bölünme sebebi IME: bileşim sırasında DOM'a karışmak
 * Japonca/Çince yazımı bozar, bu yüzden satır içinde tarayıcıya
 * güveniliyor.
 *
 * Bunun kazancı ayrıca `syntax` alanlarının korunması: blok düzeyi model
 * kaldığı için `*` mi `-` mi, ATX mi setext mi bilgisi düzenlemeden
 * etkilenmiyor.
 *
 * ## `innerHTML` yine yok
 *
 * Aynı gerekçe (analiz §5.6): metin hiçbir aşamada HTML olarak
 * ayrıştırılmıyor.
 */
import type { Block, Definition, Frontmatter, Inline, Root } from "@kalem/core";
import { sanitizeUrl } from "@kalem/core";

/**
 * Editörün "blok" saydığı şey: kökün doğrudan çocuğu.
 *
 * Frontmatter da buraya dâhil — kullanıcı onu da düzenleyebilmeli ve
 * ekranda görebilmeli. Görüntüleyici varsayılan olarak gizler, editör
 * gizleyemez: gizli içerik kaydedildiğinde kaybolmuş gibi durur.
 */
export type TopNode = Block | Frontmatter;

/** Blok kökünden bir düğüme giden yol; nokta ile ayrılmış indisler. */
export const PATH_ATTR = "data-kalem-path";
export const ID_ATTR = "data-kalem-id";
/** Kod bloğunun metin gövdesi — satır içi değil, düz metin. */
export const CODE_ATTR = "data-kalem-code";

export interface RenderContext {
	readonly document: Document;
	readonly prefix: string;
	readonly defs: ReadonlyMap<string, Definition>;
}

/** Belgedeki tüm bağlantı tanımlarını toplar. */
export function collectDefinitions(doc: Root): ReadonlyMap<string, Definition> {
	const defs = new Map<string, Definition>();
	for (const child of doc.children) {
		if (child.type === "definition" && !defs.has(child.identifier)) {
			defs.set(child.identifier, child);
		}
	}
	return defs;
}

/**
 * Bloğun kök DOM elemanını üretir.
 *
 * Sarmalayıcı `<div>` yok: bloğun kendi etiketi (`<p>`, `<ul>`, `<pre>`)
 * aynı zamanda blok elemanı. Her paragraf için fazladan bir `<div>`,
 * uzun belgede binlerce gereksiz düğüm ve tema CSS'inde fazladan bir
 * seviye demek olurdu.
 */
export function createBlockElement(block: TopNode, ctx: RenderContext): HTMLElement {
	const element = ctx.document.createElement(tagOf(block));
	element.setAttribute(ID_ATTR, block.id ?? "");
	fillBlock(element, block, ctx);
	return element;
}

/** Bloğun iç yapısını (yeniden) kurar. Eleman kimliği korunur. */
export function fillBlock(element: HTMLElement, block: TopNode, ctx: RenderContext): void {
	element.replaceChildren();
	element.className = `${ctx.prefix}block`;
	renderBody(element, block, [], ctx);
	applyEditability(element, block);
}

export function tagOf(block: TopNode): string {
	switch (block.type) {
		case "heading":
			return `h${block.depth}`;
		case "blockquote":
			return "blockquote";
		case "list":
			return block.ordered ? "ol" : "ul";
		case "code":
			return "pre";
		case "thematicBreak":
			return "hr";
		case "table":
			return "table";
		case "html":
		case "definition":
		case "yaml":
		case "toml":
			// Ham HTML, tanım ve frontmatter kaynak metni olarak düzenlenir:
			// yapıları modelde değil metinde. `<pre>` bunu doğru gösterir.
			return "pre";
		default:
			return "p";
	}
}

/**
 * Düzenlenebilirlik.
 *
 * `contenteditable` **blok başına** veriliyor, kapsayıcıya değil. İki
 * sebep: tarayıcının kendi düzenleme davranışı blok sınırında durur
 * (bloklar arası birleştirme bizim kontrolümüzde kalır), ve bloklar arası
 * seçim kendi modelimize düşer (F2-06).
 */
function applyEditability(element: HTMLElement, block: TopNode): void {
	if (block.type === "thematicBreak") {
		// İçi olmayan blok yazılamaz; blok olarak seçilir (F2-06).
		element.contentEditable = "false";
		return;
	}
	element.contentEditable = "true";
	// Kod ve ham HTML'de yazım denetimi gürültüden başka bir şey değil.
	const kod = KAYNAK_BLOKLARI.has(block.type);
	element.spellcheck = !kod;
	if (kod) element.setAttribute("translate", "no");
}

// ---------------------------------------------------------------------------
// Blok gövdesi
// ---------------------------------------------------------------------------

/** İçeriği yapı değil **kaynak metin** olan bloklar. */
const KAYNAK_BLOKLARI: ReadonlySet<string> = new Set([
	"code",
	"html",
	"definition",
	"yaml",
	"toml",
]);

function renderBody(
	target: HTMLElement,
	node: TopNode,
	path: readonly number[],
	ctx: RenderContext,
): void {
	switch (node.type) {
		case "paragraph":
		case "heading":
			markPath(target, path);
			renderInline(target, node.children, ctx);
			return;
		case "code": {
			const code = ctx.document.createElement("code");
			if (node.lang !== null && node.lang !== "") code.className = `language-${node.lang}`;
			code.setAttribute(CODE_ATTR, path.join("."));
			code.textContent = node.value;
			target.append(code);
			return;
		}
		case "html":
		case "yaml":
		case "toml":
		case "definition": {
			// Kaynak metin olarak gösteriliyor; `data-kalem-code` aynı işi görür.
			const code = ctx.document.createElement("code");
			code.setAttribute(CODE_ATTR, path.join("."));
			code.textContent = node.type === "definition" ? definitionText(node) : node.value;
			target.append(code);
			return;
		}
		case "thematicBreak":
			return;
		case "blockquote":
			renderChildren(target, node.children, path, ctx);
			return;
		case "list":
			renderListItems(target, node, path, ctx);
			return;
		case "table":
			renderTable(target, node, path, ctx);
			return;
	}
}

function definitionText(node: Definition): string {
	const title = node.title === null ? "" : ` "${node.title}"`;
	return `[${node.label}]: ${node.url}${title}`;
}

/** Alt blokları kendi etiketleriyle basar. */
function renderChildren(
	target: HTMLElement,
	children: readonly Block[],
	path: readonly number[],
	ctx: RenderContext,
): void {
	for (const [i, child] of children.entries()) {
		const element = ctx.document.createElement(tagOf(child));
		renderBody(element, child, [...path, i], ctx);
		target.append(element);
	}
}

function renderListItems(
	target: HTMLElement,
	list: Extract<Block, { type: "list" }>,
	path: readonly number[],
	ctx: RenderContext,
): void {
	if (list.ordered && list.start !== null && list.start !== 1) {
		target.setAttribute("start", String(list.start));
	}
	for (const [i, item] of list.children.entries()) {
		const li = ctx.document.createElement("li");
		const itemPath = [...path, i];

		if (item.checked !== null) {
			li.className = `${ctx.prefix}task`;
			const box = ctx.document.createElement("input");
			box.type = "checkbox";
			box.checked = item.checked;
			// Kutu düzenlenebilir alanın dışında: tıklanabilir olmalı ama
			// imleç içine girmemeli.
			box.contentEditable = "false";
			li.append(box, ctx.document.createTextNode(" "));
		}

		// Sıkı listede madde paragrafı `<p>` almaz — görüntüleyiciyle aynı
		// kural; aksi hâlde düzenlerken satır aralığı zıplardı.
		const loose = list.spread || item.spread;
		if (!loose && item.children.length === 1 && item.children[0]?.type === "paragraph") {
			renderBody(li, item.children[0], [...itemPath, 0], ctx);
		} else {
			renderChildren(li, item.children, itemPath, ctx);
		}
		target.append(li);
	}
}

function renderTable(
	target: HTMLElement,
	table: Extract<Block, { type: "table" }>,
	path: readonly number[],
	ctx: RenderContext,
): void {
	for (const [r, row] of table.children.entries()) {
		const tr = ctx.document.createElement("tr");
		for (const [c, cell] of row.children.entries()) {
			const td = ctx.document.createElement(r === 0 ? "th" : "td");
			const align = table.align[c];
			if (align !== undefined && align !== null) td.className = `${ctx.prefix}align-${align}`;
			markPath(td, [...path, r, c]);
			renderInline(td, cell.children, ctx);
			tr.append(td);
		}
		target.append(tr);
	}
}

function markPath(element: HTMLElement, path: readonly number[]): void {
	element.setAttribute(PATH_ATTR, path.join("."));
}

// ---------------------------------------------------------------------------
// Satır içi
// ---------------------------------------------------------------------------

/**
 * Satır içi düğümleri hedefin içine basar.
 *
 * İçerik boşsa tek bir `<br>` konuyor: boş bir `contenteditable` elemanın
 * yüksekliği sıfırdır, tıklanamaz ve imleç yerleştirilemez. Tarayıcıların
 * kendi çözümü de budur.
 */
export function renderInline(
	target: HTMLElement,
	nodes: readonly Inline[],
	ctx: RenderContext,
): void {
	if (nodes.length === 0) {
		target.append(ctx.document.createElement("br"));
		return;
	}
	for (const node of nodes) appendInline(target, node, ctx);

	// İçerik sert satır sonuyla bitiyorsa bir doldurucu `<br>` daha
	// gerekiyor. Tarayıcı, sondaki tek `<br>`yi "satır kutusunu ayakta tut"
	// doldurucusu sayıyor ve imleci onun **önüne** koyuyor; kullanıcı yeni
	// satıra yazdığını sanırken metin bir üst satıra gidiyordu.
	// `read.ts` buna karşılık **tek** bir sondaki satır sonunu atıyor.
	if (nodes[nodes.length - 1]?.type === "break") {
		target.append(ctx.document.createElement("br"));
	}
}

function appendInline(target: HTMLElement, node: Inline, ctx: RenderContext): void {
	const d = ctx.document;
	switch (node.type) {
		case "text":
			target.append(d.createTextNode(node.value));
			return;
		case "strong":
			target.append(wrap("strong", node.children, ctx));
			return;
		case "emphasis":
			target.append(wrap("em", node.children, ctx));
			return;
		case "delete":
			target.append(wrap("del", node.children, ctx));
			return;
		case "inlineCode": {
			const code = d.createElement("code");
			code.textContent = node.value;
			target.append(code);
			return;
		}
		case "break":
			target.append(d.createElement("br"));
			return;
		case "link": {
			const a = d.createElement("a");
			a.setAttribute("href", sanitizeUrl(node.url));
			if (node.title !== null) a.setAttribute("title", node.title);
			for (const child of node.children) appendInline(a, child, ctx);
			target.append(a);
			return;
		}
		case "image": {
			const img = d.createElement("img");
			img.setAttribute("src", sanitizeUrl(node.url, { image: true }));
			img.setAttribute("alt", node.alt ?? "");
			if (node.title !== null) img.setAttribute("title", node.title);
			target.append(img);
			return;
		}
		case "html":
			// Editörde ham HTML **metin olarak** düzenlenir: kullanıcı yazdığı
			// etiketi görmeli, etiketin sonucunu değil.
			target.append(d.createTextNode(node.value));
			return;
		case "linkReference":
		case "imageReference":
			appendReference(target, node, ctx);
			return;
	}
}

function wrap(tag: string, children: readonly Inline[], ctx: RenderContext): HTMLElement {
	const element = ctx.document.createElement(tag);
	for (const child of children) appendInline(element, child, ctx);
	return element;
}

function appendReference(
	target: HTMLElement,
	node: Extract<Inline, { type: "linkReference" | "imageReference" }>,
	ctx: RenderContext,
): void {
	const def = ctx.defs.get(node.identifier);
	const d = ctx.document;

	if (def === undefined) {
		// Tanımsız referans düz metne döner (CommonMark) — kullanıcı eksik
		// tanımı ekranda görsün.
		target.append(d.createTextNode(referenceText(node)));
		return;
	}
	if (node.type === "imageReference") {
		const img = d.createElement("img");
		img.setAttribute("src", sanitizeUrl(def.url, { image: true }));
		img.setAttribute("alt", node.alt ?? "");
		target.append(img);
		return;
	}
	const a = d.createElement("a");
	a.setAttribute("href", sanitizeUrl(def.url));
	for (const child of node.children) appendInline(a, child, ctx);
	target.append(a);
}

function referenceText(
	node: Extract<Inline, { type: "linkReference" | "imageReference" }>,
): string {
	const type = node.syntax?.referenceType ?? "shortcut";
	const inner = node.type === "imageReference" ? (node.alt ?? node.label) : node.label;
	const head = node.type === "imageReference" ? `![${inner}]` : `[${inner}]`;
	if (type === "collapsed") return `${head}[]`;
	if (type === "full") return `${head}[${node.label}]`;
	return head;
}
