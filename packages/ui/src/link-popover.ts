/**
 * @kalem-editor/ui — Bağlantı düzenleme akışı  (İş listesi: F3-02)
 *
 * ## Üç giriş yolu
 *
 * 1. Balon araç çubuğundaki bağlantı düğmesi
 * 2. **Ctrl+K** — seçim varken bağlantı kur, bağlantının içindeyken düzenle
 * 3. Var olan bir bağlantıya **tıklamak**
 *
 * Üçü de aynı popover'ı açıyor. Bağlantının içindeyken seçim yapmak
 * gerekmiyor: `getActiveLink()` imlecin durduğu bağlantıyı buluyor ve
 * uygulama onun **tamamını** değiştiriyor.
 *
 * ## Doğrulama
 *
 * `isSafeUrl` çekirdekten geliyor (F1-10) — aynı beyaz liste hem render
 * hem giriş tarafında geçerli. Kullanıcı `javascript:` yazarsa uyarı
 * gösteriliyor ve bağlantı kurulmuyor; sessizce `#`e çevirmek, kullanıcıya
 * çalıştığını düşündürürdü.
 *
 * Şemasız adres (`ornek.com`) **kabul ediliyor ve `https://` ekleniyor**:
 * kullanıcıların çoğu şema yazmıyor ve göreli yol niyetiyle `ornek.com`
 * yazan kimse yok.
 */
import { isSafeUrl } from "@kalem-editor/core";
import type { Editor } from "@kalem-editor/editor";
import { button, el, themed } from "./dom.js";
import { position } from "./floating.js";
import type { UiLabels } from "./labels.js";

export interface LinkPopoverOptions {
	readonly prefix: string;
	readonly labels: UiLabels;
}

export interface LinkPopover {
	readonly element: HTMLElement;
	/** İmlecin bulunduğu yere göre açar. */
	open(): void;
	close(): void;
	readonly isOpen: boolean;
	destroy(): void;
}

/**
 * Şemasız adrese `https://` ekler.
 *
 * `mailto:`, `#bolum` ve `/yol` gibi zaten anlamlı olan biçimlere
 * dokunulmuyor.
 */
export function normalizeUrl(raw: string): string {
	const deger = raw.trim();
	if (deger === "") return "";
	if (/^[a-z][a-z0-9+.-]*:/i.test(deger)) return deger;
	if (deger.startsWith("/") || deger.startsWith("#") || deger.startsWith("?")) return deger;
	// `ornek.com`, `www.ornek.com/yol` → şema ekleniyor.
	return /^[^\s/]+\.[^\s/]/.test(deger) ? `https://${deger}` : deger;
}

export function createLinkPopover(editor: Editor, options: LinkPopoverOptions): LinkPopover {
	const doc = editor.getElement().ownerDocument;
	const p = options.prefix;
	const labels = options.labels;

	const girdi = el(doc, "input", {
		class: `${p}link-input`,
		attrs: {
			type: "url",
			placeholder: "https://",
			"aria-label": labels.linkUrl,
			spellcheck: "false",
		},
	});
	const uyari = el(doc, "span", {
		class: `${p}link-error`,
		attrs: { role: "alert", hidden: "" },
		text: labels.linkInvalid,
	});

	const uygula = button(doc, {
		class: `${p}link-button`,
		label: labels.linkApply,
		text: labels.linkApply,
		onClick: () => kaydet(),
	});
	const kaldir = button(doc, {
		class: `${p}link-button`,
		label: labels.linkRemove,
		glyph: "✕",
		onClick: () => {
			if (!seciminiGeriYukle()) return;
			editor.setLink("");
			close();
			editor.focus();
		},
	});

	const root = el(doc, "div", {
		class: `${p}menu ${p}link-popover`,
		attrs: { role: "dialog", "aria-label": labels.link, hidden: "" },
		children: [girdi, uygula, kaldir, uyari],
	});
	doc.body.append(themed(root, p));

	let acik = false;
	/**
	 * Popover açıldığı andaki editör seçimi.
	 *
	 * Girdiye odaklanmak editörün seçimini düşürüyor; uygulama anında
	 * `setLink` bakacak bir seçim bulamıyordu. Aralık kopyalanıp geri
	 * yükleniyor — arada düzenleme olmadığı için düğümler geçerli kalıyor.
	 */
	let kayitliAralik: Range | null = null;

	function seciminiGeriYukle(): boolean {
		if (kayitliAralik === null) return false;
		const selection = doc.getSelection();
		if (selection === null) return false;
		selection.removeAllRanges();
		selection.addRange(kayitliAralik);
		return true;
	}

	function kaydet(): void {
		if (!seciminiGeriYukle()) return;
		const url = normalizeUrl(girdi.value);
		if (url === "") {
			editor.setLink("");
			close();
			editor.focus();
			return;
		}
		// Doğrulama çekirdeğin beyaz listesiyle: render ile giriş aynı
		// kuralı uyguluyor, ayrışamaz.
		if (!isSafeUrl(url)) {
			uyari.hidden = false;
			girdi.setAttribute("aria-invalid", "true");
			girdi.focus();
			girdi.select();
			return;
		}
		editor.setLink(url);
		close();
		editor.focus();
	}

	function open(): void {
		if (editor.isReadOnly()) return;
		const etkin = editor.getActiveLink();
		// Canlı aralık: `getSelection()` önbelleğe alınmış ve Ctrl+K'den
		// hemen sonra sorulduğunda eski cevabı veriyor.
		const aralik = editor.getTextRange();
		// Ne seçim ne de var olan bağlantı varsa bağlanacak bir şey yok.
		if (etkin === null && (aralik === null || aralik.from === aralik.to)) return;

		const selection = doc.getSelection();
		kayitliAralik =
			selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

		girdi.value = etkin?.url ?? "";
		uyari.hidden = true;
		girdi.removeAttribute("aria-invalid");
		kaldir.hidden = etkin === null;
		root.hidden = false;
		acik = true;
		konumla();
		girdi.focus();
		girdi.select();
	}

	function close(): void {
		root.hidden = true;
		acik = false;
		kayitliAralik = null;
	}

	/**
	 * Popover'ı imlecin bulunduğu yere konumlandırır.
	 *
	 * Seçim boş olabileceği için (bağlantının içindeyken) seçim
	 * dikdörtgeni yerine imleç aralığının dikdörtgeni kullanılıyor.
	 */
	function konumla(): void {
		if (kayitliAralik === null) return;
		const kutu = kayitliAralik.getBoundingClientRect();
		// Boş imleçte dikdörtgen sıfır genişlikte olabiliyor; yine de
		// konum bilgisi taşıyor.
		position(root, kutu, { placement: "bottom" });
	}

	girdi.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			kaydet();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			editor.focus();
		}
	});

	// Dışarı tıklayınca kapanıyor. `pointerdown` kullanılıyor: `click`
	// beklemek, kullanıcının tıkladığı yere odak gitmeden önce popover'ın
	// açık kalmasına yol açıyor.
	const disariTikla = (event: PointerEvent): void => {
		if (!acik) return;
		const hedef = event.target;
		if (hedef instanceof Node && root.contains(hedef)) return;
		close();
	};
	doc.addEventListener("pointerdown", disariTikla, true);

	return {
		element: root,
		open,
		close,
		get isOpen() {
			return acik;
		},
		destroy() {
			doc.removeEventListener("pointerdown", disariTikla, true);
			root.remove();
		},
	};
}
