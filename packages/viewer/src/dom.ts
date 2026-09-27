/**
 * @kalem-editor/viewer — `renderToDOM`  (İş listesi: F2-01)
 *
 * ## `innerHTML` bu dosyada geçmiyor
 *
 * Ve geçmeyecek. Ağaç `createElement` + `setAttribute` + `textContent` ile
 * kuruluyor. Bunun bedeli birkaç satır fazla kod; karşılığı, XSS yüzeyinin
 * **yapısal** olarak yok olması: metin hiçbir aşamada HTML olarak
 * ayrıştırılmadığı için `<img onerror=...>` bir string kalır (analiz §5.6).
 * DOMPurify'ın (~9 kB) gereksiz kalmasının sebebi de bu.
 *
 * Tek istisna `html: "allow"` politikası — ki orada da bu dosya HTML
 * ayrıştırmaz, işi `renderRawHtml` kancasıyla çağırana devreder.
 */
import type { Root } from "@kalem-editor/core";
import type { RenderElement, RenderNode, ViewerOptions } from "./plan.js";
import { buildPlan } from "./plan.js";

export interface RenderToDomOptions extends ViewerOptions {
	/**
	 * `html: "allow"` politikasında ham HTML'i düğüme çevirme kancası.
	 *
	 * Kütüphane HTML ayrıştırmadığı için bu iş çağırana ait. Kanca yoksa
	 * ham HTML **metin olarak** basılır: sessizce kaybolmaktansa görünür
	 * ve zararsız olması tercih edildi.
	 */
	renderRawHtml?: (html: string) => globalThis.Node | null;
	/**
	 * Kapsayıcıya eklenecek sınıf (varsayılan `<önek>doc`).
	 *
	 * `false` verilerek kapatılabilir: kapsayıcı çağıranın elemanı, sınıf
	 * eklemek onun düzenine karışmak demek.
	 */
	containerClass?: string | false;
}

/** Tek bir plan düğümünü DOM düğümüne çevirir. */
function toNode(
	node: RenderNode,
	doc: Document,
	options: RenderToDomOptions,
): globalThis.Node | null {
	if (node.kind === "text") return doc.createTextNode(node.value);
	if (node.kind === "raw") {
		return options.renderRawHtml?.(node.value) ?? doc.createTextNode(node.value);
	}
	return toElement(node, doc, options);
}

function toElement(node: RenderElement, doc: Document, options: RenderToDomOptions): Element {
	const element = doc.createElement(node.tag);
	for (const [name, value] of node.attrs) element.setAttribute(name, value);
	appendAll(element, node.children, doc, options);
	return element;
}

function appendAll(
	parent: globalThis.Node,
	children: readonly RenderNode[],
	doc: Document,
	options: RenderToDomOptions,
): void {
	for (const child of children) {
		const built = toNode(child, doc, options);
		if (built !== null) parent.appendChild(built);
	}
}

/**
 * AST'yi verilen elemanın içine render eder.
 *
 * Eleman **tamamen boşaltılır**; bu salt-okunur bir görüntüleyici, artımlı
 * yama editörün işi (F2-05).
 *
 * `document` elemanın kendi belgesinden okunuyor, global `document`'tan
 * değil: iframe, `<template>` içeriği ve `DOMImplementation` ile kurulmuş
 * belgeler böyle çalışır. Global'e bağlanmak bunları sessizce bozar.
 */
export function renderToDOM(ast: Root, target: Element, options: RenderToDomOptions = {}): void {
	const doc = target.ownerDocument;
	target.replaceChildren();

	const containerClass = options.containerClass ?? `${options.classPrefix ?? "kalem-"}doc`;
	if (containerClass !== false) target.classList.add(containerClass);

	appendAll(target, buildPlan(ast, options), doc, options);
}
