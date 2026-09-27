/**
 * @kalem-editor/viewer — `renderToString`  (İş listesi: F2-02)
 *
 * Saf fonksiyon: DOM yok, global yok. Node'da, Deno'da, worker'da,
 * edge runtime'da aynı çıktıyı verir.
 *
 * ## Kaçışlama neden `escapeHtml` değil
 *
 * `@kalem-editor/core`'un `escapeHtml`'i beş karakteri de kaçışlar (`&<>"'`) —
 * bilinmeyen bir bağlama metin gömerken doğru olan davranış budur.
 * Burada bağlam biliniyor ve hedef farklı: çıktı, `renderToDOM`'un ürettiği
 * ağacın `innerHTML`'iyle **byte-birebir** eşleşmeli. Tarayıcı HTML
 * serileştirme algoritması (HTML Standard §13.3) metinde yalnızca
 * `&`, `<`, `>`, U+00A0'yı; öznitelikte yalnızca `&`, `"`, U+00A0'yı
 * kaçışlar. Fazladan kaçışlamak çıktıyı bozmaz ama eşitliği bozar —
 * ve o eşitlik SSR hidrasyonunun tam olarak ihtiyaç duyduğu şey.
 *
 * Güvenlik kaybı yok: öznitelikler her zaman çift tırnakla yazılıyor,
 * dolayısıyla `'` kaçışlamaya gerek kalmıyor; `<` ve `>` öznitelik
 * değerinde ayrıştırıcıyı etkilemez.
 */
import type { Root } from "@kalem-editor/core";
import type { RenderElement, RenderNode, ViewerOptions } from "./plan.js";
import { buildPlan, VOID_TAGS } from "./plan.js";

// Bölünmez boşluk kod noktasıyla yazılıyor, çıplak karakterle değil:
// kaynakta U+00A0 normal boşluktan ayırt edilemez ve gözden kaçan bir
// düzenleme "her boşluğu kaçışla" hâline getirebilir.
const NBSP = String.fromCharCode(0xa0);

/** Metin bağlamı kaçışlaması (HTML Standard §13.3). */
export function escapeText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replaceAll(NBSP, "&nbsp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** Öznitelik değeri kaçışlaması (HTML Standard §13.3). */
export function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replaceAll(NBSP, "&nbsp;").replace(/"/g, "&quot;");
}

function element(node: RenderElement): string {
	let out = `<${node.tag}`;
	for (const [name, value] of node.attrs) out += ` ${name}="${escapeAttribute(value)}"`;
	out += ">";
	if (VOID_TAGS.has(node.tag)) return out;
	for (const child of node.children) out += stringifyNode(child);
	return `${out}</${node.tag}>`;
}

function stringifyNode(node: RenderNode): string {
	if (node.kind === "text") return escapeText(node.value);
	if (node.kind === "raw") return node.value;
	return element(node);
}

/** Render planını HTML metnine çevirir. */
export function stringifyPlan(plan: readonly RenderNode[]): string {
	let out = "";
	for (const node of plan) out += stringifyNode(node);
	return out;
}

/**
 * AST'yi HTML metnine çevirir.
 *
 * Çıktı **sarmalayıcısızdır**: kök elemanı çağıran seçer. `renderToDOM`
 * ile eşitlik de böyle tanımlı — çıktı, o fonksiyonun doldurduğu
 * kapsayıcının `innerHTML`'idir.
 */
export function renderToString(ast: Root, options: ViewerOptions = {}): string {
	return stringifyPlan(buildPlan(ast, options));
}
