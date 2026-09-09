/**
 * @kalem/plugin-image-upload — Alt metin düzenleme  (İş listesi: F4-01)
 *
 * Görsele tıklayınca açılan küçük alan. Tek iş yapıyor: alt metni okumak
 * ve yazmak.
 *
 * ## Neden `@kalem/ui`ye bağlanmıyor
 *
 * `@kalem/ui` bu iş için hazır bir popover ve konumlandırma taşıyor. Ama
 * eklentinin ona bağlanması, kendi arayüzünü yazan bir uygulamanın görsel
 * yüklemeyi almak için bütün arayüz katmanını indirmesi demek. Buradaki
 * kutu üç satırlık bir yerleştirme hesabı; o bedeli hak etmiyor.
 *
 * ## Neden zorunlu değil ama teşvik ediliyor
 *
 * Alt metin olmadan da geçerli bir Markdown çıkıyor; kullanıcıyı bir
 * diyaloğa hapsetmek yazmayı durdurur. Bunun yerine alt metni boş görsel
 * `plugin-image.css` içinde işaretleniyor ve kutu açıldığında yer tutucu
 * "bu görseli tarif edin" diyor.
 */
import type { PluginContext } from "@kalem/editor";
import type { ImageLabels } from "./labels.js";

export interface AltEditor {
	destroy(): void;
}

export interface AltEditorOptions {
	readonly prefix: string;
	readonly labels: ImageLabels;
	/** Görselin alt metnini okuyor — belge sırasına göre n. görsel. */
	readonly readAlt: (index: number) => string | null;
	/** Yeni alt metni yazıyor. */
	readonly writeAlt: (index: number, alt: string) => void;
}

export function createAltEditor(ctx: PluginContext, options: AltEditorOptions): AltEditor {
	const doc = ctx.element.ownerDocument;
	const p = options.prefix;

	const input = doc.createElement("input");
	input.type = "text";
	input.className = `${p}alt-input`;
	input.setAttribute("aria-label", options.labels.altLabel);
	input.placeholder = options.labels.altMissing;

	const kutu = doc.createElement("div");
	kutu.className = `${p}menu ${p}theme ${p}alt-editor`;
	kutu.hidden = true;
	kutu.append(input);
	doc.body.append(kutu);

	/** Açıkken hangi görselin düzenlendiği (belge sırasına göre indeks). */
	let hedef: number | null = null;

	function ac(index: number, gorsel: HTMLElement): void {
		if (ctx.isReadOnly()) return;
		hedef = index;
		input.value = options.readAlt(index) ?? "";
		kutu.hidden = false;

		const kutuOlcu = kutu.getBoundingClientRect();
		const olcu = gorsel.getBoundingClientRect();
		const view = doc.defaultView;
		// Görselin altına; sığmıyorsa üstüne.
		const altta = olcu.bottom + 6;
		const sigar = view === null || altta + kutuOlcu.height < view.innerHeight;
		kutu.style.left = `${Math.max(4, olcu.left)}px`;
		kutu.style.top = `${sigar ? altta : Math.max(4, olcu.top - kutuOlcu.height - 6)}px`;
		input.focus();
		input.select();
	}

	function kapat(kaydet: boolean): void {
		if (kutu.hidden) return;
		const index = hedef;
		kutu.hidden = true;
		hedef = null;
		if (kaydet && index !== null) options.writeAlt(index, input.value.trim());
	}

	/** Tıklanan `<img>` belge sırasına göre kaçıncı. */
	function indeksBul(target: EventTarget | null): { index: number; el: HTMLElement } | null {
		if (!(target instanceof HTMLImageElement)) return null;
		const hepsi = Array.from(ctx.element.querySelectorAll("img"));
		const index = hepsi.indexOf(target);
		return index < 0 ? null : { index, el: target };
	}

	const tiklandi = (event: MouseEvent): void => {
		const bulunan = indeksBul(event.target);
		if (bulunan === null) return;
		// Görsele tıklamak imleci içine koymaya çalışıyor; engellenmezse
		// kutu açılır açılmaz odak editöre geri dönüyor.
		event.preventDefault();
		ac(bulunan.index, bulunan.el);
	};

	const tus = (event: KeyboardEvent): void => {
		if (event.key === "Enter") {
			event.preventDefault();
			kapat(true);
			ctx.element.focus();
		} else if (event.key === "Escape") {
			event.preventDefault();
			kapat(false);
			ctx.element.focus();
		}
	};

	// Dışarı tıklamak kaydederek kapatıyor: kullanıcı yazdığını kaybetmemeli.
	const disari = (event: PointerEvent): void => {
		if (kutu.hidden) return;
		const t = event.target;
		if (t instanceof Node && (kutu.contains(t) || t instanceof HTMLImageElement)) return;
		kapat(true);
	};

	ctx.element.addEventListener("click", tiklandi);
	input.addEventListener("keydown", tus);
	doc.addEventListener("pointerdown", disari, true);

	return {
		destroy() {
			ctx.element.removeEventListener("click", tiklandi);
			input.removeEventListener("keydown", tus);
			doc.removeEventListener("pointerdown", disari, true);
			kutu.remove();
		},
	};
}
