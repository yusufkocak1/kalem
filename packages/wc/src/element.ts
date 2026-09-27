/**
 * @kalem-editor/wc — `<kalem-editor>`  (İş listesi: F5-03)
 *
 * Çerçevesi olmayan sarmalayıcı: tarayıcının kendi bileşen modeli.
 * React ve Vue sarmalayıcılarıyla aynı işi yapıyor ama Svelte, Angular,
 * Astro, Rails, düz HTML — hepsinde aynı etiket.
 *
 * ## Sınıf neden bir fonksiyonun içinde
 *
 * `class X extends HTMLElement` **değerlendirildiği anda** `HTMLElement`
 * globalini okuyor. Modül gövdesinde dursaydı, `import "@kalem-editor/wc"` yazan
 * bir Next.js/Nuxt sunucusu daha ilk satırda `HTMLElement is not defined`
 * ile düşerdi — üstelik eleman o sayfada hiç kullanılmasa bile.
 *
 * Bu yüzden sınıf `kalemEditorElement()` ilk çağrıldığında kuruluyor ve
 * saklanıyor. Paketi sunucuda import etmek güvenli; DOM'a dokunan tek şey
 * `defineKalemEditor()` çağrısı.
 *
 * ## Shadow DOM opsiyonel, varsayılan kapalı
 *
 * Gölge kök stilleri dışarıda bırakıyor: `@kalem-editor/themes` sayfanın
 * genelinde tanımlı ve gölgeye **girmiyor**. Varsayılan açık olsaydı
 * editör her kurulumda stilsiz açılır, herkes bir geçici çözüm arardı.
 *
 * Açık olması gereken durum da gerçek: yabancı bir sayfaya gömülen bir
 * widget'ta, sayfanın `p { margin: 0 }` kuralı belgeyi bozuyor. O zaman
 * `shadow` özniteliği veriliyor ve stiller `styles` özelliğiyle içeri
 * aktarılıyor.
 *
 * ## Olaylar
 *
 * - `input` — her değişiklikte; `event.detail.value` ve `event.target.value`
 * - `change` — odak editörden çıkarken, metin değiştiyse
 * - `kalem-ready` — editör kurulduğunda; `event.detail.editor`
 *
 * `input` ve `change` platformun form denetimleriyle aynı anlamda
 * kullanılıyor: programla yapılan `el.value = "…"` **olay yaymıyor**,
 * yalnızca kullanıcının yazdığı yayıyor.
 */
import type { Plugin } from "@kalem-editor/editor";
import { Editor, resolveLang } from "@kalem-editor/editor";
import { labelsFor } from "./labels.js";
import { dedent } from "./metin.js";

/** `<kalem-editor>` örneğinin yüzeyi. */
export interface KalemEditorElement extends HTMLElement {
	/** Güncel Markdown metni. Yazmak olay yaymıyor (platform kuralı). */
	value: string;
	/** Form sıfırlandığında geri dönülen metin. */
	defaultValue: string;
	readOnly: boolean;
	required: boolean;
	/** Erişilebilir ad (`aria-label`). */
	label: string | null;
	/** Boş belge doğrulama mesajı; verilmezse belge diline göre seçiliyor. */
	requiredMessage: string | null;
	/** Eklentiler. **Montaj anında** okunuyor. */
	plugins: readonly Plugin[] | null;
	/** Gölge kök açıkken oraya enjekte edilen CSS. */
	styles: string | null;
	/** Editör örneği; eleman DOM'a girmeden önce `null`. */
	readonly editor: Editor | null;
	/** Editörün kök elemanı — `mountUi` gibi imperatif API'ler için. */
	readonly editorElement: HTMLElement | null;

	// Form denetimi yüzeyi (ElementInternals)
	name: string;
	readonly form: HTMLFormElement | null;
	readonly validity: ValidityState | null;
	readonly validationMessage: string;
	readonly willValidate: boolean;
	checkValidity(): boolean;
	reportValidity(): boolean;
}

export interface KalemEditorConstructor {
	new (): KalemEditorElement;
	readonly observedAttributes: readonly string[];
	readonly formAssociated: boolean;
	readonly prototype: KalemEditorElement;
}

let Sinif: KalemEditorConstructor | null = null;

/** Erken atanabilecek özellikler — `#yukselt` bunları kurtarıyor. */
const OZELLIKLER = [
	"value",
	"defaultValue",
	"readOnly",
	"required",
	"label",
	"requiredMessage",
	"plugins",
	"styles",
];

/**
 * Eleman sınıfını üretir (bir kez) ve döndürür.
 *
 * Kaydetmiyor — kayıt `defineKalemEditor()`in işi. Ayrı olmasının sebebi
 * `extends`: kendi elemanını türetmek isteyen uygulama sınıfı buradan
 * alıyor ve `customElements.define` çağrısını kendisi yapıyor.
 *
 * Yalnızca tarayıcıda çağrılabilir.
 */
export function kalemEditorElement(): KalemEditorConstructor {
	if (Sinif !== null) return Sinif;

	class KalemEditor extends HTMLElement {
		/** Form ile ilişkilendirilebilir özel eleman. */
		static formAssociated = true;

		/*
		 * `lang` listede **yok** ve bu bir eksiklik değil.
		 *
		 * Düzenlenebilir alan elemanın çocuğu; `lang` DOM'da kalıtımla
		 * iniyor ve tarayıcının yazım denetimi sözlüğünü zaten o seçiyor.
		 * Kopyalamak, aynı gerçeğin iki kaynağı olurdu.
		 */
		static observedAttributes = ["value", "readonly", "required", "label", "required-message"];

		#internals: ElementInternals | null = null;
		#kap: HTMLElement | null = null;
		#editor: Editor | null = null;
		/** Güncel metin. `null` = henüz belirlenmedi (ilk değer aranacak). */
		#deger: string | null = null;
		#varsayilan: string | null = null;
		#eklentiler: readonly Plugin[] | null = null;
		#stiller: string | null = null;
		/** Son `change` olayında yayılan metin. */
		#sonDegisim = "";
		/** `setValue` sürerken editörün geri bildirimi olay yaymıyor. */
		#yaziliyor = false;
		#saltOkunur = false;
		/** Form devre dışı bıraktı (`disabled`, `<fieldset disabled>`). */
		#devreDisi = false;

		constructor() {
			super();
			// Eski tarayıcıda yoksa form entegrasyonu sessizce devre dışı;
			// editörün kendisi yine çalışıyor.
			if ("attachInternals" in this) this.#internals = this.attachInternals();
		}

		// -------------------------------------------------------------------
		// Yaşam döngüsü
		// -------------------------------------------------------------------

		connectedCallback(): void {
			// Taşınma: söküm bir mikrogörev geciktiriliyor (aşağıya bakın),
			// yani buraya geri dönüldüğünde editör hâlâ ayakta olabiliyor.
			if (this.#editor !== null) return;

			/*
			 * Erken atanmış özellikler kurtarılıyor.
			 *
			 * Klasik özel eleman tuzağı: çerçeve `el.value = "…"` diyor,
			 * sınıf henüz tanımlı değil, atama elemanın **kendi** özelliği
			 * olarak yapışıyor ve sonradan gelen prototip erişimcisini
			 * gölgeliyor. Setter hiç çalışmıyor, hata da yok. Angular'ın ve
			 * Svelte'nin özellik bağlamaları tam olarak bu sırayla işliyor.
			 */
			for (const ad of OZELLIKLER) this.#yukselt(ad);

			this.#kur();
		}

		disconnectedCallback(): void {
			/*
			 * Söküm bir mikrogörev geciktiriliyor.
			 *
			 * `parent.append(el)` bir elemanı taşırken önce söküyor sonra
			 * takıyor; ikisi de aynı görevde. Hemen yıkılsaydı DOM'da yer
			 * değiştirmek geçmişi ve imleci silerdi — kullanıcı taşıma
			 * yaptığını bile bilmeden.
			 */
			queueMicrotask(() => {
				if (this.isConnected) return;
				this.#sok();
			});
		}

		attributeChangedCallback(ad: string, eski: string | null, yeni: string | null): void {
			if (eski === yeni) return;
			switch (ad) {
				case "value":
					/*
					 * `<input>`ten sapma, bilerek.
					 *
					 * Platformda `value` özniteliği yalnızca **başlangıç**
					 * değeri: kullanıcı yazdıktan sonra özniteliği
					 * değiştirmek hiçbir şey yapmıyor. Burada yapıyor,
					 * çünkü çerçevelerin özel elemanlara bağlanma yolu çoğu
					 * zaman öznitelik — Angular'ın `[attr.value]`si ya da
					 * Svelte'nin `value={…}`i yok sayılsaydı bağlama
					 * sessizce çalışmazdı. Form sıfırlamasının ihtiyaç
					 * duyduğu "ilk değer" ayrı tutuluyor: `defaultValue`.
					 */
					this.value = yeni ?? "";
					break;
				case "readonly":
					this.#saltOkunur = yeni !== null;
					this.#editor?.setReadOnly(this.#saltOkunur || this.#devreDisi);
					break;
				case "required":
				case "required-message":
					this.#dogrula();
					break;
				case "label":
					if (yeni === null) this.#kap?.removeAttribute("aria-label");
					else this.#kap?.setAttribute("aria-label", yeni);
					break;
			}
		}

		// -------------------------------------------------------------------
		// Özellikler
		// -------------------------------------------------------------------

		get value(): string {
			return this.#deger ?? "";
		}

		set value(v: string) {
			const metin = String(v);
			if (this.#deger === metin) return;
			this.#deger = metin;
			if (this.#editor === null) return;
			// `setValue` belgeyi baştan yüklüyor ve `change` yayıyor; o geri
			// bildirim kullanıcının yazması değil, bizim yazmamız.
			this.#yaziliyor = true;
			try {
				this.#editor.setValue(metin);
			} finally {
				this.#yaziliyor = false;
			}
			this.#formaYaz();
		}

		get defaultValue(): string {
			return this.#varsayilan ?? "";
		}

		set defaultValue(v: string) {
			this.#varsayilan = String(v);
		}

		get readOnly(): boolean {
			return this.hasAttribute("readonly");
		}

		set readOnly(v: boolean) {
			this.toggleAttribute("readonly", Boolean(v));
		}

		get required(): boolean {
			return this.hasAttribute("required");
		}

		set required(v: boolean) {
			this.toggleAttribute("required", Boolean(v));
		}

		get label(): string | null {
			return this.getAttribute("label");
		}

		set label(v: string | null) {
			if (v === null) this.removeAttribute("label");
			else this.setAttribute("label", v);
		}

		get requiredMessage(): string | null {
			return this.getAttribute("required-message");
		}

		set requiredMessage(v: string | null) {
			if (v === null) this.removeAttribute("required-message");
			else this.setAttribute("required-message", v);
		}

		get name(): string {
			return this.getAttribute("name") ?? "";
		}

		set name(v: string) {
			this.setAttribute("name", String(v));
		}

		get plugins(): readonly Plugin[] | null {
			return this.#eklentiler;
		}

		set plugins(v: readonly Plugin[] | null) {
			this.#eklentiler = v;
		}

		get styles(): string | null {
			return this.#stiller;
		}

		set styles(v: string | null) {
			this.#stiller = v;
			const stil = this.shadowRoot?.querySelector("style");
			if (stil != null) stil.textContent = this.#stilMetni();
		}

		get editor(): Editor | null {
			return this.#editor;
		}

		get editorElement(): HTMLElement | null {
			return this.#kap;
		}

		// -------------------------------------------------------------------
		// Form denetimi yüzeyi
		// -------------------------------------------------------------------

		get form(): HTMLFormElement | null {
			return this.#internals?.form ?? null;
		}

		get validity(): ValidityState | null {
			return this.#internals?.validity ?? null;
		}

		get validationMessage(): string {
			return this.#internals?.validationMessage ?? "";
		}

		get willValidate(): boolean {
			return this.#internals?.willValidate ?? false;
		}

		checkValidity(): boolean {
			return this.#internals?.checkValidity() ?? true;
		}

		reportValidity(): boolean {
			return this.#internals?.reportValidity() ?? true;
		}

		/** Form sıfırlandı: `defaultValue`a dönülüyor. */
		formResetCallback(): void {
			this.value = this.defaultValue;
			this.#sonDegisim = this.value;
		}

		/**
		 * Form denetimi devre dışı bırakıldı.
		 *
		 * `disabled` özniteliği ya da `<fieldset disabled>` atası. Editörde
		 * "devre dışı" diye ayrı bir kip yok; salt okunur yeterli ve doğrusu
		 * da o — içerik görünür kalıyor, yalnızca düzenlenemiyor.
		 */
		formDisabledCallback(devreDisi: boolean): void {
			this.#devreDisi = devreDisi;
			this.#editor?.setReadOnly(this.#saltOkunur || devreDisi);
		}

		/** Tarayıcı geri/ileri gezinmesinden sonra durumu geri yüklüyor. */
		formStateRestoreCallback(durum: File | string | FormData | null): void {
			if (typeof durum === "string") this.value = durum;
		}

		// -------------------------------------------------------------------
		// Davranış
		// -------------------------------------------------------------------

		override focus(): void {
			if (this.#editor === null) super.focus();
			else this.#editor.focus();
		}

		// -------------------------------------------------------------------
		// İç işleyiş
		// -------------------------------------------------------------------

		#yukselt(ad: string): void {
			if (!Object.hasOwn(this, ad)) return;
			const kendi = this as unknown as Record<string, unknown>;
			const deger = kendi[ad];
			delete kendi[ad];
			kendi[ad] = deger;
		}

		#stilMetni(): string {
			// Özel elemanlar varsayılan olarak `display: inline`; kutu
			// davranışı olmadan `min-height` ve dolgu hiç görünmezdi.
			return `:host{display:block}\n${this.#stiller ?? ""}`;
		}

		#kur(): void {
			const ilk = this.#ilkMetin();
			this.#deger = ilk;
			this.#varsayilan ??= ilk;
			this.#sonDegisim = ilk;

			const kap = this.ownerDocument.createElement("div");
			const etiket = this.getAttribute("label");
			if (etiket !== null) kap.setAttribute("aria-label", etiket);

			if (this.hasAttribute("shadow")) {
				const kok = this.shadowRoot ?? this.attachShadow({ mode: "open" });
				const stil = this.ownerDocument.createElement("style");
				stil.textContent = this.#stilMetni();
				kok.replaceChildren(stil, kap);
			} else {
				// Başlangıç metni elemanın içinden okundu; DOM'u artık editör
				// yönetiyor.
				this.replaceChildren(kap);
			}
			this.#kap = kap;

			this.#saltOkunur = this.hasAttribute("readonly");
			const ed = new Editor(kap, {
				value: ilk,
				readOnly: this.#saltOkunur || this.#devreDisi,
				...(this.#eklentiler === null ? {} : { plugins: [...this.#eklentiler] }),
				onChange: (value) => this.#degisti(value),
			});
			this.#editor = ed;

			/*
			 * `input` olayı burada kesiliyor ve yeniden yayılıyor.
			 *
			 * `contenteditable`ın kendi `input` olayı zaten kabarıp elemanın
			 * dışına çıkıyor — ama `event.target` içerideki blok elemanı
			 * oluyor, yani `event.target.value` diye okuyan herkes
			 * `undefined` alıyor. İkisi birden yayılsaydı dinleyici her
			 * tuşta iki olay görürdü.
			 *
			 * Dinleyici editörünkinden **sonra** eklendiği için model bu
			 * noktada güncel; `stopPropagation` aynı düğümdeki editör
			 * dinleyicisini etkilemiyor.
			 */
			kap.addEventListener("input", (olay) => olay.stopPropagation());
			// Odak editörden tamamen çıktığında `change`. Bloklar arası
			// gezinmede `relatedTarget` hâlâ içeride oluyor.
			this.addEventListener("focusout", this.#odakCikti);

			this.#formaYaz();

			/*
			 * `kalem-ready` bir mikrogörev geciktiriliyor.
			 *
			 * `customElements.define` çağrısı, sayfada zaten duran elemanları
			 * **o anda** yükseltiyor: `connectedCallback` define'ın içinde,
			 * senkron çalışıyor. Olay burada hemen yayılsaydı, hemen ardından
			 * `el.addEventListener("kalem-ready", …)` yazan sayfa onu
			 * **kaçırırdı** — yani en doğal kullanım hiç çalışmazdı.
			 *
			 * Mikrogörev, çağıran betiğin sonuna kadar bekliyor. İmperatif
			 * erişimin senkron yolu da duruyor: `el.editor` bu satırda dolu.
			 */
			queueMicrotask(() => {
				// Bu arada sökülmüş olabilir; ölü bir editörü duyurmanın anlamı yok.
				if (this.#editor !== ed) return;
				this.dispatchEvent(
					new CustomEvent("kalem-ready", { detail: { editor: ed }, bubbles: true, composed: true }),
				);
			});
		}

		#sok(): void {
			this.removeEventListener("focusout", this.#odakCikti);
			this.#editor?.destroy();
			this.#editor = null;
			this.#kap = null;
		}

		#odakCikti = (olay: FocusEvent): void => {
			const hedef = olay.relatedTarget;
			if (hedef instanceof Node && this.#kap?.contains(hedef) === true) return;
			if (this.value === this.#sonDegisim) return;
			this.#sonDegisim = this.value;
			this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
		};

		/**
		 * Başlangıç metni: özellik, yoksa öznitelik, yoksa elemanın içeriği.
		 *
		 * Üçüncüsü çok satırlı Markdown'ı bir özniteliğe sıkıştırmaktan
		 * kurtarıyor. `<script type="text/markdown">` çocuğu da buraya
		 * düşüyor — tarayıcı bilmediği tipi çalıştırmıyor ama metni
		 * `textContent`e katıyor, yani eleman yükselmeden önce ham Markdown
		 * sayfada görünmüyor.
		 */
		#ilkMetin(): string {
			if (this.#deger !== null) return this.#deger;
			const oznitelik = this.getAttribute("value");
			if (oznitelik !== null) return oznitelik;
			return dedent(this.textContent ?? "");
		}

		#degisti(value: string): void {
			this.#deger = value;
			this.#formaYaz();
			if (this.#yaziliyor) return;
			this.dispatchEvent(
				new CustomEvent("input", { detail: { value }, bubbles: true, composed: true }),
			);
		}

		#formaYaz(): void {
			this.#internals?.setFormValue(this.#deger ?? "");
			this.#dogrula();
		}

		#dogrula(): void {
			const ic = this.#internals;
			if (ic === null) return;
			if (this.required && (this.#deger ?? "").trim() === "") {
				// `lang` DOM özelliği yalnızca elemanın **kendi** özniteliğini
				// veriyor; kalıtım ve tarayıcı dili `resolveLang`de. Editör
				// burada henüz kurulmamış olabilir, o yüzden eleman kendisi.
				const sozluk = labelsFor(resolveLang(this));
				ic.setValidity(
					{ valueMissing: true },
					this.getAttribute("required-message") ?? sozluk.valueMissing,
					this.#kap ?? undefined,
				);
			} else {
				ic.setValidity({});
			}
		}
	}

	Sinif = KalemEditor as unknown as KalemEditorConstructor;
	return Sinif;
}
