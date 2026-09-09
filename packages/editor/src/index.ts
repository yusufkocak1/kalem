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

export type { Caret, EditResult } from "./block-edit.js";
export {
	deleteBlocks,
	duplicateBlocks,
	indentItem,
	insertBreak,
	mergeWithNext,
	mergeWithPrevious,
	moveBlocks,
	newParagraph,
	normalizeDocument,
	nudgeBlock,
	outdentItem,
	splitAtCaret,
	toggleList,
} from "./block-edit.js";
export type { ClipboardPayload } from "./clipboard.js";
export { blocksPayload, inlinePayload } from "./clipboard.js";
export type { EditorEvent, EditorOptions } from "./editor.js";
export { Editor } from "./editor.js";
export type { HistoryState } from "./history.js";
export { History } from "./history.js";
export { assignIds, newId } from "./ids.js";
export {
	applyLink,
	applyMark,
	inlineLength,
	linkAt,
	listLength,
	markActive,
	sliceInline,
	spliceInline,
} from "./inline-edit.js";
export { applyBlockRule, applyInlineRule, plainInline } from "./input-rules.js";
export type { DomPoint } from "./offsets.js";
export { contentLength, offsetOf, pointAt, selectRange } from "./offsets.js";
export type { Plugin, PluginContext, PluginInputRule, PluginKeyHandler } from "./plugin.js";
export { PluginRegistry } from "./plugin.js";
export { defaultPlugins, inputRulesPlugin, taskListPlugin } from "./plugins-builtin.js";
export { normalizeInline, readCode, readInline } from "./read.js";
export type { TopNode } from "./render.js";
export { CODE_ATTR, ID_ATTR, PATH_ATTR } from "./render.js";
export type { BlockSelection, EditorSelection, TextSelection } from "./selection.js";
export { placeCaret, readSelection, selectedRange } from "./selection.js";
