/**
 * @kalem/plugin-find-replace — Panel  (İş listesi: F4-03)
 *
 * Ctrl+F ile açılan kutu. Kendi durumunu tutmuyor: ne yazıldığını
 * bildiriyor, ne gösterileceğini söyleyen `plugin.ts`. Bu ayrım, arama
 * mantığının tamamının tarayıcısız test edilebilmesini sağlıyor.
 *
 * ## Neden `@kalem/ui` kullanılmıyor
 *
 * `@kalem/ui` hazır bir popover ve düğme sözlüğü taşıyor. Bağlanmak,
 * kendi arayüzünü yazan bir uygulamanın bul-değiştir için bütün arayüz
 * katmanını indirmesi demekti (F4-01'deki aynı karar).
 *
 * ## Odak
 *
 * Panel açıkken odak arama kutusunda ve **editörün seçimi yerinde
 * duruyor**: kullanıcı Escape'e basınca yazdığı yere dönüyor. Bu yüzden
 * eşleşmeler seçimle değil, boyamayla gösteriliyor (`decorate.ts`) —
 * seçimi taşımak, imleci kaybettirirdi.
 *
 * ## Erişilebilirlik
 *
 * Panel `role="search"` ve adlandırılmış; sayaç `aria-live="polite"`, yani
 * ekran okuyucu sonuç sayısını kullanıcı yazarken duyuruyor. Kaç eşleşme
 * olduğu görsel bir bilgi değil, aramanın **sonucu**.
 */
import type { FindLabels } from "./labels.js";

export interface PanelOptions {
	readonly prefix: string;
	readonly labels: FindLabels;
	readonly onQueryChange: (query: string) => void;
	readonly onOptionsChange: () => void;
	readonly onNext: () => void;
	readonly onPrevious: () => void;
	readonly onReplace: () => void;
	readonly onReplaceAll: () => void;
	readonly onClose: () => void;
}

export interface Panel {
	open(mode: "find" | "replace", initial: string): void;
	close(): void;
	isOpen(): boolean;
	/** Sayaç metnini günceller. `total` 0 ise "sonuç yok". */
	setStatus(current: number, total: number, limited: boolean): void;
	/** Değiştirme düğmelerini kapatır (salt okunur belge). */
	setReadOnly(readOnly: boolean): void;
	query(): string;
	replacement(): string;
	caseSensitive(): boolean;
	wholeWord(): boolean;
	/** Panel editörün üst-sağ köşesine hizalanıyor. */
	reposition(): void;
	destroy(): void;
}

export function createPanel(anchor: HTMLElement, options: PanelOptions): Panel {
	const doc = anchor.ownerDocument;
	const p = options.prefix;
	const l = options.labels;

	const kok = doc.createElement("div");
	kok.className = `${p}menu ${p}theme ${p}find`;
	kok.setAttribute("role", "search");
	kok.setAttribute("aria-label", l.panel);
	kok.hidden = true;

	const bulSatiri = doc.createElement("div");
	bulSatiri.className = `${p}find-row`;

	const bulGirdi = metinKutusu(doc, `${p}find-input`, l.find);
	const sayac = doc.createElement("span");
	sayac.className = `${p}find-count`;
	sayac.setAttribute("aria-live", "polite");
	// Sayaç boşken de yer kaplıyor: her tuş vuruşunda genişleyip daralan
	// bir panel, yazmayı zorlaştırıyor.
	sayac.textContent = "";

	const onceki = dugme(doc, `${p}find-btn`, l.previous, "↑");
	const sonraki = dugme(doc, `${p}find-btn`, l.next, "↓");
	const kapat = dugme(doc, `${p}find-btn`, l.close, "✕");

	bulSatiri.append(bulGirdi, sayac, onceki, sonraki, kapat);

	const degistirSatiri = doc.createElement("div");
	degistirSatiri.className = `${p}find-row`;
	const degistirGirdi = metinKutusu(doc, `${p}find-input`, l.replace);
	const degistirBir = dugme(doc, `${p}find-btn ${p}find-btn-text`, l.replaceOne, l.replaceOne);
	const degistirHepsi = dugme(doc, `${p}find-btn ${p}find-btn-text`, l.replaceAll, l.replaceAll);
	degistirSatiri.append(degistirGirdi, degistirBir, degistirHepsi);

	const secenekler = doc.createElement("div");
	secenekler.className = `${p}find-options`;
	const duyarli = onayKutusu(doc, p, l.caseSensitive);
	const tamKelime = onayKutusu(doc, p, l.wholeWord);
	secenekler.append(duyarli.label, tamKelime.label);

	kok.append(bulSatiri, degistirSatiri, secenekler);
	doc.body.append(kok);

	let acik = false;

	function konumla(): void {
		const olcu = anchor.getBoundingClientRect();
		const genislik = kok.offsetWidth;
		// Sağ kenara hizalı, ama ekranın dışına taşmıyor.
		const sol = Math.max(
			8,
			Math.min(olcu.right - genislik - 8, (doc.defaultView?.innerWidth ?? 0) - genislik - 8),
		);
		kok.style.left = `${sol}px`;
		kok.style.top = `${Math.max(8, olcu.top + 8)}px`;
	}

	const girdiDegisti = (): void => {
		options.onQueryChange(bulGirdi.value);
	};

	const tus = (event: KeyboardEvent): void => {
		// Panel açıkken Ctrl+F, tarayıcının arama çubuğunu açmak yerine
		// arama kutusunu seçiyor: kullanıcı "aramayı yeniden başlat"
		// bekliyor, iki üst üste arama kutusu değil.
		// kalem-locale-ok: tuş adı ASCII; Türkçe klavyede de "f" geliyor
		const tusAdi = event.key.toLowerCase();
		if ((event.ctrlKey || event.metaKey) && !event.altKey && (tusAdi === "f" || tusAdi === "h")) {
			event.preventDefault();
			if (tusAdi === "h") degistirSatiri.hidden = false;
			bulGirdi.focus();
			bulGirdi.select();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			options.onClose();
			return;
		}
		if (event.key !== "Enter") return;
		event.preventDefault();
		// Değiştirme kutusunda Enter = değiştir; arama kutusunda = sonraki.
		// Word'ün davranışı ve kullanıcı ikisini de deniyor.
		if (event.target === degistirGirdi) options.onReplace();
		else if (event.shiftKey) options.onPrevious();
		else options.onNext();
	};

	bulGirdi.addEventListener("input", girdiDegisti);
	kok.addEventListener("keydown", tus);
	onceki.addEventListener("click", options.onPrevious);
	sonraki.addEventListener("click", options.onNext);
	kapat.addEventListener("click", options.onClose);
	degistirBir.addEventListener("click", options.onReplace);
	degistirHepsi.addEventListener("click", options.onReplaceAll);
	duyarli.input.addEventListener("change", options.onOptionsChange);
	tamKelime.input.addEventListener("change", options.onOptionsChange);

	const yenidenKonumla = (): void => {
		if (acik) konumla();
	};
	doc.defaultView?.addEventListener("resize", yenidenKonumla);

	return {
		open(mode, initial) {
			acik = true;
			kok.hidden = false;
			degistirSatiri.hidden = mode === "find";
			if (initial !== "") bulGirdi.value = initial;
			konumla();
			bulGirdi.focus();
			bulGirdi.select();
			options.onQueryChange(bulGirdi.value);
		},

		close() {
			acik = false;
			kok.hidden = true;
		},

		isOpen: () => acik,

		setStatus(current, total, limited) {
			if (bulGirdi.value === "") {
				sayac.textContent = "";
				return;
			}
			if (total === 0) {
				sayac.textContent = l.noResults;
				return;
			}
			const toplam = limited ? l.limited(total) : String(total);
			sayac.textContent = `${current + 1} / ${toplam}`;
		},

		setReadOnly(readOnly) {
			degistirBir.disabled = readOnly;
			degistirHepsi.disabled = readOnly;
			degistirGirdi.disabled = readOnly;
			if (readOnly) degistirSatiri.title = l.readOnly;
			else degistirSatiri.removeAttribute("title");
		},

		query: () => bulGirdi.value,
		replacement: () => degistirGirdi.value,
		caseSensitive: () => duyarli.input.checked,
		wholeWord: () => tamKelime.input.checked,
		reposition: konumla,

		destroy() {
			doc.defaultView?.removeEventListener("resize", yenidenKonumla);
			kok.remove();
		},
	};
}

// ---------------------------------------------------------------------------
// Küçük yapı taşları
// ---------------------------------------------------------------------------

function metinKutusu(doc: Document, className: string, label: string): HTMLInputElement {
	const input = doc.createElement("input");
	input.type = "text";
	input.className = className;
	// Görünür bir etiket yerine `aria-label`: panel dar ve etiketler,
	// yer tutucu metinle birlikte iki kez okunurdu.
	input.setAttribute("aria-label", label);
	input.placeholder = label;
	// Tarayıcının kendi tamamlama listesi aramanın önünü kapatıyor.
	input.autocomplete = "off";
	input.spellcheck = false;
	return input;
}

function dugme(doc: Document, className: string, label: string, text: string): HTMLButtonElement {
	const button = doc.createElement("button");
	button.type = "button";
	button.className = className;
	button.textContent = text;
	// Simge düğmelerinin metni bir ok; erişilebilir ad ayrıca veriliyor.
	if (text !== label) button.setAttribute("aria-label", label);
	button.title = label;
	return button;
}

function onayKutusu(
	doc: Document,
	prefix: string,
	label: string,
): { label: HTMLLabelElement; input: HTMLInputElement } {
	const input = doc.createElement("input");
	input.type = "checkbox";
	const etiket = doc.createElement("label");
	etiket.className = `${prefix}find-option`;
	etiket.append(input, doc.createTextNode(` ${label}`));
	return { label: etiket, input };
}
