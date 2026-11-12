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
	/**
	 * Kutuyu gösterir; `offset`teki satır görünür alanın tepesinden `delta`
	 * uzağa gelir ve imleç oraya konur (okunan yer korunuyor).
	 */
	show(text: string, readOnly: boolean, offset?: number, delta?: number): void;
	/** Görünür alanın tepesindeki satırın ofseti ve o satırın tepeye uzaklığı. */
	topOffset(): { offset: number; delta: number } | null;
	hide(): void;
	text(): string;
	setReadOnly(readOnly: boolean): void;
	destroy(): void;
}

/** Elemanı kaydıran en yakın ata; yoksa belgenin kaydırıcısı. */
export function kaydiranAta(element: HTMLElement): HTMLElement {
	const doc = element.ownerDocument;
	for (let ata = element.parentElement; ata !== null; ata = ata.parentElement) {
		const tasma = doc.defaultView?.getComputedStyle(ata).overflowY ?? "";
		if ((tasma === "auto" || tasma === "scroll") && ata.scrollHeight > ata.clientHeight) return ata;
	}
	return (doc.scrollingElement as HTMLElement | null) ?? doc.documentElement;
}

/** Görünür alanın tepesi, pencerede: kaydıran atanın üstü (belgeninki 0). */
export function gorunurUst(element: HTMLElement): number {
	const kaydiran = kaydiranAta(element);
	const doc = element.ownerDocument;
	return kaydiran === doc.scrollingElement || kaydiran === doc.documentElement
		? 0
		: Math.max(0, kaydiran.getBoundingClientRect().top);
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

	/**
	 * Metindeki bir ofsetin kutunun içeriğindeki dikey yeri (kutunun
	 * tepesinden). Kutu satırları kaydırdığı için satır sayısı yetmiyor:
	 * aynı genişlik ve yazı tipindeki gizli bir kopyada ölçülüyor.
	 */
	function satirY(offset: number): number {
		const stil = doc.defaultView?.getComputedStyle(kutu);
		if (stil === undefined) return 0;
		const kopya = doc.createElement("div");
		for (const ozellik of [
			"boxSizing",
			"width",
			"paddingTop",
			"paddingRight",
			"paddingBottom",
			"paddingLeft",
			"borderTopWidth",
			"borderRightWidth",
			"borderBottomWidth",
			"borderLeftWidth",
			"borderStyle",
			"fontFamily",
			"fontSize",
			"fontWeight",
			"fontStyle",
			"lineHeight",
			"letterSpacing",
			"wordSpacing",
			"tabSize",
			"textIndent",
			"textTransform",
		] as const) {
			kopya.style[ozellik] = stil[ozellik];
		}
		kopya.style.position = "absolute";
		kopya.style.visibility = "hidden";
		kopya.style.top = "0";
		kopya.style.left = "-10000px";
		kopya.style.whiteSpace = "pre-wrap";
		kopya.style.overflowWrap = "break-word";
		kopya.style.height = "auto";
		kopya.textContent = kutu.value.slice(0, offset);
		const isaret = doc.createElement("span");
		isaret.textContent = "\u200b";
		kopya.append(isaret);
		doc.body.append(kopya);
		const y = isaret.offsetTop;
		kopya.remove();
		return y;
	}

	/** Kutu kendi içinde kayıyorsa onun, yoksa sayfanın kaydırması kullanılıyor. */
	const kendiKayiyor = (): boolean => kutu.scrollHeight > kutu.clientHeight + 1;

	return {
		show(text, readOnly, offset = 0, delta = 0) {
			const olcu = editor.getBoundingClientRect();
			kutu.value = text;
			kutu.readOnly = readOnly;
			// En az 200 piksel: boş bir belgede kutu bir çizgiye inmesin.
			kutu.style.height = `${Math.max(200, Math.round(olcu.height))}px`;
			kutu.hidden = false;
			editor.hidden = true;
			// Kaynak editörden uzunsa kutu onun boyuna uzuyor: içi ayrıca kaymasın, sayfa kaysın.
			if (kutu.scrollHeight > kutu.clientHeight) {
				const kenar = kutu.offsetHeight - kutu.clientHeight;
				kutu.style.height = `${kutu.scrollHeight + kenar}px`;
			}
			// Odak sayfayı kaydırmadan; okunan satır aşağıda yerine getiriliyor.
			kutu.focus({ preventScroll: true });
			const at = Math.max(0, Math.min(offset, text.length));
			kutu.setSelectionRange(at, at);
			if (at === 0 && delta === 0) return;
			const y = satirY(at);
			if (kendiKayiyor()) {
				kutu.scrollTop = Math.max(0, y - Math.max(0, delta));
				return;
			}
			const kaydiran = kaydiranAta(kutu);
			const simdi = kutu.getBoundingClientRect().top + y - kutu.scrollTop;
			kaydiran.scrollTop += simdi - (gorunurUst(kutu) + delta);
		},

		topOffset() {
			if (kutu.hidden) return null;
			// Görünür alanın tepesinin kutu içeriğindeki yeri.
			const tepe = gorunurUst(kutu) - kutu.getBoundingClientRect().top + kutu.scrollTop;
			if (tepe <= 0) return { offset: 0, delta: -tepe };
			// O yükseklikteki satırın başı: satır başları üstünde ikili arama.
			const baslar = [0];
			for (let i = kutu.value.indexOf("\n"); i !== -1; i = kutu.value.indexOf("\n", i + 1)) {
				baslar.push(i + 1);
			}
			let alt = 0;
			let ust = baslar.length - 1;
			while (alt < ust) {
				const orta = Math.ceil((alt + ust) / 2);
				if (satirY(baslar[orta] as number) <= tepe) alt = orta;
				else ust = orta - 1;
			}
			const offset = baslar[alt] as number;
			return { offset, delta: satirY(offset) - tepe };
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
