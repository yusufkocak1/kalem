/**
 * `@kalem-editor/wc` — `<kalem-editor>` Custom Element  (İş listesi: F5-03)
 *
 *     import { defineKalemEditor } from "@kalem-editor/wc";
 *     defineKalemEditor();
 *
 *     <kalem-editor label="Belge" name="icerik">
 *       # Merhaba
 *     </kalem-editor>
 *
 * Ya da tek satırda: `import "@kalem-editor/wc/define";`
 *
 * Çerçeve gerekmiyor. Svelte, Angular, Astro, Rails, düz HTML — hepsi
 * aynı etiketi kullanıyor, çünkü kaydeden şey tarayıcının kendisi.
 *
 * `@kalem-editor/themes/editor.css` yüklenmeli: eleman varsayılan olarak
 * `display: inline` ve tipografi oradan geliyor.
 *
 * @module @kalem-editor/wc
 */

export { defineKalemEditor } from "./define.js";
export type { KalemEditorConstructor, KalemEditorElement } from "./element.js";
export { kalemEditorElement } from "./element.js";
export type { WcLabels } from "./labels.js";
export { enWcLabels, labelsFor, trWcLabels } from "./labels.js";

import type { KalemEditorElement } from "./element.js";

declare global {
	interface HTMLElementTagNameMap {
		/**
		 * Varsayılan etiket adı. `defineKalemEditor("baska-ad")` ile farklı
		 * bir ad kaydedilirse bu eşleme onu kapsamıyor — tip sistemi etiket
		 * adını çalışma zamanından okuyamıyor.
		 */
		"kalem-editor": KalemEditorElement;
	}
}
