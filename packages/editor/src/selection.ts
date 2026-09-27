/**
 * @kalem-editor/editor — Seçim modeli  (İş listesi: F2-06)
 *
 * ## İki seviyeli seçim
 *
 * ```
 * blok içi   → tarayıcının kendi `Selection`'ı     (bedava, IME dâhil)
 * bloklar arası → kendi `BlockSelection`'ımız      (görsel vurgu bizden)
 * ```
 *
 * Bölünmenin sebebi `contenteditable`'ın blok başına verilmesi (F2-05).
 * Tek bir blok içindeyken tarayıcı her şeyi doğru yapıyor — karakter
 * sınırları, çift tıklama, IME, mobil dokunmatik tutamaçlar; taklit
 * etmeye kalkmak bunların hepsini bozardı.
 *
 * Bloklar arasına geçildiği anda tarayıcı **düzenlemeyi bırakıyor**:
 * seçim iki ayrı düzenleme kökünü kapsadığı için ne siliyor ne
 * değiştiriyor, yalnızca vurguluyor. Boşluk tam olarak burada başlıyor ve
 * bu dosya onu dolduruyor.
 *
 * ## Neden `selectionchange`
 *
 * Seçim fare, klavye, dokunmatik, IME ve programatik yollarla değişir.
 * `mouseup` + `keyup` dinlemek bunların yarısını kaçırır; `selectionchange`
 * belgede seçim değiştiren **her** şeyi bildirir. Bedeli sık tetiklenmesi,
 * o yüzden işleyicinin ucuz olması gerekiyor.
 */
import type { NodeId } from "@kalem-editor/core";
import { ID_ATTR } from "./render.js";

/** İmleç ya da seçim tek bir bloğun içinde; ayrıntısı tarayıcıda. */
export interface TextSelection {
	readonly kind: "text";
	readonly blockId: NodeId;
	/** Seçim boş mu (yalnızca imleç). */
	readonly collapsed: boolean;
}

/**
 * Seçim birden çok bloğu kapsıyor.
 *
 * `anchor` seçimin başladığı, `focus` bittiği blok. Sıra korunuyor:
 * kullanıcı yukarı doğru seçtiyse `anchor` belgede `focus`tan sonradır ve
 * Shift+Ok ile genişletme bu yönü bilmek zorunda.
 */
export interface BlockSelection {
	readonly kind: "block";
	readonly anchor: NodeId;
	readonly focus: NodeId;
}

export type EditorSelection = TextSelection | BlockSelection | null;

/** İki seçim aynı mı — gereksiz yeniden çizimi önlemek için. */
export function sameSelection(a: EditorSelection, b: EditorSelection): boolean {
	if (a === null || b === null) return a === b;
	if (a.kind !== b.kind) return false;
	if (a.kind === "text" && b.kind === "text") {
		return a.blockId === b.blockId && a.collapsed === b.collapsed;
	}
	if (a.kind === "block" && b.kind === "block") {
		return a.anchor === b.anchor && a.focus === b.focus;
	}
	return false;
}

/**
 * Bir seçim sınırının hangi bloğa düştüğünü bulur.
 *
 * `side` neden gerekli: kapsayıcının kendisi sınır düğümü olduğunda
 * `offset` **çocuklar arası boşluğu** gösterir, çocuğu değil. Aralığın
 * bitişi "2. bloktan sonra" ise `offset` 3'tür; bunu düzeltmeden okumak
 * seçime bir fazla blok katar — `selectBlocks(b0, b1)` üç blok seçerdi.
 *
 * Kapsayıcının sınır düğümü olması nadir değil: `<hr>` gibi düzenlenemez
 * bir bloğu seçmenin ya da `setStartBefore`/`setEndAfter` ile programatik
 * aralık kurmanın normal sonucu.
 */
export function blockElementOf(
	node: Node | null,
	offset: number,
	root: HTMLElement,
	side: "start" | "end" = "start",
): HTMLElement | null {
	if (node === null) return null;

	if (node === root) {
		const index = side === "end" ? offset - 1 : offset;
		const sinirli = Math.max(0, Math.min(index, root.childNodes.length - 1));
		const child = root.childNodes[sinirli];
		return child instanceof HTMLElement ? child : null;
	}

	const element = node instanceof Element ? node : node.parentElement;
	const blok = element?.closest(`[${ID_ATTR}]`);
	// Editörün dışındaki bir seçim bizi ilgilendirmiyor.
	if (!(blok instanceof HTMLElement) || !root.contains(blok)) return null;
	return blok;
}

const id = (element: HTMLElement): NodeId => element.getAttribute(ID_ATTR) ?? "";

/**
 * Belgedeki güncel seçimi editör modeline çevirir.
 *
 * `anchorNode`/`focusNode` yerine **aralığın** başı ve sonu okunuyor:
 * yalnız anchor/focus ile sınırın hangi tarafta olduğu bilinemez ve
 * yukarıdaki `side` düzeltmesi uygulanamaz. Yön ise anchor'ın aralığın
 * başında mı sonunda mı durduğuna bakılarak geri kazanılıyor.
 */
export function readSelection(root: HTMLElement): EditorSelection {
	const selection = root.ownerDocument.getSelection();
	if (selection === null || selection.rangeCount === 0) return null;

	const range = selection.getRangeAt(0);
	const bas = blockElementOf(range.startContainer, range.startOffset, root, "start");
	const bit = blockElementOf(range.endContainer, range.endOffset, root, "end");
	if (bas === null || bit === null) return null;

	if (bas === bit) {
		return { kind: "text", blockId: id(bas), collapsed: selection.isCollapsed };
	}

	const geriye =
		selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
	return geriye
		? { kind: "block", anchor: id(bit), focus: id(bas) }
		: { kind: "block", anchor: id(bas), focus: id(bit) };
}

/**
 * Seçimin kapsadığı blokları belge sırasıyla verir.
 *
 * `anchor` ve `focus` yönü burada normalleştiriliyor: yukarı doğru seçim
 * de aşağı doğru seçim de aynı listeyi vermeli.
 */
export function selectedRange(
	selection: BlockSelection,
	order: readonly NodeId[],
): readonly NodeId[] {
	const a = order.indexOf(selection.anchor);
	const b = order.indexOf(selection.focus);
	if (a < 0 || b < 0) return [];
	return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * İmleci bir bloğun başına ya da sonuna koyar.
 *
 * Silme sonrası imlecin nereye gideceği kullanıcının en çok fark ettiği
 * şeylerden biri; hiçbir yere konmazsa odak kaybolur ve yazmaya devam
 * edilemez.
 */
export function placeCaret(element: HTMLElement, position: "start" | "end"): void {
	const doc = element.ownerDocument;
	const selection = doc.getSelection();
	if (selection === null) return;

	const range = doc.createRange();
	range.selectNodeContents(element);
	range.collapse(position === "start");
	selection.removeAllRanges();
	selection.addRange(range);
	element.focus({ preventScroll: true });
}
