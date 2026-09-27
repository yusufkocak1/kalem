/**
 * `@kalem-editor/plugin-source-mode` — Ham Markdown kipi  (İş listesi: F4-06)
 *
 * WYSIWYG ile kaynak metin arasında geçiş; kaynak tarafı sıradan bir
 * `<textarea>` (CodeMirror bağımlılığı **yok**).
 *
 *     import { sourceModePlugin } from "@kalem-editor/plugin-source-mode";
 *     import "@kalem-editor/themes/plugin-source.css";
 *
 *     const editor = new Editor(el, { plugins: [sourceModePlugin()] });
 *
 * Ctrl/Cmd+Shift+M kipi değiştiriyor, Escape geri dönüyor.
 *
 * @module @kalem-editor/plugin-source-mode
 */
export type { SourceLabels } from "./labels.js";
export { enSourceLabels, labelsFor, trSourceLabels } from "./labels.js";
export type { SourceModeOptions, SourceModePlugin } from "./plugin.js";
export { sourceModePlugin } from "./plugin.js";
export type { SourceView, SourceViewOptions } from "./view.js";
export { createSourceView } from "./view.js";
