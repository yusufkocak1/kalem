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
import type { BlockHandle } from "./block-handle.js";
import { createBlockHandle } from "./block-handle.js";
import type { BubbleToolbar } from "./bubble-toolbar.js";
import { createBubbleToolbar } from "./bubble-toolbar.js";
import type { UiLabels } from "./labels.js";
import { labelsFor } from "./labels.js";
import type { LinkPopover } from "./link-popover.js";
import { createLinkPopover, normalizeUrl } from "./link-popover.js";
import type { LiveRegion } from "./live-region.js";
import { createLiveRegion } from "./live-region.js";
import { createPlaceholder } from "./placeholder.js";
import type { SlashItem, SlashMenu } from "./slash-menu.js";
import { createSlashMenu } from "./slash-menu.js";

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
	/**
	 * Bağlantı düzenleme akışı (varsayılan açık).
	 *
	 * Ctrl+K, araç çubuğundaki bağlantı düğmesi ve var olan bağlantıya
	 * tıklamak — üçü de aynı popover'ı açıyor.
	 */
	readonly linkPopover?: boolean;
	/**
	 * Boş belgede ipucu metni (varsayılan açık).
	 *
	 * Kapatmak için `false`; metni değiştirmek için `labels.placeholder`.
	 */
	readonly placeholder?: boolean;
	/**
	 * Slash menü (varsayılan açık).
	 *
	 * Segment A için "ne ekleyebilirim" sorusunun tek görünür cevabı:
	 * kısayolları bilmeyen kullanıcı Ctrl+Alt+2'yi keşfetmiyor ama `/`
	 * yazmayı bir kez öğreniyor.
	 */
	readonly slashMenu?: boolean;
	/** Slash menüye eklenen öğeler (eklentiler için). */
	readonly slashItems?: readonly SlashItem[];
	/**
	 * Blok tutamacı ve sürükle-bırak (varsayılan açık).
	 *
	 * Kapatmak bloğu taşımayı tümden kapatmıyor: Ctrl+Shift+↑/↓ tutamaçla
	 * birlikte kurulduğu için o da gider. Sıralamayı tümden yasaklamak
	 * isteyen `setReadOnly` kullanmalı.
	 */
	readonly blockHandle?: boolean;
	/**
	 * Arama karşılaştırmasının dili.
	 *
	 * Verilmezse belgenin `lang`i kullanılıyor. Türkçe'de büyük/küçük
	 * katlaması noktalı/noktasız i yüzünden farklı çalışıyor; ayrıntı
	 * `search.ts` içinde.
	 */
	readonly locale?: string;
}

export interface Ui {
	/** Balon araç çubuğu — kapalıysa `null`. */
	readonly bubbleToolbar: BubbleToolbar | null;
	/** Bağlantı popover'ı — kapalıysa `null`. */
	readonly linkPopover: LinkPopover | null;
	/** Slash menü — kapalıysa `null`. */
	readonly slashMenu: SlashMenu | null;
	/** Blok tutamacı — kapalıysa `null`. */
	readonly blockHandle: BlockHandle | null;
	/** Ekran okuyucu duyuru kanalı. */
	readonly liveRegion: LiveRegion;
	readonly labels: UiLabels;
	destroy(): void;
}

export function mountUi(editor: Editor, options: UiOptions = {}): Ui {
	const element = editor.getElement();
	const prefix = options.classPrefix ?? "kalem-";
	const belgeDili = element.closest("[lang]")?.getAttribute("lang") ?? "en";
	const labels = options.labels ?? labelsFor(belgeDili);
	const locale = options.locale ?? belgeDili;
	const sokucular: (() => void)[] = [];

	element.classList.add(`${prefix}ui`);

	const liveRegion = createLiveRegion(element.ownerDocument, prefix);
	sokucular.push(() => liveRegion.destroy());

	if (options.placeholder !== false) {
		const yerTutucu = createPlaceholder(editor, { prefix, text: labels.placeholder });
		sokucular.push(() => yerTutucu.destroy());
	}

	let linkPopover: LinkPopover | null = null;
	if (options.linkPopover !== false) {
		linkPopover = createLinkPopover(editor, { prefix, labels });
		sokucular.push(() => linkPopover?.destroy());

		// Ctrl+K — eklenti olarak kaydediliyor, doğrudan dinleyici olarak
		// değil: eklenti kaydı çekirdek kısayollarından **önce** geçiyor ve
		// çakışma kuralı (kayıt sırası) tek yerde kalıyor.
		editor.addPlugin({
			name: "ui-link-shortcut",
			keymap: (event) => {
				// kalem-locale-ok: tuş adları ASCII; Türkçe kuralı burada zarar verir
				const tus = event.key.toLowerCase();
				if (!(event.ctrlKey || event.metaKey) || tus !== "k") return false;
				linkPopover?.open();
				return true;
			},
		});
		sokucular.push(() => editor.removePlugin("ui-link-shortcut"));

		// Var olan bir bağlantıya tıklamak da düzenleme akışını açıyor.
		const bagaTikla = (event: MouseEvent): void => {
			const hedef = event.target;
			if (!(hedef instanceof Element) || hedef.closest("a") === null) return;
			// Tıklama seçimi yerleştirdikten **sonra** açılıyor; aksi hâlde
			// `getActiveLink` eski konumu okur.
			setTimeout(() => linkPopover?.open(), 0);
		};
		element.addEventListener("click", bagaTikla);
		sokucular.push(() => element.removeEventListener("click", bagaTikla));

		// URL yapıştırınca seçili metin bağlantıya dönüyor (F3-02 kabul
		// kriteri). Yapıştırmanın tamamı F3-07'nin işi; burada yalnızca bu
		// dar durum yakalanıyor.
		const yapistir = (event: ClipboardEvent): void => {
			if (editor.isReadOnly()) return;
			const ham = event.clipboardData?.getData("text/plain")?.trim() ?? "";
			if (ham === "" || /\s/.test(ham)) return;
			const url = normalizeUrl(ham);
			if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return;
			// Canlı aralık okunuyor: önbelleğe alınmış seçim, yapıştırma
			// klavyeden geldiğinde henüz güncellenmemiş olabiliyor.
			const aralik = editor.getTextRange();
			if (aralik === null || aralik.from === aralik.to) return;
			event.preventDefault();
			editor.setLink(url);
		};
		element.addEventListener("paste", yapistir);
		sokucular.push(() => element.removeEventListener("paste", yapistir));
	}

	let slashMenu: SlashMenu | null = null;
	if (options.slashMenu !== false) {
		slashMenu = createSlashMenu(editor, {
			prefix,
			labels,
			locale,
			extraItems: options.slashItems ?? [],
		});
		sokucular.push(() => slashMenu?.destroy());
	}

	let blockHandle: BlockHandle | null = null;
	if (options.blockHandle !== false) {
		blockHandle = createBlockHandle(editor, {
			prefix,
			labels,
			announce: (mesaj) => liveRegion.announce(mesaj),
		});
		sokucular.push(() => blockHandle?.destroy());
	}

	let bubbleToolbar: BubbleToolbar | null = null;
	if (options.bubbleToolbar !== false) {
		bubbleToolbar = createBubbleToolbar(editor, {
			prefix,
			labels,
			onLink: () => linkPopover?.open(),
		});
		sokucular.push(() => bubbleToolbar?.destroy());
		sokucular.push(editor.on("selectionchange", () => bubbleToolbar?.update()));
		// İçerik değişince de tazeleniyor: biçim uygulandığında seçim aynı
		// kalıyor, yani `selectionchange` tetiklenmiyor ama düğmelerin
		// basılı durumu değişiyor (F2-07'de yakalanan durumun aynısı).
		sokucular.push(editor.on("change", () => bubbleToolbar?.update()));
	}

	return {
		bubbleToolbar,
		linkPopover,
		slashMenu,
		blockHandle,
		liveRegion,
		labels,
		destroy() {
			for (const sok of sokucular.reverse()) sok();
			element.classList.remove(`${prefix}ui`);
		},
	};
}
