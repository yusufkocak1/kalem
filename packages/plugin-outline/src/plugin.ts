/**
 * `@kalem-editor/plugin-outline` — İçindekiler eklentisi  (İş listesi: F4-04)
 *
 * Başlıkları listeler, tıklanınca oraya atlar ve **etkin** başlığı
 * işaretler.
 *
 * ## Etkin başlık iki yerden geliyor
 *
 * Kullanıcının dikkati yazarken imleçte, okurken görünür alanda. İkisi de
 * dinleniyor ve **son gelen kazanıyor**:
 *
 * - `selectionchange` → imlecin bulunduğu bölümün başlığı. Ölçüm yok,
 *   yalnızca blok indisi karşılaştırması.
 * - kaydırma → görünür alanın üstündeki son başlık.
 *
 * Yalnızca kaydırmayı dinlemek, yazarken paneli sabit bırakırdı;
 * yalnızca imleci dinlemek, odak dışarıdayken (kullanıcı belgeyi
 * okuyorken) hiç güncellenmemesi demekti.
 *
 * ## Kaydırmada ölçü nasıl alınıyor
 *
 * Her karede en fazla bir kez, başlık elemanlarının
 * `getBoundingClientRect()`i okunuyor. Alternatif, `offsetTop` değerlerini
 * önbelleğe almaktı; görsel yüklendiğinde ya da bir paragraf sarmalandığında
 * bayatlıyor ve panel yanlış başlığı işaretliyor. Ölçümler arasında DOM'a
 * **yazılmadığı** için tarayıcı hepsini tek bir yerleşim geçişinde
 * veriyor; asıl pahalı olan okuma-yazma dönüşümü burada hiç olmuyor.
 *
 * ## Belge her değiştiğinde panel yeniden kurulmuyor
 *
 * Bir paragrafa harf eklemek belgeyi değiştiriyor ama içindekileri
 * değiştirmiyor. Liste `sameOutline` ile karşılaştırılıyor; eşitse DOM'a
 * dokunulmuyor, yani panelin kaydırma konumu ve klavye odağı duruyor.
 */
import type { Plugin, PluginContext } from "@kalem-editor/editor";
import { blockElementOf, holderIn, selectRange } from "@kalem-editor/editor";
import type { OutlineLabels } from "./labels.js";
import { labelsFor } from "./labels.js";
import type { OutlineItem } from "./outline.js";
import { outlineOf, sameOutline } from "./outline.js";
import type { OutlinePanel } from "./panel.js";
import { createOutlinePanel } from "./panel.js";

export interface OutlineOptions {
	/**
	 * Panelin çizileceği eleman.
	 *
	 * Verilmezse arayüz çizilmiyor; başlık listesi ve etkin başlık yine
	 * API'den okunabiliyor (`items()`, `activeIndex()`).
	 */
	container?: HTMLElement | null;
	/** Arayüz metinleri; verilmezse belgenin `lang`'ine göre seçiliyor. */
	labels?: OutlineLabels;
	/** CSS sınıf öneki (varsayılan `"kalem-"`, editörle aynı olmalı). */
	classPrefix?: string;
	/**
	 * Görünür alanın üstünden kaç piksel aşağısı "etkin" sayılıyor.
	 *
	 * Tam üst kenar kötü bir eşik: bir başlık ekranın en üstünde bir
	 * piksel görünürken hâlâ "etkin" olmuyor, kullanıcı ise onu okuyor.
	 */
	scrollOffset?: number;
	/** Etkin başlık değiştiğinde — kendi arayüzünü çizen uygulama için. */
	onActiveChange?: (item: OutlineItem | null, index: number) => void;
}

export interface OutlinePlugin extends Plugin {
	/** Güncel başlık listesi. */
	items(): readonly OutlineItem[];
	/** Etkin başlığın indisi; yoksa -1. */
	activeIndex(): number;
	/** Verilen başlığa atlar (imleci oraya taşır ve görünür alana getirir). */
	goTo(index: number): void;
	/** Listeyi elle yeniler — belge dışarıdan değiştiyse. */
	refresh(): void;
}

export function outlinePlugin(options: OutlineOptions = {}): OutlinePlugin {
	const p = options.classPrefix ?? "kalem-";
	const esik = options.scrollOffset ?? 24;

	let ctx: PluginContext | null = null;
	let panel: OutlinePanel | null = null;
	let items: readonly OutlineItem[] = [];
	let etkin = -1;
	/** Kaydırma ölçümü için planlanmış kare. */
	let kare: number | null = null;

	function tazele(): void {
		if (ctx === null) return;
		const yeni = outlineOf(ctx.getDocument());
		if (sameOutline(items, yeni)) return;
		items = yeni;
		panel?.render(items);
		// Liste değişti: eski indis başka bir başlığı gösteriyor olabilir.
		etkin = -1;
		imlectenEtkin();
		// Odak editörde değilse imleç bir şey söylemiyor; ölçüme düşüyoruz.
		if (etkin < 0) planla();
	}

	/** Başlığın DOM elemanı. */
	function eleman(item: OutlineItem): HTMLElement | null {
		if (ctx === null || item.blockId === "") return null;
		const blok = blockElementOf(ctx.element, item.blockId);
		return blok === null ? null : holderIn(blok, item.path);
	}

	function etkinYap(index: number): void {
		if (index === etkin) return;
		etkin = index;
		panel?.setActive(index);
		options.onActiveChange?.(items[index] ?? null, index);
	}

	/**
	 * İmlecin bulunduğu bölümün başlığı.
	 *
	 * Yalnızca **odak editördeyken** dinleniyor. Odak dışarıdayken imleç
	 * kullanıcının dikkatini göstermiyor, son bıraktığı yeri gösteriyor;
	 * bu ayrım olmadan salt okunur bir belgede panelden bir başlığa
	 * atlamak işe yaramıyordu: tıklama seçimi değiştirdiği için gelen
	 * `selectionchange`, az önce işaretlenen başlığı eskisiyle
	 * değiştiriyordu.
	 */
	function imlectenEtkin(): void {
		if (ctx === null) return;
		const odak = ctx.element.ownerDocument.activeElement;
		if (odak === null || !ctx.element.contains(odak)) return;
		const caret = ctx.getCaret();
		if (caret === null || items.length === 0) return;
		let bulunan = -1;
		for (const [i, item] of items.entries()) {
			if (item.blockIndex <= caret.blockIndex) bulunan = i;
			else break;
		}
		etkinYap(bulunan);
	}

	/**
	 * Editörü kaydıran eleman; sayfanın kendisi kaydırıyorsa `null`.
	 *
	 * Eşik **buna göre** ölçülüyor. Görünür alanın üst kenarına (0) göre
	 * ölçmek, editörü kendi kutusunda kaydıran uygulamalarda her şeyi
	 * bozuyordu: kutu sayfanın 200 piksel aşağısındaysa kutunun tepesine
	 * kaydırılmış bir başlığın `top`u 200 çıkıyor ve hiçbir başlık etkin
	 * sayılmıyor.
	 */
	function kaydiranKap(): HTMLElement | null {
		const view = ctx?.element.ownerDocument.defaultView ?? null;
		if (ctx === null || view === null) return null;
		let el = ctx.element.parentElement;
		while (el !== null) {
			const tasma = view.getComputedStyle(el).overflowY;
			if ((tasma === "auto" || tasma === "scroll") && el.scrollHeight > el.clientHeight) return el;
			el = el.parentElement;
		}
		return null;
	}

	/** Görünür alanın üstündeki son başlık. */
	function kaydirmadanEtkin(): void {
		if (items.length === 0) return;
		const kap = kaydiranKap();
		const ust = kap === null ? 0 : kap.getBoundingClientRect().top + kap.clientTop;
		let bulunan = -1;
		for (const [i, item] of items.entries()) {
			const el = eleman(item);
			if (el === null) continue;
			if (el.getBoundingClientRect().top <= ust + esik) bulunan = i;
			else break;
		}
		if (bulunan < 0) {
			// Hiçbir başlık eşiğin üstünde değil. Bu iki farklı durumda
			// oluyor ve ikisine aynı cevap verilemez: belge en başındaysa
			// ilk başlık etkin sayılmalı, ama belge hiç kaydırılamıyorsa
			// (ekrana sığıyor) ölçüm bir şey **söylemiyor**.
			//
			// İkincisinde "ilk başlık" demek, panelden bir başlığa
			// atlamayı işe yaramaz kılıyordu: atlamanın tetiklediği
			// kaydırma olayı, az önce işaretlenen başlığı ilkine geri
			// çeviriyordu. O yüzden ölçüm yalnızca **henüz bir seçim
			// yokken** varsayımda bulunuyor.
			if (etkin < 0) etkinYap(0);
			return;
		}
		etkinYap(bulunan);
	}

	function planla(): void {
		const view = ctx?.element.ownerDocument.defaultView ?? null;
		if (view === null || kare !== null) return;
		kare = view.requestAnimationFrame(() => {
			kare = null;
			kaydirmadanEtkin();
		});
	}

	function git(index: number): void {
		const item = items[index];
		if (ctx === null || item === undefined) return;
		const holder = eleman(item);
		if (holder === null) return;

		const blok = blockElementOf(ctx.element, item.blockId);
		// Salt okunur belgede blok odaklanamıyor; atlama yine çalışmalı,
		// yalnızca imleç konmuyor.
		if (blok?.isContentEditable === true) {
			blok.focus();
			selectRange(holder, 0, 0);
		}
		holder.scrollIntoView({ block: "start" });
		etkinYap(index);
	}

	return {
		name: "outline",

		setup(context: PluginContext) {
			ctx = context;
			const belgeDili = context.getLang();
			const labels = options.labels ?? labelsFor(belgeDili);

			if (options.container != null) {
				panel = createOutlinePanel(options.container, {
					prefix: p,
					label: labels.title,
					emptyText: labels.empty,
					onSelect: (_item, index) => git(index),
				});
			}

			const view = context.element.ownerDocument.defaultView;
			// Kaydırma `capture` ile dinleniyor: olay, kaydıran elemandan
			// yukarı **kabarmıyor** ve editörün kaydırılabilir atası gömen
			// uygulamanın elinde — hangisi olduğunu bilemeyiz.
			view?.addEventListener("scroll", planla, { capture: true, passive: true });
			view?.addEventListener("resize", planla, { passive: true });

			const abonelikler = [
				context.on("change", tazele),
				context.on("selectionchange", imlectenEtkin),
			];

			tazele();

			return () => {
				for (const birak of abonelikler) birak();
				view?.removeEventListener("scroll", planla, { capture: true });
				view?.removeEventListener("resize", planla);
				if (kare !== null) view?.cancelAnimationFrame(kare);
				kare = null;
				panel?.destroy();
				panel = null;
				items = [];
				etkin = -1;
				ctx = null;
			};
		},

		items: () => items,
		activeIndex: () => etkin,
		goTo: git,
		refresh: tazele,
	};
}
