/**
 * @kalem/ui — Blok tutamacı ve sürükle-bırak  (İş listesi: F3-04)
 *
 * Kullanıcının açıkça istediği özellik. Bloğun soluna gelen tutamaç (⠿)
 * ve altına blok ekleyen artı düğmesi.
 *
 * ## Pointer olayları, HTML5 sürükleme değil
 *
 * `draggable` + `dragstart` kolay görünüyor ama üç şeyi vermiyor:
 * dokunmatik destek (mobilde hiç çalışmıyor), sürükleme sırasında
 * konumun piksel hassasiyetinde okunması, ve otomatik kaydırma. Pointer
 * olayları üçünü de veriyor ve fare/dokunmatik/kalem için tek kod yolu.
 *
 * ## Klavye alternatifi
 *
 * **Sürükle-bırak tek yol olamaz** (F3-10). Ctrl+Shift+↑/↓ aynı işi
 * yapıyor ve sonucu canlı bölgeye duyuruluyor. Fare kullanamayan
 * kullanıcı da blok sıralayabilmeli.
 *
 * ## Bırakma göstergesi
 *
 * Bloklar arasına çizilen ince çizgi. Hayalet önizleme yerine bu seçildi:
 * hayalet, sürüklenen içeriğin kopyasını taşımak demek ve uzun bir blokta
 * ekranın yarısını kaplıyor. Çizgi "nereye düşecek" sorusunu daha net
 * cevaplıyor.
 */
import type { Editor } from "@kalem/editor";
import { moveBlocks, newParagraph, nudgeBlock } from "@kalem/editor";
import { button, el } from "./dom.js";
import type { UiLabels } from "./labels.js";

export interface BlockHandleOptions {
	readonly prefix: string;
	readonly labels: UiLabels;
	/** Tutamaca tıklanınca çağrılıyor (F3-05 blok menüsü). */
	readonly onMenu?: (blockId: string, anchor: HTMLElement) => void;
	/** Ekran okuyucuya duyuru yapan kanca. */
	readonly announce?: (message: string) => void;
}

export interface BlockHandle {
	readonly element: HTMLElement;
	destroy(): void;
}

/** Sürükleme sırasında kenara yaklaşınca kaydırmayı tetikleyen eşik (px). */
const KAYDIRMA_ESIGI = 60;
/** Otomatik kaydırma hızı (px / kare). */
const KAYDIRMA_HIZI = 12;
/** Tutamaç ile bloğun arasındaki boşluk (px). */
const ARALIK = 6;

export function createBlockHandle(editor: Editor, options: BlockHandleOptions): BlockHandle {
	const element = editor.getElement();
	const doc = element.ownerDocument;
	const p = options.prefix;
	const labels = options.labels;

	const tutamac = button(doc, {
		class: `${p}handle-grip`,
		label: labels.blockHandle,
		glyph: "⠿",
		onClick: () => {
			if (hoverId !== null) options.onMenu?.(hoverId, kok);
		},
	});
	const ekle = button(doc, {
		class: `${p}handle-add`,
		label: labels.blockAdd,
		glyph: "+",
		onClick: () => altinaEkle(),
	});
	const kok = el(doc, "div", {
		class: `${p}handle`,
		attrs: { hidden: "" },
		children: [ekle, tutamac],
	});
	doc.body.append(kok);

	const gosterge = el(doc, "div", {
		class: `${p}drop-line`,
		attrs: { hidden: "", "aria-hidden": "true" },
	});
	doc.body.append(gosterge);

	/** Tutamacın şu an hangi bloğu gösterdiği. */
	let hoverId: string | null = null;
	/** Sürükleme sürüyorsa taşınan blokların aralığı. */
	let surukleme: { from: number; count: number } | null = null;
	let birakmaHedefi: number | null = null;
	let kaydirmaKaresi = 0;

	// -----------------------------------------------------------------------
	// Tutamacın konumu
	// -----------------------------------------------------------------------

	function blokBul(target: EventTarget | null): HTMLElement | null {
		const hedef = target instanceof Element ? target : null;
		const blok = hedef?.closest("[data-kalem-id]");
		return blok instanceof HTMLElement && element.contains(blok) ? blok : null;
	}

	function tutamaciGoster(blok: HTMLElement): void {
		const kutu = blok.getBoundingClientRect();
		// Ölçmek için bir kare görünür olmalı; `hidden` iken kutusu sıfır.
		kok.style.visibility = "hidden";
		kok.hidden = false;
		const genislik = kok.getBoundingClientRect().width;
		const sol = kutu.left - genislik - ARALIK;

		// Sol boşluk yetmiyorsa tutamaç hiç çıkmıyor. Metnin üstüne binmek
		// tıklamaları ve sürükleyerek seçimi yutuyor; görünmemek yeğ.
		// Boşluğu `.kalem-ui` ayırıyor, ama gömen sayfa onu ezebilir.
		if (sol < 0) {
			kok.hidden = true;
			hoverId = null;
			return;
		}

		hoverId = blok.getAttribute("data-kalem-id");
		kok.style.visibility = "";
		// Bloğun soluna, ilk satırıyla hizalı.
		kok.style.left = `${sol}px`;
		kok.style.top = `${kutu.top}px`;
	}

	function tutamaciGizle(): void {
		if (surukleme !== null) return;
		kok.hidden = true;
		hoverId = null;
	}

	const uzerinde = (event: PointerEvent): void => {
		if (editor.isReadOnly() || surukleme !== null) return;
		const blok = blokBul(event.target);
		if (blok === null) return;
		tutamaciGoster(blok);
	};

	const ayrildi = (event: PointerEvent): void => {
		// Tutamacın kendisine geçerken gizlenmemeli.
		const gidilen = event.relatedTarget;
		if (gidilen instanceof Node && (kok.contains(gidilen) || element.contains(gidilen))) return;
		tutamaciGizle();
	};

	// -----------------------------------------------------------------------
	// Sürükleme
	// -----------------------------------------------------------------------

	/** Sürüklenecek aralık: blok seçimi varsa onun tamamı, yoksa tek blok. */
	function suruklenecek(blockId: string): { from: number; count: number } | null {
		const sira = editor.getBlockIds();
		const index = sira.indexOf(blockId);
		if (index < 0) return null;

		const secim = editor.getSelection();
		if (secim?.kind === "block") {
			const a = sira.indexOf(secim.anchor);
			const b = sira.indexOf(secim.focus);
			const bas = Math.min(a, b);
			const bit = Math.max(a, b);
			// Yalnızca sürüklenen blok seçimin içindeyse tamamı taşınıyor.
			if (a >= 0 && b >= 0 && index >= bas && index <= bit) {
				return { from: bas, count: bit - bas + 1 };
			}
		}
		return { from: index, count: 1 };
	}

	/** Editörün üst düzey blok elemanları, belgedeki sırayla. */
	function blokListesi(): HTMLElement[] {
		return Array.from(element.children).filter(
			(c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-kalem-id"),
		);
	}

	/** İşaretçinin y konumuna göre bırakma indeksi. */
	function hedefBul(y: number): number {
		const bloklar = blokListesi();
		for (const [i, blok] of bloklar.entries()) {
			const kutu = blok.getBoundingClientRect();
			// Bloğun üst yarısına bırakmak "önüne", alt yarısına "arkasına".
			if (y < kutu.top + kutu.height / 2) return i;
		}
		return bloklar.length;
	}

	function gostergeyiCiz(index: number): void {
		const bloklar = blokListesi();
		const kapsayici = element.getBoundingClientRect();
		const hedef = bloklar[index];
		const y =
			hedef === undefined
				? (bloklar[bloklar.length - 1]?.getBoundingClientRect().bottom ?? kapsayici.bottom)
				: hedef.getBoundingClientRect().top;

		gosterge.hidden = false;
		gosterge.style.left = `${kapsayici.left}px`;
		gosterge.style.width = `${kapsayici.width}px`;
		gosterge.style.top = `${y - 1}px`;
	}

	/**
	 * Kenara yaklaşınca kaydırır.
	 *
	 * Uzun bir belgede sürükleme, hedef ekranın dışındayken imkânsız hâle
	 * geliyor; otomatik kaydırma bunun tek çözümü.
	 */
	function otomatikKaydir(y: number): void {
		const view = doc.defaultView;
		if (view === null) return;
		const yukari = y < KAYDIRMA_ESIGI;
		const asagi = y > view.innerHeight - KAYDIRMA_ESIGI;
		if (!yukari && !asagi) {
			view.cancelAnimationFrame(kaydirmaKaresi);
			kaydirmaKaresi = 0;
			return;
		}
		if (kaydirmaKaresi !== 0) return;
		const adim = (): void => {
			if (surukleme === null) return;
			view.scrollBy(0, yukari ? -KAYDIRMA_HIZI : KAYDIRMA_HIZI);
			kaydirmaKaresi = view.requestAnimationFrame(adim);
		};
		kaydirmaKaresi = view.requestAnimationFrame(adim);
	}

	const basildi = (event: PointerEvent): void => {
		if (editor.isReadOnly() || hoverId === null || !event.isPrimary) return;
		event.preventDefault();
		surukleme = suruklenecek(hoverId);
		if (surukleme === null) return;
		tutamac.setPointerCapture(event.pointerId);
		element.classList.add(`${p}dragging`);
	};

	const suruklendi = (event: PointerEvent): void => {
		if (surukleme === null) return;
		event.preventDefault();
		birakmaHedefi = hedefBul(event.clientY);
		gostergeyiCiz(birakmaHedefi);
		otomatikKaydir(event.clientY);
	};

	const birakildi = (): void => {
		if (surukleme === null) return;
		const { from, count } = surukleme;
		const hedef = birakmaHedefi;
		surukleme = null;
		birakmaHedefi = null;
		gosterge.hidden = true;
		element.classList.remove(`${p}dragging`);
		doc.defaultView?.cancelAnimationFrame(kaydirmaKaresi);
		kaydirmaKaresi = 0;

		if (hedef === null) return;
		editor.applyEdit(moveBlocks(editor.getDocument(), from, count, hedef));
	};

	tutamac.addEventListener("pointerdown", basildi);
	tutamac.addEventListener("pointermove", suruklendi);
	tutamac.addEventListener("pointerup", birakildi);
	tutamac.addEventListener("pointercancel", birakildi);

	// -----------------------------------------------------------------------
	// Blok ekleme
	// -----------------------------------------------------------------------

	function altinaEkle(): void {
		if (hoverId === null) return;
		const sira = editor.getBlockIds();
		const index = sira.indexOf(hoverId);
		if (index < 0) return;
		const belge = editor.getDocument();
		const children = [...belge.children];
		children.splice(index + 1, 0, newParagraph());
		editor.applyEdit({
			doc: { ...belge, children: children as typeof belge.children },
			caret: { blockIndex: index + 1, path: [], offset: 0 },
		});
	}

	// -----------------------------------------------------------------------
	// Klavye alternatifi  (F3-10)
	// -----------------------------------------------------------------------

	const klavyeEklentisi = {
		name: "ui-block-move",
		keymap: (event: KeyboardEvent): boolean => {
			if (!event.ctrlKey || !event.shiftKey) return false;
			const yon = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
			if (yon === 0) return false;
			const caret = editor.getCaret();
			if (caret === null) return false;
			const sonuc = nudgeBlock(editor.getDocument(), caret.blockIndex, yon as -1 | 1);
			if (sonuc === null) return true;
			editor.applyEdit(sonuc);
			options.announce?.(yon === -1 ? labels.movedUp : labels.movedDown);
			return true;
		},
	};
	editor.addPlugin(klavyeEklentisi);

	element.addEventListener("pointerover", uzerinde);
	element.addEventListener("pointerout", ayrildi);

	return {
		element: kok,
		destroy() {
			editor.removePlugin(klavyeEklentisi.name);
			element.removeEventListener("pointerover", uzerinde);
			element.removeEventListener("pointerout", ayrildi);
			doc.defaultView?.cancelAnimationFrame(kaydirmaKaresi);
			kok.remove();
			gosterge.remove();
		},
	};
}
