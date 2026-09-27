/**
 * `@kalem-editor/plugin-word-count` — Kelime sayacı  (İş listesi: F4-05)
 *
 * Kelime, karakter ve okuma süresi.
 *
 *     import { wordCountPlugin } from "@kalem-editor/plugin-word-count";
 *     import "@kalem-editor/themes/plugin-word-count.css";
 *
 *     const editor = new Editor(el, {
 *       plugins: [wordCountPlugin({ container: document.getElementById("durum") })],
 *     });
 *
 * Kelime sınırı `Intl.Segmenter`dan geliyor: Japonca bir belgede de doğru
 * sayıyor, ek bir byte indirmeden.
 *
 * Saf katman (`textOf`, `countText`) ayrıca dışa açık: bir derleme
 * betiğinde de aynı sayılar üretilebiliyor.
 *
 * @module @kalem-editor/plugin-word-count
 */
export type { CountOptions, Counts } from "./count.js";
export { countText, countWords } from "./count.js";
export type { WordCountLabels } from "./labels.js";
export { enWordCountLabels, labelsFor, trWordCountLabels } from "./labels.js";
export type { WordCountOptions, WordCountPlugin } from "./plugin.js";
export { wordCountPlugin } from "./plugin.js";
export type { StatusBar, StatusBarOptions } from "./status.js";
export { createStatusBar } from "./status.js";
export type { TextOptions } from "./text.js";
export { textOf } from "./text.js";
