/**
 * @kalem/ui — Ekran okuyucu duyuruları  (İş listesi: F3-04, F3-10)
 *
 * Görsel olmayan bir geri bildirim kanalı. Blok taşımak, silmek, biçim
 * uygulamak — hepsi ekranda görülüyor ama ekran okuyucuya hiçbir şey
 * söylemiyor: `contenteditable` içinde değişen DOM, odak taşınmadığı
 * sürece duyurulmuyor.
 *
 * ## `polite`, `assertive` değil
 *
 * Duyurular kullanıcının **kendi** eyleminin sonucu; okumakta olduğu
 * cümleyi kesmeyi hak edecek bir aciliyet yok.
 *
 * ## Neden aynı metin iki kez duyurulabiliyor
 *
 * Aynı dizeyi ikinci kez yazmak çoğu ekran okuyucuda hiç okunmuyor —
 * "blok yukarı taşındı" iki kez basılınca ikincisi sessiz kalıyor.
 * Metnin sonuna görünmez bir sayaç eklemek yerine bölge önce
 * boşaltılıyor ve bir kare sonra dolduruluyor: sayaç, metni kopyalayan
 * kullanıcıya sızardı.
 */
import { el } from "./dom.js";

export interface LiveRegion {
	/** Metni duyurur. */
	announce(message: string): void;
	destroy(): void;
}

export function createLiveRegion(doc: Document, prefix: string): LiveRegion {
	const bolge = el(doc, "div", {
		class: `${prefix}live`,
		attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
	});
	doc.body.append(bolge);
	let zamanlayici = 0;

	return {
		announce(message) {
			doc.defaultView?.clearTimeout(zamanlayici);
			bolge.textContent = "";
			zamanlayici = doc.defaultView?.setTimeout(() => {
				bolge.textContent = message;
			}, 50) as unknown as number;
		},
		destroy() {
			doc.defaultView?.clearTimeout(zamanlayici);
			bolge.remove();
		},
	};
}
