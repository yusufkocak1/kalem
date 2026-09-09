/**
 * @kalem/ui — Blok bağlam menüsü  (İş listesi: F3-05)
 *
 * Tutamaca tıklayınca açılıyor: sil, çoğalt, kopyala, yukarı/aşağı taşı ve
 * blok türünü değiştir.
 *
 * ## Odak menüye taşınıyor — slash menünün tersine
 *
 * Slash menü odağı editörde bırakıyor ve seçili öğeyi
 * `aria-activedescendant` ile bildiriyor, çünkü kullanıcı menü açıkken
 * **yazmaya devam ediyor** (`/bas` yazarak filtreliyor). Burada yazılacak
 * bir şey yok: menü bir düğmeden açılıyor ve öğe seçilene kadar
 * klavyenin tek işi menüde gezinmek. O yüzden standart `role="menu"`
 * deseni: gerçek odak menüye giriyor, oklarla geziliyor, Escape odağı
 * geldiği düğmeye geri veriyor.
 *
 * Bu ayrım F3-05'in kabul kriterinin ta kendisi: *menü klavyeyle de
 * kullanılabiliyor.* Odağı taşımadan bir menüyü klavyeyle kullanılabilir
 * yapmak, `aria-activedescendant`ı elle yönetmek demek; menü zaten
 * yazmayı engellemiyorsa bedelini ödemeye değmiyor.
 *
 * ## Blok türü ayrı bir alt menü değil
 *
 * Türler aynı menüde, başlıklı bir grup olarak duruyor. Alt menü bir
 * gezinme seviyesi daha ekliyor (sağ ok, geri dönüş, kapanma kuralları)
 * ve altı öğe için o karmaşıklık kazanç getirmiyor.
 */
import type { NodeId } from "@kalem/core";
import type { BlockType } from "@kalem/core/commands";
import type { Editor } from "@kalem/editor";
import { blocksPayload, deleteBlocks, duplicateBlocks, nudgeBlock } from "@kalem/editor";
import { el, themed } from "./dom.js";
import { position } from "./floating.js";
import type { UiLabels } from "./labels.js";

export interface BlockMenuOptions {
	readonly prefix: string;
	readonly labels: UiLabels;
	/** Ekran okuyucuya duyuru yapan kanca. */
	readonly announce?: (message: string) => void;
	/** Menü kapandığında çağrılıyor. */
	readonly onClose?: () => void;
}

export interface BlockMenu {
	readonly element: HTMLElement;
	/** Menüyü `anchor`ın yanında, `blockId` bloğu için açar. */
	open(blockId: NodeId, anchor: HTMLElement): void;
	close(): void;
	isOpen(): boolean;
	destroy(): void;
}

interface MenuItem {
	readonly id: string;
	readonly label: string;
	readonly glyph: string;
	/** Grup başlığı — aynı başlığı taşıyan ardışık öğeler birlikte çiziliyor. */
	readonly group?: string;
	run(index: number): void;
}

export function createBlockMenu(editor: Editor, options: BlockMenuOptions): BlockMenu {
	const doc = editor.getElement().ownerDocument;
	const p = options.prefix;
	const labels = options.labels;

	const root = el(doc, "div", {
		class: `${p}menu ${p}block-menu`,
		attrs: { hidden: "", role: "menu", "aria-label": labels.blockMenu },
	});
	doc.body.append(themed(root, p));

	/** Menü açıkken hangi blok için açıldığı. */
	let hedefId: NodeId | null = null;
	/** Menüyü açan düğme — Escape odağı buraya geri veriyor. */
	let acan: HTMLElement | null = null;
	let secili = 0;
	let ogeler: MenuItem[] = [];

	// -----------------------------------------------------------------------
	// Öğeler
	// -----------------------------------------------------------------------

	function blokIndeksi(): number {
		return hedefId === null ? -1 : editor.getBlockIds().indexOf(hedefId);
	}

	/** Bloğun Markdown karşılığını panoya yazar. */
	async function kopyala(index: number): Promise<void> {
		const blok = editor.getDocument().children[index];
		if (blok === undefined) return;
		const { text, html } = blocksPayload({ type: "root", children: [blok] });
		try {
			// `ClipboardItem` biçimli yapıştırmayı koruyor; olmayan yerde
			// düz metin hâlâ çalışıyor.
			const view = doc.defaultView;
			if (view !== null && "ClipboardItem" in view) {
				await doc.defaultView?.navigator.clipboard.write([
					new view.ClipboardItem({
						"text/plain": new Blob([text], { type: "text/plain" }),
						"text/html": new Blob([html], { type: "text/html" }),
					}),
				]);
			} else {
				await doc.defaultView?.navigator.clipboard.writeText(text);
			}
			options.announce?.(labels.blockCopied);
		} catch {
			// Pano izni yoksa sessizce vazgeçiliyor: kullanıcıya
			// gösterilecek bir çare yok ve hata diyaloğu işe yaramıyor.
		}
	}

	function turDegistir(index: number, tur: BlockType): void {
		editor.selectBlocks(editor.getBlockIds()[index] as NodeId);
		editor.setBlockType(tur);
	}

	function menuOgeleri(): MenuItem[] {
		const turler: readonly (readonly [string, BlockType, string, string])[] = [
			["paragraph", { type: "paragraph" }, labels.paragraph, "¶"],
			["heading-1", { type: "heading", depth: 1 }, labels.heading1, "H1"],
			["heading-2", { type: "heading", depth: 2 }, labels.heading2, "H2"],
			["heading-3", { type: "heading", depth: 3 }, labels.heading3, "H3"],
			["quote", { type: "blockquote" }, labels.quote, "❝"],
			["code", { type: "code" }, labels.codeBlock, "</>"],
		];

		return [
			{
				id: "duplicate",
				label: labels.duplicate,
				glyph: "⧉",
				group: labels.blockActions,
				run: (i) => {
					if (editor.applyEdit(duplicateBlocks(editor.getDocument(), i))) {
						options.announce?.(labels.blockDuplicated);
					}
				},
			},
			{
				id: "copy",
				label: labels.copy,
				glyph: "⎘",
				group: labels.blockActions,
				run: (i) => void kopyala(i),
			},
			{
				id: "move-up",
				label: labels.moveUp,
				glyph: "↑",
				group: labels.blockActions,
				run: (i) => {
					if (editor.applyEdit(nudgeBlock(editor.getDocument(), i, -1))) {
						options.announce?.(labels.movedUp);
					}
				},
			},
			{
				id: "move-down",
				label: labels.moveDown,
				glyph: "↓",
				group: labels.blockActions,
				run: (i) => {
					if (editor.applyEdit(nudgeBlock(editor.getDocument(), i, 1))) {
						options.announce?.(labels.movedDown);
					}
				},
			},
			{
				id: "delete",
				label: labels.delete,
				glyph: "🗑",
				group: labels.blockActions,
				run: (i) => {
					if (editor.applyEdit(deleteBlocks(editor.getDocument(), i))) {
						options.announce?.(labels.blockDeleted);
					}
				},
			},
			...turler.map(([id, tur, ad, simge]) => ({
				id: `type-${id}`,
				label: ad,
				glyph: simge,
				group: labels.blockType,
				run: (i: number) => turDegistir(i, tur),
			})),
		];
	}

	// -----------------------------------------------------------------------
	// Çizim
	// -----------------------------------------------------------------------

	function ciz(): void {
		root.replaceChildren();
		let oncekiGrup: string | undefined;

		for (const [i, oge] of ogeler.entries()) {
			if (oge.group !== undefined && oge.group !== oncekiGrup) {
				oncekiGrup = oge.group;
				root.append(
					el(doc, "div", {
						class: `${p}menu-group`,
						text: oge.group,
						attrs: { role: "presentation" },
					}),
				);
			}

			const satir = el(doc, "button", {
				class: `${p}menu-item`,
				attrs: {
					type: "button",
					role: "menuitem",
					// Roving tabindex: menüde her an tek bir odaklanabilir öğe
					// var, yani Tab menüden **çıkıyor**, içinde dolaşmıyor.
					tabindex: i === secili ? "0" : "-1",
				},
				children: [
					el(doc, "span", {
						class: `${p}menu-glyph`,
						text: oge.glyph,
						attrs: { "aria-hidden": "true" },
					}),
					el(doc, "span", { class: `${p}menu-label`, text: oge.label }),
				],
			});
			satir.addEventListener("click", () => calistir(i));
			root.append(satir);
		}
	}

	function satirlar(): HTMLElement[] {
		return Array.from(root.querySelectorAll<HTMLElement>(`.${p}menu-item`));
	}

	function odakla(index: number): void {
		const liste = satirlar();
		if (liste.length === 0) return;
		secili = (index + liste.length) % liste.length;
		for (const [i, satir] of liste.entries()) {
			satir.tabIndex = i === secili ? 0 : -1;
		}
		liste[secili]?.focus();
	}

	function calistir(index: number): void {
		const oge = ogeler[index];
		const blok = blokIndeksi();
		close();
		if (oge === undefined || blok < 0) return;
		oge.run(blok);
	}

	// -----------------------------------------------------------------------
	// Açma / kapama
	// -----------------------------------------------------------------------

	function open(blockId: NodeId, anchor: HTMLElement): void {
		if (editor.isReadOnly()) return;
		hedefId = blockId;
		acan = anchor;
		ogeler = menuOgeleri();
		secili = 0;
		ciz();
		root.hidden = false;
		position(root, anchor.getBoundingClientRect(), { placement: "bottom", offset: 4 });
		odakla(0);
	}

	function close(): void {
		if (root.hidden) return;
		root.hidden = true;
		hedefId = null;
		// Odak menüyle birlikte kaybolmamalı: kullanıcı klavyeyle geldiyse
		// nereye döneceğini bilmeli.
		const geri = acan;
		acan = null;
		if (geri !== null && doc.contains(geri)) geri.focus();
		else editor.focus();
		options.onClose?.();
	}

	// -----------------------------------------------------------------------
	// Klavye
	// -----------------------------------------------------------------------

	const tus = (event: KeyboardEvent): void => {
		if (root.hidden) return;
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				odakla(secili + 1);
				break;
			case "ArrowUp":
				event.preventDefault();
				odakla(secili - 1);
				break;
			case "Home":
				event.preventDefault();
				odakla(0);
				break;
			case "End":
				event.preventDefault();
				odakla(satirlar().length - 1);
				break;
			case "Escape":
				event.preventDefault();
				close();
				break;
			case "Tab":
				// Tab menüden çıkıyor; açık bırakmak odağı arkada bırakırdı.
				close();
				break;
			default:
				break;
		}
	};
	root.addEventListener("keydown", tus);

	/**
	 * Dışarı tıklamak kapatıyor.
	 *
	 * `pointerdown` dinleniyor, `click` değil: menüyü açan düğmeye tekrar
	 * basmak `click`te önce kapatıp sonra yeniden açardı.
	 */
	const disariTikla = (event: PointerEvent): void => {
		if (root.hidden) return;
		const hedef = event.target;
		if (hedef instanceof Node && (root.contains(hedef) || acan?.contains(hedef) === true)) return;
		close();
	};
	doc.addEventListener("pointerdown", disariTikla, true);

	return {
		element: root,
		open,
		close,
		isOpen: () => !root.hidden,
		destroy() {
			doc.removeEventListener("pointerdown", disariTikla, true);
			root.remove();
		},
	};
}
