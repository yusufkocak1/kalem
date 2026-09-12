/**
 * @kalem/viewer — AST → DOM / HTML metni
 *
 * Salt okunur görüntüleyici. İki hedefi var ve ikisi de **aynı** render
 * planından beslenir (bkz. `plan.ts`), dolayısıyla aynı çıktıyı verir:
 *
 * - `renderToDOM(ast, el)` — tarayıcı. `innerHTML` kullanılmaz.
 * - `renderToString(ast)`  — SSR. Saf fonksiyon, DOM gerektirmez.
 *
 * Editör (`@kalem/editor`) bu paketi kullanmaz; kendi artımlı DOM yamasını
 * uygular. Viewer'ın işi, düzenlenmeyen içeriği ucuza göstermek.
 *
 * @module @kalem/viewer
 */
export type { RenderToDomOptions } from "./dom.js";
export { renderToDOM } from "./dom.js";
export type {
	RenderElement,
	RenderNode,
	RenderRaw,
	RenderText,
	ViewerOptions,
} from "./plan.js";
export { buildPlan, VOID_TAGS } from "./plan.js";
export { escapeAttribute, escapeText, renderToString, stringifyPlan } from "./string.js";
