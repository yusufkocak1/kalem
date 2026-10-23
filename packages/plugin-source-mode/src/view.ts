/**
 * @kalem-editor/plugin-source-mode — Kaynak kutusu  (İş listesi: F4-06)
 *
 * Editörün yerine geçen `<textarea>`.
 *
 * ## Editör gizleniyor, silinmiyor
 *
 * WYSIWYG tarafı `hidden` ile kapatılıyor. Alternatif, DOM'dan çıkarıp
 * geri koymaktı; o zaman blok elemanları yeniden kurulur, editörün eleman
 * haritası (F2-05) geçersizleşir ve kaynak kipinden dönen kullanıcı
 * bambaşka bir belgeye bakar. Gizlemek hem ucuz hem geri döndüğünde
 * hiçbir şeyin değişmemesini garanti ediyor.
 *
 * ## Yükseklik
 *
 * Kutu, editörün kapladığı yüksekliği devralıyor: geçişte sayfa
 * zıplamıyor. Ölçü geçiş anında bir kez alınıyor — kullanıcı kaynakta
 * yazarken kutu kendi kurallarıyla büyüyor.
 */

import { MARKDOWN_TYPE } from "@kalem-editor/editor";
import type { SourceLabels } from "./labels.js";

export interface SourceViewOptions {
	readonly prefix: string;
	readonly labels: SourceLabels;
	readonly onExit: () => void;
	readonly isShortcut: (event: KeyboardEvent) => boolean;
}

export interface SourceView {
	show(text: string, readOnly: boolean): void;
	hide(): void;
	text(): string;
	setReadOnly(readOnly: boolean): void;
	destroy(): void;
}

export function createSourceView(editor: HTMLElement, options: SourceViewOptions): SourceView {
	const doc = editor.ownerDocument;

	const kutu = doc.createElement("textarea");
	kutu.className = `${options.prefix}source`;
	kutu.setAttribute("aria-label", options.labels.label);
	kutu.hidden = true;
	// Markdown'da girinti anlamlı; tarayıcının otomatik düzeltmeleri
	// kaynağı sessizce bozuyor (akıllı tırnak, ilk harf büyütme).
	kutu.spellcheck = false;
	kutu.autocapitalize = "off";
	kutu.setAttribute("autocorrect", "off");
	kutu.setAttribute("translate", "no");

	editor.after(kutu);

	const tus = (event: KeyboardEvent): void => {
		// Escape ve kısayol geri döndürüyor. Odak `<textarea>`da olduğu
		// için editörün tuş haritası bu olayları hiç görmüyor.
		if (event.key === "Escape" || options.isShortcut(event)) {
			event.preventDefault();
			options.onExit();
		}
	};

	// Kalem'den kopyalanan metnin düz hâli biçim işaretlerini atıyor;
	// kaynağa onun Markdown'ı yapıştırılıyor. `insertText` geri almayı koruyor.
	const yapistir = (event: ClipboardEvent): void => {
		const markdown = event.clipboardData?.getData(MARKDOWN_TYPE) ?? "";
		if (markdown === "" || kutu.readOnly) return;
		event.preventDefault();
		doc.execCommand("insertText", false, markdown);
	};

	kutu.addEventListener("keydown", tus);
	kutu.addEventListener("paste", yapistir);

	return {
		show(text, readOnly) {
			const olcu = editor.getBoundingClientRect();
			kutu.value = text;
			kutu.readOnly = readOnly;
			// En az 200 piksel: boş bir belgede kutu bir çizgiye inmesin.
			kutu.style.height = `${Math.max(200, Math.round(olcu.height))}px`;
			kutu.hidden = false;
			editor.hidden = true;
			kutu.focus();
			// İmleç başta; sonu seçmek uzun bir belgede kullanıcıyı
			// bilmediği bir yere atardı (dosya başındaki not).
			kutu.setSelectionRange(0, 0);
		},

		hide() {
			kutu.hidden = true;
			editor.hidden = false;
		},

		text: () => kutu.value,

		setReadOnly(readOnly) {
			kutu.readOnly = readOnly;
		},

		destroy() {
			kutu.removeEventListener("keydown", tus);
			kutu.removeEventListener("paste", yapistir);
			kutu.remove();
			editor.hidden = false;
		},
	};
}
