/**
 * @kalem-editor/ui — Yer tutucu ve boş durum  (İş listesi: F3-08)
 *
 * ## Neden CSS, neden DOM değil
 *
 * İpucu metni `::before` ile çiziliyor, gerçek bir düğüm olarak değil.
 * Sebebi düzenlenebilir alana metin koymanın iki yan etkisi: metin
 * seçilebilir hâle geliyor ve `readInline` onu **içerik sanıyor**.
 * `content` ile çizilen metin DOM'da yok, yani modele de giremez.
 *
 * ## Ne zaman görünüyor
 *
 * Belge boşken (tek bir boş paragraf) **ve** düzenlenebilirken. Odak
 * gerekmiyor: F3-08'in şartı "ipucu odaklanınca kaybolmuyor, yazınca
 * kayboluyor". Odakta gizlemek, kullanıcı tıklar tıklamaz ipucunu
 * kaybettiriyor — oysa okumaya en çok o an ihtiyacı var.
 */
import type { Editor } from "@kalem-editor/editor";

export interface PlaceholderOptions {
	readonly prefix: string;
	readonly text: string;
}

export interface Placeholder {
	update(): void;
	destroy(): void;
}

export function createPlaceholder(editor: Editor, options: PlaceholderOptions): Placeholder {
	const element = editor.getElement();
	const sinif = `${options.prefix}empty`;

	// Metin CSS'e `--kalem-placeholder` değişkeniyle geçiyor: sözlük
	// değişince (dil değişimi) stil dosyasına dokunmak gerekmiyor.
	element.style.setProperty("--kalem-placeholder", JSON.stringify(options.text));

	function update(): void {
		element.classList.toggle(sinif, bosMu(editor));
	}

	update();
	const sok = [editor.on("change", update), editor.on("selectionchange", update)];

	return {
		update,
		destroy() {
			for (const s of sok) s();
			element.classList.remove(sinif);
			element.style.removeProperty("--kalem-placeholder");
		},
	};
}

/**
 * Belge boş mu.
 *
 * "Boş" = tek bir blok ve o blok içeriksiz bir paragraf. İki boş paragraf
 * varsa kullanıcı Enter'a basmıştır; artık boş bir belgeye değil, boş bir
 * satıra bakıyordur ve ipucu oraya ait değil.
 */
function bosMu(editor: Editor): boolean {
	const children = editor.getDocument().children;
	if (children.length !== 1) return false;
	const ilk = children[0];
	return ilk?.type === "paragraph" && ilk.children.length === 0;
}
