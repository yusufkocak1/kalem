/**
 * @kalem-editor/editor — Blok kimlikleri  (İş listesi: F2-05)
 *
 * ## Kimlik neye yarıyor
 *
 * Model ile DOM arasındaki köprü. Bir blok düzenlendiğinde onun DOM
 * elemanı **yeniden kurulmaz**, yerinde güncellenir; hangi elemanın hangi
 * bloğa ait olduğunu kimlik söyler. Kimlik olmasa her değişiklikte tüm
 * ağaç yeniden kurulur, imleç kaybolur ve IME bileşimi bozulur.
 *
 * ## Neden `id` alanı AST'de zaten var
 *
 * `NodeBase.id` F1-01'de tam bu ihtiyaç için açılmıştı: isteğe bağlı,
 * ayrıştırıcı doldurmuyor, serileştirici yok sayıyor. Yani kimlik
 * Markdown çıktısına sızmıyor.
 */
import type { NodeId, Root } from "@kalem-editor/core";

/**
 * Sayaç tabanlı kimlik.
 *
 * `crypto.randomUUID` kullanılmadı: `@kalem-editor/editor` tarayıcı paketidir ama
 * kimliklerin evrensel benzersiz olması gerekmiyor — tek bir belge içinde
 * benzersiz olmaları yeter. Sayaç hem daha kısa hem test edilebilir
 * (rastgelelik yok, aynı girdi aynı kimlikleri verir).
 *
 * Sayaç editör örneğine değil modüle ait: aynı sayfadaki iki editör
 * arasında kimlik çakışması, birinin bloğunu diğerinin DOM'unda arayan
 * bir hataya dönüşürdü.
 */
let sayac = 0;

export function newId(): NodeId {
	sayac += 1;
	return `k${sayac}`;
}

/** Test yalıtımı için sayacı sıfırlar. Üretim yolunda çağrılmaz. */
export function resetIds(): void {
	sayac = 0;
}

/**
 * Kimliksiz üst düzey bloklara kimlik verir.
 *
 * Ağaç **yerinde değiştirilmez**: kimlik gerektiren blok varsa yeni bir kök
 * döner, yoksa aynı kök geri verilir. Değişmezlik editörün her yerinde
 * varsayılıyor (geçmiş yığını, render atlaması); burada bozmak sessiz
 * hatalara yol açardı.
 */
export function assignIds(doc: Root): Root {
	let degisti = false;
	const children = doc.children.map((child) => {
		if (child.id !== undefined) return child;
		degisti = true;
		return { ...child, id: newId() };
	});
	return degisti ? { ...doc, children: children as Root["children"] } : doc;
}
