/**
 * `@kalem-editor/plugin-outline` — İçindekiler  (İş listesi: F4-04)
 *
 * Başlık listesi, tıklayarak atlama ve etkin başlık takibi.
 *
 *     import { outlinePlugin } from "@kalem-editor/plugin-outline";
 *     import "@kalem-editor/themes/plugin-outline.css";
 *
 *     const editor = new Editor(el, {
 *       plugins: [outlinePlugin({ container: document.getElementById("yan") })],
 *     });
 *
 * Kapsayıcı verilmezse arayüz çizilmiyor ama liste API'den okunabiliyor —
 * kendi kenar çubuğunu çizen uygulamalar için.
 *
 * `outlineOf` ayrıca saf: editörsüz bir betikte de içindekiler
 * üretilebiliyor.
 *
 * @module @kalem-editor/plugin-outline
 */
export type { OutlineLabels } from "./labels.js";
export { enOutlineLabels, labelsFor, trOutlineLabels } from "./labels.js";
export type { OutlineItem } from "./outline.js";
export { outlineOf, sameOutline } from "./outline.js";
export type { OutlinePanel, OutlinePanelOptions } from "./panel.js";
export { createOutlinePanel } from "./panel.js";
export type { OutlineOptions, OutlinePlugin } from "./plugin.js";
export { outlinePlugin } from "./plugin.js";
