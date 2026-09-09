/**
 * @kalem/ui — Yüzen katman konumlandırma  (İş listesi: F3-01)
 *
 * ## Neden Floating UI değil
 *
 * Floating UI iyi bir kütüphane ama ~5 kB ve bize gereken kısmı bunun
 * çok küçük bir parçası: bir dikdörtgenin üstüne (yer yoksa altına) bir
 * kutu koymak ve görünür alanın dışına taşmasını engellemek. Ok
 * göstergesi, otomatik yerleşim, sanal eleman, ölçüm ara katmanı — hiçbiri
 * gerekmiyor. Analiz §5.3'ün "bağımlılık eklemeden önce ne kadarını
 * kullanacağını say" kuralı burada uygulanıyor.
 *
 * ## `position: fixed`
 *
 * Kutular belgeye değil görünür alana göre konumlanıyor. Sebebi editörün
 * kaydırmalı bir kapsayıcının içinde olabilmesi: `absolute` kullanılsaydı
 * hangi atanın konumlanmış olduğunu bulmak ve her kaydırmada yeniden
 * hesaplamak gerekirdi. `fixed` ile tek hesap yetiyor; kaydırma olduğunda
 * çağıran yeniden konumlandırıyor.
 */

export type Placement = "top" | "bottom";

export interface FloatingOptions {
	/** Tercih edilen yer; sığmazsa diğerine geçiliyor. */
	readonly placement?: Placement;
	/** Çapa ile kutu arasındaki boşluk (px). */
	readonly offset?: number;
	/** Görünür alan kenarına bırakılan pay (px). */
	readonly padding?: number;
}

export interface FloatingResult {
	readonly x: number;
	readonly y: number;
	/** Gerçekten kullanılan yer — ok/gölge yönü buna bakabilir. */
	readonly placement: Placement;
}

/**
 * Kutuyu çapanın üstüne ya da altına yerleştirir.
 *
 * Hesap saf: girdi iki dikdörtgen ve görünür alan ölçüsü, çıktı koordinat.
 * DOM'a yazma işi `position()` fonksiyonunda; ayrımın sebebi bu mantığın
 * tarayıcısız test edilebilmesi.
 */
export function computePosition(
	anchor: { top: number; bottom: number; left: number; width: number },
	box: { width: number; height: number },
	viewport: { width: number; height: number },
	options: FloatingOptions = {},
): FloatingResult {
	const offset = options.offset ?? 8;
	const padding = options.padding ?? 8;
	const tercih = options.placement ?? "top";

	const ustYer = anchor.top - box.height - offset;
	const altYer = anchor.bottom + offset;

	// Tercih edilen yere sığmıyorsa diğerine geçiliyor; ikisi de sığmıyorsa
	// tercih korunuyor ve aşağıdaki kırpma devreye giriyor.
	const ustSigar = ustYer >= padding;
	const altSigar = altYer + box.height <= viewport.height - padding;
	const placement: Placement =
		tercih === "top"
			? ustSigar || !altSigar
				? "top"
				: "bottom"
			: altSigar || !ustSigar
				? "bottom"
				: "top";

	const y = clamp(
		placement === "top" ? ustYer : altYer,
		padding,
		Math.max(padding, viewport.height - box.height - padding),
	);

	// Yatayda çapanın ortasına hizalanıp görünür alana kırpılıyor.
	const ortalanmis = anchor.left + anchor.width / 2 - box.width / 2;
	const x = clamp(ortalanmis, padding, Math.max(padding, viewport.width - box.width - padding));

	return { x, y, placement };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Kutuyu ölçüp konumlandırır.
 *
 * Kutu ölçülebilmek için görünür olmak zorunda; çağıran onu gizliyorsa
 * `visibility` ile gizlemeli, `display: none` ile değil.
 */
export function position(
	box: HTMLElement,
	anchor: DOMRect,
	options: FloatingOptions = {},
): FloatingResult {
	const view = box.ownerDocument.defaultView;
	const olcu = box.getBoundingClientRect();
	const sonuc = computePosition(
		anchor,
		{ width: olcu.width, height: olcu.height },
		{ width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 },
		options,
	);
	box.style.position = "fixed";
	box.style.left = `${Math.round(sonuc.x)}px`;
	box.style.top = `${Math.round(sonuc.y)}px`;
	box.dataset.placement = sonuc.placement;
	return sonuc;
}

/**
 * Seçimin ekrandaki dikdörtgeni.
 *
 * Çok satıra yayılan seçimde **ilk** satırın dikdörtgeni kullanılıyor:
 * tüm seçimi kapsayan kutunun ortası, kullanıcının baktığı yerden uzağa
 * düşüyor ve araç çubuğu metnin ortasında beliriyor.
 */
export function selectionRect(doc: Document): DOMRect | null {
	const selection = doc.getSelection();
	if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const range = selection.getRangeAt(0);
	const rects = range.getClientRects();
	const ilk = rects.item(0);
	if (ilk !== null && ilk.width + ilk.height > 0) return ilk;
	const kutu = range.getBoundingClientRect();
	return kutu.width + kutu.height > 0 ? kutu : null;
}
