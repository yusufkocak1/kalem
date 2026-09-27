/**
 * @kalem-editor/editor — DOM konumu ↔ karakter ofseti  (İş listesi: F2-07)
 *
 * ## Neden gerekli
 *
 * Biçimlendirme **modelde** yapılıyor: seçili aralık `Inline[]` üzerinde
 * kesiliyor, `toggleMark` uygulanıyor, blok yeniden basılıyor. Bunun için
 * tarayıcının seçimini modelin anladığı bir şeye çevirmek gerekiyor —
 * "şu metin düğümünün 3. karakteri" değil, "bloğun başından 17. karakter".
 *
 * Alternatif `document.execCommand("bold")` idi. Reddedildi: kullanımdan
 * kaldırılmış, üç tarayıcıda üç farklı HTML üretiyor, `inlineCode` gibi
 * kendi biçimlerimizi hiç bilmiyor ve sonucu modele geri okumak yine bu
 * dosyadaki işi gerektiriyordu.
 *
 * ## Ölçü birimi
 *
 * Metin karakteri = 1, `<br>` = 1 (modelde `break` düğümü), `<img>` = 1
 * (modelde görsel), görev kutusu = 0. Model tarafındaki uzunluk hesabı
 * (`inline-edit.ts`) **aynı** kurala uymak zorunda; ayrışırlarsa seçim
 * kayar.
 *
 * Görsel eskiden 0'dı. Sonucu: imleç görselin iki yanında **aynı** ofsete
 * düşüyordu, yani kullanıcı görselin yanına imleç koyamıyor, onu seçemiyor
 * ve Backspace ile silemiyordu (F4-01'de bulundu). Tek karakterlik atomik
 * bir öğe olarak sayılınca üçü de metin karakteri gibi çalışıyor.
 */

const ELEMENT = 1;
const TEXT = 3;

/** Ofset hesabında görünmez sayılan elemanlar. */
const ATLANAN = new Set(["INPUT"]);

/** Tek karakter sayılan, içine imleç girmeyen elemanlar. */
const ATOMIK = new Set(["BR", "IMG"]);

/** Bir DOM düğümünün ofset uzunluğu (alt ağacı dâhil). */
function uzunluk(node: Node): number {
	if (node.nodeType === TEXT) return (node.nodeValue ?? "").length;
	if (node.nodeType !== ELEMENT) return 0;
	if (ATOMIK.has(node.nodeName)) return 1;
	if (ATLANAN.has(node.nodeName)) return 0;
	let out = 0;
	for (const child of Array.from(node.childNodes)) out += uzunluk(child);
	return out;
}

/**
 * Bir seçim sınırının kök içindeki karakter ofseti.
 *
 * Sınır bir eleman üzerinde olabilir (`node` eleman, `offset` çocuk indisi);
 * o zaman ondan önceki çocukların uzunlukları toplanıyor.
 */
export function offsetOf(root: Element, node: Node, offset: number): number {
	let out = 0;

	if (node.nodeType === TEXT) {
		out = Math.min(offset, (node.nodeValue ?? "").length);
	} else if (node.nodeType === ELEMENT) {
		const children = Array.from(node.childNodes);
		for (let i = 0; i < Math.min(offset, children.length); i++) {
			out += uzunluk(children[i] as Node);
		}
	}

	// Kökten bu düğüme kadar, soldaki kardeşleri topla.
	let current: Node | null = node;
	while (current !== null && current !== root) {
		let sibling: Node | null = current.previousSibling;
		while (sibling !== null) {
			out += uzunluk(sibling);
			sibling = sibling.previousSibling;
		}
		current = current.parentNode;
	}
	// Düğüm kökün altında değilse ölçüm anlamsız.
	return current === root ? out : 0;
}

export interface DomPoint {
	readonly node: Node;
	readonly offset: number;
}

/**
 * Karakter ofsetini DOM konumuna çevirir.
 *
 * Aralığın sonunda kalınırsa kökün sonu veriliyor: hedef ofset içeriğin
 * uzunluğunu aşabilir (model kısaldı, seçim eski) ve o durumda imleci
 * kaybetmektense sona koymak doğru.
 */
export function pointAt(root: Element, target: number): DomPoint {
	const durum = { kalan: Math.max(0, target) };
	const bulunan = ara(root, durum);
	if (bulunan !== null) return bulunan;
	return { node: root, offset: root.childNodes.length };
}

function ara(node: Node, durum: { kalan: number }): DomPoint | null {
	if (node.nodeType === TEXT) {
		const len = (node.nodeValue ?? "").length;
		if (durum.kalan <= len) return { node, offset: durum.kalan };
		durum.kalan -= len;
		return null;
	}
	if (node.nodeType !== ELEMENT) return null;

	if (ATOMIK.has(node.nodeName)) {
		// Hedef öğenin önündeyse konum ebeveynde, öğenin indisinde.
		const parent = node.parentNode;
		if (durum.kalan === 0 && parent !== null) {
			return { node: parent, offset: Array.from(parent.childNodes).indexOf(node as ChildNode) };
		}
		durum.kalan -= 1;
		return null;
	}
	if (ATLANAN.has(node.nodeName)) return null;

	for (const child of Array.from(node.childNodes)) {
		const found = ara(child, durum);
		if (found !== null) return found;
	}
	return null;
}

/** Kök içindeki toplam karakter sayısı. */
export function contentLength(root: Element): number {
	return uzunluk(root);
}

/** Seçimi kök içinde verilen karakter aralığına kurar. */
export function selectRange(root: HTMLElement, from: number, to: number): void {
	const doc = root.ownerDocument;
	const selection = doc.getSelection();
	if (selection === null) return;

	const bas = pointAt(root, from);
	const bit = pointAt(root, to);
	const range = doc.createRange();
	range.setStart(bas.node, bas.offset);
	range.setEnd(bit.node, bit.offset);
	selection.removeAllRanges();
	selection.addRange(range);
}
