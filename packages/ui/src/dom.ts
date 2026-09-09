/**
 * @kalem/ui — Küçük DOM yardımcıları
 *
 * Arayüz katmanı çok sayıda küçük eleman kuruyor; her birini altı satır
 * `createElement`/`setAttribute` ile yazmak dosyaları okunmaz hâle
 * getiriyordu. Bu dosya o tekrarı topluyor, başka bir iş yapmıyor.
 *
 * `innerHTML` burada da yok — editör ve görüntüleyicideki kuralın aynısı
 * (analiz §5.6). Arayüzün kendi metinleri kütüphaneden geliyor, yani
 * güvenilir; ama tek bir istisna, kuralı savunulamaz hâle getirir.
 */

export interface ElementOptions {
	readonly class?: string;
	readonly text?: string;
	readonly title?: string;
	readonly attrs?: Readonly<Record<string, string>>;
	readonly children?: readonly Node[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
	doc: Document,
	tag: K,
	options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
	const element = doc.createElement(tag);
	if (options.class !== undefined) element.className = options.class;
	if (options.text !== undefined) element.textContent = options.text;
	if (options.title !== undefined) element.title = options.title;
	for (const [name, value] of Object.entries(options.attrs ?? {})) {
		element.setAttribute(name, value);
	}
	if (options.children !== undefined) element.append(...options.children);
	return element;
}

/**
 * Simge.
 *
 * Simgeler `<svg>` değil **metin**: tek bir karakter ya da kısa bir dize.
 * SVG yolu başına ~200 B, on simge 2 kB eder ve o bütçe (58 kB) editörün
 * kendisinden çalınır. Metin simgeler ayrıca kullanıcının yazı tipi
 * boyutuyla birlikte ölçekleniyor ve yüksek kontrast modunda kayboluyor
 * değil.
 *
 * `aria-hidden`: simge süs, anlamı düğmenin erişilebilir adı taşıyor.
 */
/**
 * Yüzen bir parçanın kök elemanına tema sınıfını ekler.
 *
 * Yüzen parçalar `document.body` altına konuyor (bir `overflow: hidden`
 * kapsayıcı onları kırpardı) ve orada gömen sayfanın tema sarmalayıcısının
 * **dışında** kalıyorlar. Sözlüğü miras alamadıkları için sınıfı kendileri
 * taşıyor (F3-09).
 */
export function themed<T extends HTMLElement>(element: T, prefix: string): T {
	element.classList.add(`${prefix}theme`);
	return element;
}

export function icon(doc: Document, glyph: string, className: string): HTMLElement {
	return el(doc, "span", {
		class: className,
		text: glyph,
		attrs: { "aria-hidden": "true" },
	});
}

export interface ButtonOptions {
	readonly label: string;
	readonly glyph?: string;
	readonly text?: string;
	readonly class: string;
	readonly onClick: () => void;
}

/**
 * Araç çubuğu düğmesi.
 *
 * `mousedown` engelleniyor: düğmeye basmak seçimi düşürürse, uygulanacak
 * biçim için seçim kalmaz. Bu, kendi araç çubuğunu yazan herkesin bir kez
 * düştüğü tuzak.
 */
export function button(doc: Document, options: ButtonOptions): HTMLButtonElement {
	const b = el(doc, "button", {
		class: options.class,
		attrs: { type: "button", "aria-label": options.label, title: options.label },
	});
	if (options.glyph !== undefined) b.append(icon(doc, options.glyph, `${options.class}-glyph`));
	if (options.text !== undefined) b.append(doc.createTextNode(options.text));
	b.addEventListener("mousedown", (event) => event.preventDefault());
	b.addEventListener("click", options.onClick);
	return b;
}
