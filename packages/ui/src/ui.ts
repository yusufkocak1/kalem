/**
 * @kalem/ui — Arayüz katmanının montajı  (İş listesi: F3-01)
 *
 * ## Neden ayrı paket, neden ayrı montaj
 *
 * Editör başsız (F2): hiçbir arayüz çizmiyor. Arayüz buraya alındı ki
 * kendi tasarım sistemi olan bir uygulama editörü alıp arayüzü almasın —
 * ya da yalnızca bir parçasını alsın. `mountUi` her parçayı ayrı ayrı
 * kapatılabilir yapıyor.
 *
 * Bağlantı yönü tek: arayüz editörü tanıyor, editör arayüzü tanımıyor.
 * Ters bağımlılık, başsız kullanımı imkânsız kılardı.
 */
import type { Editor } from "@kalem/editor";
import type { BubbleToolbar } from "./bubble-toolbar.js";
import { createBubbleToolbar } from "./bubble-toolbar.js";
import type { UiLabels } from "./labels.js";
import { labelsFor } from "./labels.js";

export interface UiOptions {
	/**
	 * Balon araç çubuğu (varsayılan açık).
	 *
	 * Segment A için biçimlendirmenin **görünür** tek yolu: kısayolları
	 * bilmeyen kullanıcı Ctrl+B'yi keşfetmiyor.
	 */
	readonly bubbleToolbar?: boolean;
	/**
	 * Arayüz metinleri.
	 *
	 * Verilmezse editörün `lang`'ine göre seçiliyor (`tr` → Türkçe,
	 * aksi hâlde İngilizce).
	 */
	readonly labels?: UiLabels;
	/** CSS sınıf öneki (varsayılan `"kalem-"`, editörle aynı olmalı). */
	readonly classPrefix?: string;
}

export interface Ui {
	/** Balon araç çubuğu — kapalıysa `null`. */
	readonly bubbleToolbar: BubbleToolbar | null;
	readonly labels: UiLabels;
	destroy(): void;
}

export function mountUi(editor: Editor, options: UiOptions = {}): Ui {
	const element = editor.getElement();
	const prefix = options.classPrefix ?? "kalem-";
	const labels = options.labels ?? labelsFor(element.closest("[lang]")?.getAttribute("lang"));
	const sokucular: (() => void)[] = [];

	element.classList.add(`${prefix}ui`);

	let bubbleToolbar: BubbleToolbar | null = null;
	if (options.bubbleToolbar !== false) {
		bubbleToolbar = createBubbleToolbar(editor, { prefix, labels });
		sokucular.push(() => bubbleToolbar?.destroy());
		sokucular.push(editor.on("selectionchange", () => bubbleToolbar?.update()));
		// İçerik değişince de tazeleniyor: biçim uygulandığında seçim aynı
		// kalıyor, yani `selectionchange` tetiklenmiyor ama düğmelerin
		// basılı durumu değişiyor (F2-07'de yakalanan durumun aynısı).
		sokucular.push(editor.on("change", () => bubbleToolbar?.update()));
	}

	return {
		bubbleToolbar,
		labels,
		destroy() {
			for (const sok of sokucular.reverse()) sok();
			element.classList.remove(`${prefix}ui`);
		},
	};
}
