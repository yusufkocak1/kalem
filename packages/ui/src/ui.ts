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
import type { BlockMenu } from "./block-menu.js";
import { createBlockMenu } from "./block-menu.js";
import type { BubbleToolbar } from "./bubble-toolbar.js";
import { createBubbleToolbar } from "./bubble-toolbar.js";
import type { FixedToolbar, ToolbarGroup } from "./fixed-toolbar.js";
import { createFixedToolbar } from "./fixed-toolbar.js";
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
	 * Hangi araç çubuğu (varsayılan `"bubble"`).
	 *
	 * - `"bubble"` — seçim yapılınca beliren balon (F3-01). Segment A için
	 *   biçimlendirmenin **görünür** yolu: kısayolları bilmeyen kullanıcı
	 *   Ctrl+B'yi keşfetmiyor.
	 * - `"fixed"` — editörün üstünde duran sabit çubuk (F3-06). Word'e
	 *   alışkın kullanıcı "burada neler var"ı seçim yapmadan görüyor.
	 * - `"both"` — ikisi birden; biri keşif, diğeri erişim için.
	 * - `false` — hiçbiri.
	 */
	readonly toolbar?: "fixed" | "bubble" | "both" | false;
	/**
	 * Sabit çubuktaki düğme grupları ve sıraları.
	 *
	 * Varsayılan hepsi. `toolbar` sabit çubuğu içermiyorsa etkisiz.
	 */
	readonly toolbarGroups?: readonly ToolbarGroup[];
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
	/** Sabit üst araç çubuğu — kapalıysa `null`. */
	readonly fixedToolbar: FixedToolbar | null;
	/** Bağlantı popover'ı — kapalıysa `null`. */
	readonly linkPopover: LinkPopover | null;
	/** Slash menü — kapalıysa `null`. */
	readonly slashMenu: SlashMenu | null;
	/** Blok tutamacı — kapalıysa `null`. */
	readonly blockHandle: BlockHandle | null;
	/** Blok bağlam menüsü — tutamaç kapalıysa `null`. */
	readonly blockMenu: BlockMenu | null;
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
		// **Yakalama evresi.** Editörün kendi yapıştırma boru hattı (F3-07)
		// aynı elemanda dinliyor ve önce kaydolduğu için köpürme evresinde
		// bizden önce çalışırdı; URL, bağlantı olacağı yerde düz metin
		// olarak yapıştırılıyordu. Yakalama evresi sırayı kayıt sırasından
		// bağımsız hâle getiriyor.
		element.addEventListener("paste", yapistir, true);
		sokucular.push(() => element.removeEventListener("paste", yapistir, true));
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
	let blockMenu: BlockMenu | null = null;
	if (options.blockHandle !== false) {
		blockMenu = createBlockMenu(editor, {
			prefix,
			labels,
			announce: (mesaj) => liveRegion.announce(mesaj),
			// Menü kapanınca tutamaç yeniden işaretçiyi izliyor.
			onClose: () => blockHandle?.setPinned(false),
		});
		sokucular.push(() => blockMenu?.destroy());

		blockHandle = createBlockHandle(editor, {
			prefix,
			labels,
			announce: (mesaj) => liveRegion.announce(mesaj),
			onMenu: (blockId, anchor) => {
				// Menü açıkken tutamaç yerinde kalıyor: Escape odağı ona
				// geri veriyor ve gizli bir düğme odak alamıyor.
				blockHandle?.setPinned(true);
				blockMenu?.open(blockId, anchor);
			},
		});
		sokucular.push(() => blockHandle?.destroy());
	}

	const toolbar = options.toolbar ?? "bubble";

	let fixedToolbar: FixedToolbar | null = null;
	if (toolbar === "fixed" || toolbar === "both") {
		fixedToolbar = createFixedToolbar(editor, {
			prefix,
			labels,
			...(options.toolbarGroups !== undefined ? { groups: options.toolbarGroups } : {}),
			onLink: () => linkPopover?.open(),
		});
		sokucular.push(() => fixedToolbar?.destroy());
		sokucular.push(editor.on("selectionchange", () => fixedToolbar?.update()));
		sokucular.push(editor.on("change", () => fixedToolbar?.update()));
		sokucular.push(editor.on("readonlychange", () => fixedToolbar?.update()));
	}

	let bubbleToolbar: BubbleToolbar | null = null;
	if (toolbar === "bubble" || toolbar === "both") {
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
		fixedToolbar,
		linkPopover,
		slashMenu,
		blockHandle,
		blockMenu,
		liveRegion,
		labels,
		destroy() {
			for (const sok of sokucular.reverse()) sok();
			element.classList.remove(`${prefix}ui`);
		},
	};
}
