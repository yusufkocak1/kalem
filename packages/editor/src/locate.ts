/**
 * @kalem/editor — Model konumundan DOM elemanına  (İş listesi: F4-04)
 *
 * Editörün çizdiği yapı üç öznitelikle işaretli (`render.ts`): blok
 * elemanında `data-kalem-id`, satır içi taşıyıcıda `data-kalem-path`,
 * kaynak metin bloğunda `data-kalem-code`. Öznitelik adları zaten dışa
 * açık (`ID_ATTR`, `PATH_ATTR`, `CODE_ATTR`); buradaki iki fonksiyon
 * onların üstündeki aramayı da açıyor.
 *
 * ## Neden eklendi
 *
 * Eklentiler modelde çalışıp DOM'da bir şey göstermek istediklerinde hep
 * aynı adımı atıyorlar: "şu imleç konumunun elemanı hangisi". F4-03'te
 * (bul-değiştir) eşleşmeyi boyamak ve panel kapanırken odağı geri vermek,
 * F4-04'te (içindekiler) başlığa atlamak için gerekti. İki eklentinin
 * aynı on satırı kopyalaması, `render.ts`in işaretleme biçimi
 * değiştiğinde ikisinin birden **sessizce** bozulması demekti.
 *
 * Eklentiler birbirine bağlanamıyor (her biri bağımsız bir paket), yani
 * ortak yer ancak burası olabilirdi.
 *
 * ## Editörün kendi araması neden duruyor
 *
 * `editor.ts` içinde benzer bir özel fonksiyon var ve yalnızca
 * `data-kalem-path`e bakıyor. Buradakini oraya bağlamak, kod bloklarında
 * imleç davranışını değiştirirdi — muhtemelen iyi yönde, ama ölçülmesi
 * gereken ayrı bir iş.
 */
import { CODE_ATTR, ID_ATTR, PATH_ATTR } from "./render.js";

/**
 * Kimliğiyle üst düzey blok elemanı.
 *
 * Kimlikler `ids.ts`in ürettiği ASCII dizeler ama seçiciye giren her
 * değer kaçırılıyor: gömen uygulama belgeyi kendi ürettiği kimliklerle
 * kurabiliyor.
 */
export function blockElementOf(root: ParentNode, id: string): HTMLElement | null {
	const kacir = (root as Document).defaultView?.CSS?.escape ?? globalThis.CSS?.escape;
	const guvenli = kacir === undefined ? id : kacir(id);
	const el = root.querySelector(`[${ID_ATTR}="${guvenli}"]`);
	return el instanceof HTMLElement ? el : null;
}

/**
 * Blok elemanı içinde, yolun gösterdiği içerik taşıyıcısı.
 *
 * İki öznitelik de deneniyor: paragraf/başlık/hücre `data-kalem-path`
 * taşıyor, kod ve ham metin blokları `data-kalem-code`. Yol boşsa
 * taşıyıcı bloğun kendisi olabiliyor (üst düzey paragraf).
 */
export function holderIn(blockElement: HTMLElement, path: readonly number[]): HTMLElement | null {
	const aranan = path.join(".");
	for (const attr of [PATH_ATTR, CODE_ATTR]) {
		if (blockElement.getAttribute(attr) === aranan) return blockElement;
		const bulunan = blockElement.querySelector(`[${attr}="${aranan}"]`);
		if (bulunan instanceof HTMLElement) return bulunan;
	}
	return null;
}

/** Blok kimliği + yol → taşıyıcı eleman. */
export function holderFor(
	root: ParentNode,
	blockId: string,
	path: readonly number[],
): HTMLElement | null {
	const blok = blockElementOf(root, blockId);
	return blok === null ? null : holderIn(blok, path);
}
