/**
 * @kalem/editor — Başsız blok editör motoru
 *
 * "Başsız" (headless) burada gerçek anlamıyla: bu paket **hiçbir arayüz
 * çizmez**. Araç çubuğu, balon menü, slash menüsü — hepsi `@kalem/ui`
 * (Faz 3). Buradaki iş, düzenlemenin kendisi: model, DOM eşlemesi, seçim,
 * klavye, geçmiş.
 *
 * Ayrımın sebebi analiz §5.3: arayüzü olmayan bir editör, kendi tasarım
 * sistemi olan bir uygulamaya gömülebilir. Arayüz gömülü olsaydı ya
 * uygulamanın tasarımına yabancı kalırdı ya da ezilmek zorunda kalırdı.
 */
export type { EditorOptions } from "./editor.js";
export { Editor } from "./editor.js";
export { assignIds, newId } from "./ids.js";
export {
	applyLink,
	applyMark,
	inlineLength,
	listLength,
	markActive,
	sliceInline,
	spliceInline,
} from "./inline-edit.js";
export type { DomPoint } from "./offsets.js";
export { contentLength, offsetOf, pointAt, selectRange } from "./offsets.js";
export { normalizeInline, readCode, readInline } from "./read.js";
export type { TopNode } from "./render.js";
export { CODE_ATTR, ID_ATTR, PATH_ATTR } from "./render.js";
export type { BlockSelection, EditorSelection, TextSelection } from "./selection.js";
export { placeCaret, readSelection, selectedRange } from "./selection.js";
