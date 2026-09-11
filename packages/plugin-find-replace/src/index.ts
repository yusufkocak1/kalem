/**
 * `@kalem/plugin-find-replace` — Bul ve değiştir  (İş listesi: F4-03)
 *
 * Ctrl+F ile arama, Ctrl+H ile değiştirme. Arama **modelde** yapılıyor:
 * tarayıcının kendi araması ekrandaki metni bulur, bulduğunu değiştiremez
 * ve Türkçe kasa katlamasını bilmez.
 *
 *     import { findReplacePlugin } from "@kalem/plugin-find-replace";
 *     import "@kalem/themes/plugin-find.css";
 *
 *     const editor = new Editor(el, { plugins: [findReplacePlugin()] });
 *
 * Kasa katlaması belgenin `lang`'ine göre: `lang="tr"` iken `ışık` araması
 * `IŞIK`ı buluyor, `İŞİK`i bulmuyor.
 *
 * Saf katman (`createIndex`, `findMatches`, `replaceAll`) ayrıca
 * dışa açık: editörsüz bir betikte de aynı arama yapılabiliyor.
 */
export type { FoldedText } from "./fold.js";
export { atWordBoundary, foldCase, isWordChar } from "./fold.js";
export type { FindLabels } from "./labels.js";
export { enFindLabels, labelsFor, trFindLabels } from "./labels.js";
export type { FindReplaceOptions, FindReplacePlugin } from "./plugin.js";
export { findReplacePlugin } from "./plugin.js";
export type { Region } from "./regions.js";
export { caretAt, regionsOf, replaceInRegion } from "./regions.js";
export { replaceAll, replaceOne } from "./replace.js";
export type { Match, SearchIndex, SearchOptions } from "./search.js";
export { createIndex, findMatches, nextFrom, previousFrom } from "./search.js";
