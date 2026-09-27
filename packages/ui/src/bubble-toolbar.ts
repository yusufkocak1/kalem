/**
 * @kalem-editor/ui — Balon araç çubuğu  (İş listesi: F3-01)
 *
 * Metin seçilince seçimin üstünde beliren araç çubuğu. Word'ün mini araç
 * çubuğunun karşılığı ve Segment A (yazılım bilmeyen kullanıcı) için
 * biçimlendirmenin **görünür** tek yolu — kısayolları bilmeyen kimse
 * Ctrl+B'yi keşfetmiyor.
 *
 * ## Ne zaman görünüyor
 *
 * Yalnızca **blok içi, boş olmayan** seçimde. Bloklar arası seçimde
 * (F2-06) gizleniyor: orada seçili olan metin değil bloklar ve kalın
 * yapılacak bir şey yok. İmleç dururken de gizli — Word'de de öyle.
 *
 * ## Konumlandırma
 *
 * Kendi hesabımız (`floating.ts`), Floating UI bağımlılığı yok. Kaydırma
 * ve pencere boyutu değişince yeniden konumlanıyor; `position: fixed`
 * olduğu için editörün kaydırmalı bir kapsayıcı içinde olması sorun değil.
 *
 * ## Erişilebilirlik
 *
 * `role="toolbar"` + gezgin sekme sırası (roving tabindex): araç çubuğuna
 * bir kez Tab ile giriliyor, içinde ok tuşlarıyla geziliyor. Her düğmenin
 * yalnız başına anlaşılır bir adı var ve basılı durum `aria-pressed` ile
 * duyuruluyor. Tam geçiş F3-10'da.
 */
import type { MarkType } from "@kalem-editor/core/commands";
import type { Editor } from "@kalem-editor/editor";
import { button, el, themed } from "./dom.js";
import { position, selectionRect } from "./floating.js";
import type { UiLabels } from "./labels.js";
import { createBlockSelect, MARKS } from "./toolbar-actions.js";

export interface BubbleToolbarOptions {
	readonly prefix: string;
	readonly labels: UiLabels;
	/** Bağlantı düğmesine basılınca çağrılıyor (F3-02 akışı). */
	readonly onLink?: () => void;
}

export interface BubbleToolbar {
	readonly element: HTMLElement;
	/** Seçime göre göster/gizle ve konumla. */
	update(): void;
	hide(): void;
	destroy(): void;
}

export function createBubbleToolbar(editor: Editor, options: BubbleToolbarOptions): BubbleToolbar {
	const doc = editor.getElement().ownerDocument;
	const p = options.prefix;
	const labels = options.labels;

	const root = el(doc, "div", {
		class: `${p}bubble`,
		attrs: { role: "toolbar", "aria-label": labels.formatting, hidden: "" },
	});

	const dugmeler = new Map<MarkType, HTMLButtonElement>();
	for (const { mark, glyph, key } of MARKS) {
		const b = button(doc, {
			class: `${p}bubble-button`,
			label: labels[key],
			glyph,
			onClick: () => {
				editor.toggleMark(mark);
				update();
			},
		});
		dugmeler.set(mark, b);
		root.append(b);
	}

	const bagDugmesi = button(doc, {
		class: `${p}bubble-button`,
		label: labels.link,
		glyph: "🔗",
		onClick: () => options.onLink?.(),
	});
	root.append(bagDugmesi);

	const blokSecici = createBlockSelect(editor, p, labels);
	blokSecici.element.classList.add(`${p}bubble-select`);
	root.append(blokSecici.element);

	doc.body.append(themed(root, p));

	// -----------------------------------------------------------------------
	// Görünürlük ve konum
	// -----------------------------------------------------------------------

	function update(): void {
		const selection = editor.getSelection();
		// Bloklar arası seçimde biçimlendirilecek metin yok.
		if (
			editor.isReadOnly() ||
			selection === null ||
			selection.kind !== "text" ||
			selection.collapsed
		) {
			hide();
			return;
		}
		const kutu = selectionRect(doc);
		if (kutu === null) {
			hide();
			return;
		}

		root.hidden = false;
		for (const [mark, b] of dugmeler) {
			b.setAttribute("aria-pressed", String(editor.isMarkActive(mark)));
		}
		blokSecici.sync();
		position(root, kutu, { placement: "top" });
	}

	function hide(): void {
		root.hidden = true;
	}

	// Kaydırma ve boyut değişiminde yeniden konumlanıyor. `capture: true`
	// şart: editör kaydırmalı bir kapsayıcının içindeyse olay `window`'a
	// köpürmüyor.
	const yenidenKonumla = (): void => {
		if (!root.hidden) update();
	};
	doc.addEventListener("scroll", yenidenKonumla, true);
	doc.defaultView?.addEventListener("resize", yenidenKonumla);

	// Ok tuşlarıyla gezinme (roving tabindex).
	root.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
		const odaklanabilir = Array.from(root.querySelectorAll<HTMLElement>("button, select"));
		const simdiki = odaklanabilir.indexOf(doc.activeElement as HTMLElement);
		if (simdiki < 0) return;
		event.preventDefault();
		const yon = event.key === "ArrowRight" ? 1 : -1;
		const hedef = (simdiki + yon + odaklanabilir.length) % odaklanabilir.length;
		odaklanabilir[hedef]?.focus();
	});

	return {
		element: root,
		update,
		hide,
		destroy() {
			doc.removeEventListener("scroll", yenidenKonumla, true);
			doc.defaultView?.removeEventListener("resize", yenidenKonumla);
			root.remove();
		},
	};
}
