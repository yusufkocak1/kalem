/**
 * @kalem/editor — `Editor` sınıfı  (İş listesi: F2-05)
 *
 * ## Veri akışı
 *
 * İki yönlü ama **kesin sınırlı**:
 *
 *     blok yapısı :  model ──► DOM      (komutlar, yamalar)
 *     satır içi   :  DOM   ──► model    (`input` olayında okunur)
 *
 * Sınır IME yüzünden burada: bileşim (composition) sırasında DOM'a
 * karışmak Japonca/Çince yazımı bozar, o yüzden satır içinde tarayıcı
 * serbest. Blok yapısında ise tarayıcıya güvenilemez — Enter'a basınca
 * ürettiği `<div>` çorbası Markdown'a çevrilemez.
 *
 * ## Sanal DOM yok
 *
 * Yama hedefli: her blok kimliğiyle eşlenmiş bir elemana sahip ve bir blok
 * yalnızca **kimliği (referansı) değiştiyse** yeniden kuruluyor. Bu,
 * `@kalem/core`'un değişmez düzenleme kararının (F1-02) karşılığını aldığı
 * yer: `replaceAt` yalnızca yoldaki ataları kopyaladığı için, dokunulmayan
 * blokların referansı **aynı kalıyor** ve karşılaştırma tek bir `!==`.
 */
import type { Definition, Inline, NodeId, Root } from "@kalem/core";
import { createSerializeCache, parse, removeAt, replaceAt, serialize } from "@kalem/core";
import type { BlockType, MarkType } from "@kalem/core/commands";
import { emptyParagraph, setBlockType } from "@kalem/core/commands";
import type { Caret, EditResult } from "./block-edit.js";
import {
	indentItem,
	insertBreak,
	mergeWithNext,
	mergeWithPrevious,
	normalizeDocument,
	outdentItem,
	sameCaret,
	splitAtCaret,
	toggleList,
} from "./block-edit.js";
import { blocksPayload, inlinePayload } from "./clipboard.js";
import type { HistoryState } from "./history.js";
import { History } from "./history.js";
import { assignIds, newId } from "./ids.js";
import {
	applyLink,
	applyMark,
	linkAt,
	markActive,
	sliceInline,
	spliceInline,
} from "./inline-edit.js";
import { contentLength, offsetOf, selectRange } from "./offsets.js";
import type { PasteInput } from "./paste.js";
import { insertFragment, pasteFragment } from "./paste.js";
import type { Plugin, PluginContext } from "./plugin.js";
import { PluginRegistry } from "./plugin.js";
import { defaultPlugins } from "./plugins-builtin.js";
import { readCode, readInline } from "./read.js";
import {
	CODE_ATTR,
	collectDefinitions,
	createBlockElement,
	fillBlock,
	ID_ATTR,
	PATH_ATTR,
	type RenderContext,
	type TopNode,
	tagOf,
} from "./render.js";
import {
	type EditorSelection,
	placeCaret,
	readSelection,
	sameSelection,
	selectedRange,
} from "./selection.js";

/** Editörün yayımladığı olaylar. */
export type EditorEvent = "change" | "selectionchange" | "readonlychange";

export interface EditorOptions {
	/** Başlangıç Markdown metni. */
	value?: string;
	/**
	 * İçerik her değiştiğinde çağrılır.
	 *
	 * Markdown **eager** üretiliyor: kanca verilmemişse serileştirme hiç
	 * çalışmıyor, verilmişse her tuşta çalışıyor. Büyük belgede maliyeti
	 * ölçülecek (F6-08); erken optimizasyon yerine önce doğruluk.
	 */
	onChange?: (value: string, doc: Root) => void;
	/** Salt okunur mod: içerik görünür, düzenlenemez. */
	readOnly?: boolean;
	/**
	 * Belge dili (`"tr"`, `"en"` …).
	 *
	 * Verilmezse kapsayıcının ya da atalarının `lang`'i kullanılır. Bu
	 * özniteliğin görevi süs değil: tarayıcının **yazım denetimi sözlüğünü**,
	 * hecelemeyi ve tırnak biçimini buna göre seçer. Türkçe bir belgeyi
	 * İngilizce sözlükle denetlemek her kelimeyi kırmızı yapar.
	 */
	lang?: string;
	/** CSS sınıf öneki (varsayılan `"kalem-"`). */
	classPrefix?: string;
	/**
	 * Editörün erişilebilir adı (`aria-label`).
	 *
	 * `role="textbox"` bir ad taşımak zorunda; adsız bir metin kutusu ekran
	 * okuyucuda "düzenle, çok satırlı" diye duyuruluyor ve **neyi**
	 * düzenlediği hiç söylenmiyor (F3-10).
	 *
	 * Bu paket başsız: hiçbir kullanıcı metni taşımıyor ve buraya varsayılan
	 * bir dize **yazılmıyor** — yazılsaydı Türkçe bir belgede İngilizce
	 * duyurulurdu. Üç seçenek var ve biri seçilmek zorunda:
	 *
	 * - bu seçeneği vermek,
	 * - kök elemana kendiniz `aria-label` / `aria-labelledby` yazmak,
	 * - `@kalem/ui` kullanmak — `mountUi` sözlüğünden bir ad koyuyor.
	 *
	 * Zaten bir adı olan elemana dokunulmuyor.
	 */
	label?: string;
	/** Seçim her değiştiğinde çağrılır (bloklar arası seçim dâhil). */
	onSelectionChange?: (selection: EditorSelection) => void;
	/**
	 * Yazarken otomatik dönüşüm (varsayılan `true`).
	 *
	 * `# ` yazınca başlık, `- ` yazınca liste, `**a**` yazınca kalın.
	 * Kapatılabilir olmasının sebebi, bazı bağlamlarda (kod notu, düz metin
	 * alanı) sürprizin istenmemesi.
	 */
	inputRules?: boolean;
	/**
	 * Yapıştırılan düz metni Markdown olarak ayrıştır (varsayılan `true`).
	 *
	 * Yalnızca metin gerçekten Markdown'a benziyorsa ayrıştırılıyor
	 * (`looksLikeMarkdown`); ayrıntı ve gerekçe `paste.ts` içinde.
	 */
	parseMarkdownOnPaste?: boolean;
	/**
	 * Eklentiler.
	 *
	 * Verilmezse yerleşikler kullanılıyor (giriş kuralları, görev listesi).
	 * **Boş dizi vermek onları kapatır** — F2-12'nin dogfooding kanıtı da
	 * bu: çekirdek özellikler gerçekten eklenti olarak çıkarılabiliyor.
	 *
	 * Sıra önemli: önce kayıtlı eklenti tuşu ve giriş kuralını önce görür.
	 */
	plugins?: readonly Plugin[];
}

export class Editor {
	readonly #element: HTMLElement;
	readonly #options: EditorOptions;
	readonly #prefix: string;
	/** Kimlik → DOM elemanı. */
	readonly #elements = new Map<string, HTMLElement>();
	/** Kimlik → o elemana en son basılan düğüm (referans karşılaştırması için). */
	readonly #rendered = new Map<string, TopNode>();
	#doc: Root;
	#defs: ReadonlyMap<string, Definition>;
	/**
	 * Blok başına serileştirme önbelleği (F6-08).
	 *
	 * `WeakMap` üstünde: sökülen bloklar kendiliğinden düşüyor, yani
	 * geçmişte kalan on bin blok bellekte tutulmuyor.
	 */
	readonly #serializeCache = createSerializeCache();
	#readOnly: boolean;
	#destroyed = false;
	#selection: EditorSelection = null;
	/** Sürüklemenin başladığı blok; işaretçi basılı değilse `null`. */
	#dragAnchor: NodeId | null = null;
	/** Sürükleme blok moduna geçti mi (bkz. `#onPointerMove`). */
	#blockDrag = false;
	readonly #history: History;
	/**
	 * Olay aboneleri.
	 *
	 * Kurucudaki `onChange`/`onSelectionChange` seçenekleri tek dinleyici
	 * alıyor ve editör kurulduktan **sonra** eklenemiyor. Arayüz katmanı
	 * (`@kalem/ui`) editöre dışarıdan takılıyor, o yüzden abonelik gerekli.
	 */
	readonly #listeners = new Map<EditorEvent, Set<(...args: never[]) => void>>();
	readonly #plugins: PluginRegistry;
	/** Sıradaki yapıştırma biçimsiz mi (Ctrl+Shift+V). */
	#plainPaste = false;
	/** En son bildirilen imleç; blok içi hareketi yakalamak için. */
	#lastCaret: Caret | null = null;
	/**
	 * Tuşa basıldığı andaki imleç.
	 *
	 * Geri alma "değişiklikten önceki" konuma dönmeli; o konum ancak
	 * tarayıcı DOM'a dokunmadan **önce** okunabiliyor.
	 */
	#caretBeforeKey: Caret | null = null;
	/**
	 * IME bileşimi sürüyor mu.
	 *
	 * Bileşim (Japonca/Çince/Korece yazımda tuş vuruşlarıyla son karakter
	 * arasındaki ara durum) sırasında bloğu yeniden basmak, tarayıcının
	 * bileşim durumunu düşürüyor ve yarım kalan hece kayboluyor.
	 */
	#composing = false;

	constructor(element: HTMLElement, options: EditorOptions = {}) {
		this.#element = element;
		this.#options = options;
		this.#prefix = options.classPrefix ?? "kalem-";
		this.#readOnly = options.readOnly ?? false;

		this.#doc = this.#load(options.value ?? "");
		this.#defs = collectDefinitions(this.#doc);
		this.#history = new History({ doc: this.#doc, caret: null });

		element.classList.add(`${this.#prefix}editor`, `${this.#prefix}doc`);
		element.setAttribute("role", "textbox");
		element.setAttribute("aria-multiline", "true");
		// Var olan adın üstüne yazılmıyor: gömen sayfa `aria-labelledby` ile
		// görünür bir başlığa bağlamış olabilir ve o daha iyisi.
		if (options.label !== undefined) element.setAttribute("aria-label", options.label);
		if (options.lang !== undefined) element.lang = options.lang;

		element.addEventListener("input", this.#onInput);
		element.addEventListener("keydown", this.#onKeyDown);
		element.addEventListener("beforeinput", this.#onBeforeInput);
		element.addEventListener("compositionstart", this.#onCompositionStart);
		element.addEventListener("compositionend", this.#onCompositionEnd);
		element.addEventListener("copy", this.#onCopy);
		element.addEventListener("cut", this.#onCut);
		element.addEventListener("paste", this.#onPaste);
		element.addEventListener("pointerdown", this.#onPointerDown);
		element.addEventListener("pointermove", this.#onPointerMove);
		element.ownerDocument.addEventListener("pointerup", this.#onPointerUp);
		// `selectionchange` yalnızca belge üzerinde tetiklenir; elemana
		// bağlanamaz. Sökülürken kaldırılması bu yüzden önemli.
		element.ownerDocument.addEventListener("selectionchange", this.#onSelectionChange);

		this.#plugins = new PluginRegistry(this.#pluginContext());
		for (const plugin of options.plugins ?? defaultPlugins()) this.#plugins.add(plugin);

		this.#sync();
	}

	/** Eklentilere verilen dar yüzey. */
	#pluginContext(): PluginContext {
		return {
			element: this.#element,
			getDocument: () => this.#doc,
			getCaret: () => this.#caret(),
			applyEdit: (sonuc) => this.applyEdit(sonuc),
			isReadOnly: () => this.#readOnly,
			on: (event: never, handler: never) => this.on(event, handler),
		};
	}

	// -----------------------------------------------------------------------
	// Eklentiler  (F2-12)
	// -----------------------------------------------------------------------

	/** Kayıtlı eklenti adları, kayıt sırasıyla. */
	get plugins(): readonly string[] {
		return this.#plugins.names;
	}

	/** Eklenti ekler; aynı ad zaten kayıtlıysa hata atar. */
	addPlugin(plugin: Plugin): void {
		this.#plugins.add(plugin);
	}

	/** Eklentiyi kaldırır ve temizleyicisini çağırır. */
	removePlugin(name: string): boolean {
		return this.#plugins.remove(name);
	}

	/**
	 * Bir düzenleme sonucunu uygular.
	 *
	 * Eklentiler için açık: modeli değiştiren her yol geçmişe de yazılmalı
	 * ve DOM'a hedefli yansımalı; bunu eklentinin kendisinin yapması
	 * gerekseydi API yanlış yerden bölünmüş olurdu.
	 */
	applyEdit(sonuc: EditResult | null): boolean {
		if (sonuc === null || this.#readOnly) return false;
		this.#applyEdit(sonuc);
		return true;
	}

	// -----------------------------------------------------------------------
	// Genel API
	// -----------------------------------------------------------------------

	/** Belgenin Markdown karşılığı. */
	getValue(): string {
		return serialize(this.#doc);
	}

	/** Belgenin AST'si. Değişmez: değiştirmek için `setValue` kullanın. */
	getDocument(): Root {
		return this.#doc;
	}

	/**
	 * Belgeyi baştan yükler.
	 *
	 * Kimlikler yeniden dağıtılır, yani tüm bloklar yeniden kurulur. Yazarken
	 * çağrılmamalı — `setValue` "başka bir belge aç" demek.
	 */
	setValue(markdown: string): void {
		const doc = this.#load(markdown);
		// Başka bir belge açmak geçmişi de sıfırlar: önceki belgenin
		// adımlarına geri dönmek anlamsız ve tehlikeli olurdu.
		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		this.#history.reset({ doc, caret: null });
		this.#sync();
		this.#emit();
	}

	/** Markdown'ı düzenlenebilir bir belgeye çevirir. */
	#load(markdown: string): Root {
		return assignIds(normalizeDocument(parse(markdown)));
	}

	setReadOnly(readOnly: boolean): void {
		if (this.#readOnly === readOnly) return;
		this.#readOnly = readOnly;
		this.#applyReadOnly();
		// Arayüz katmanı düğmelerini buna göre kapatıyor; yoklamak yerine
		// haber vermek, `@kalem/ui`nin editörü sürekli sorgulamasını
		// gereksiz kılıyor.
		this.#dispatch("readonlychange", readOnly);
	}

	isReadOnly(): boolean {
		return this.#readOnly;
	}

	// -----------------------------------------------------------------------
	// Geçmiş  (F2-09)
	// -----------------------------------------------------------------------

	/** Son adımı geri alır. */
	undo(): boolean {
		return this.#travel(this.#history.undo());
	}

	/** Geri alınan adımı yineler. */
	redo(): boolean {
		return this.#travel(this.#history.redo());
	}

	canUndo(): boolean {
		return this.#history.canUndo;
	}

	canRedo(): boolean {
		return this.#history.canRedo;
	}

	#travel(durum: HistoryState | null): boolean {
		if (durum === null || this.#readOnly) return false;
		this.#doc = durum.doc;
		this.#defs = collectDefinitions(durum.doc);
		this.#selection = null;
		this.#sync();
		if (durum.caret !== null) this.#placeCaretAt(durum.caret);
		this.#emit();
		return true;
	}

	/**
	 * Yeni durumu geçmişe yazar.
	 *
	 * Kaydedilen imleç **değişiklikten önceki** konum: geri alan kullanıcı
	 * o adımı yaptığı yere dönmeli.
	 */
	#record(before: Caret | null, doc: Root, coalesceKey: string | null): void {
		this.#history.push({ doc, caret: before }, before, coalesceKey, Date.now());
	}

	// -----------------------------------------------------------------------
	// Arayüz katmanına açılan yüzey  (F3-01)
	// -----------------------------------------------------------------------

	/**
	 * Olay aboneliği; aboneliği bitiren fonksiyonu döndürür.
	 *
	 * Kurucudaki kancalarla aynı anda çalışıyor; ikisi de tetikleniyor.
	 */
	on(event: "change", handler: (value: string, doc: Root) => void): () => void;
	on(event: "selectionchange", handler: (selection: EditorSelection) => void): () => void;
	on(event: "readonlychange", handler: (readOnly: boolean) => void): () => void;
	on(event: EditorEvent, handler: (...args: never[]) => void): () => void {
		const küme = this.#listeners.get(event) ?? new Set();
		küme.add(handler);
		this.#listeners.set(event, küme);
		return () => {
			küme.delete(handler);
		};
	}

	#dispatch(event: EditorEvent, ...args: unknown[]): void {
		for (const handler of this.#listeners.get(event) ?? []) {
			(handler as (...a: unknown[]) => void)(...args);
		}
	}

	/** Editörün kök elemanı — arayüz katmanı buraya konumlanıyor. */
	getElement(): HTMLElement {
		return this.#element;
	}

	/** İmlecin model konumu; seçim tek bir taşıyıcıda değilse `null`. */
	getCaret(): Caret | null {
		return this.#caret();
	}

	/** Belgedeki üst düzey blokların kimlikleri, sırayla. */
	getBlockIds(): readonly NodeId[] {
		return this.#blockOrder();
	}

	/** Kimliğe karşılık gelen blok elemanı. */
	getBlockElement(id: NodeId): HTMLElement | undefined {
		return this.#elements.get(id);
	}

	/**
	 * İmlecin bulunduğu üst düzey bloğun türü.
	 *
	 * Araç çubuğundaki blok türü listesi bunu okuyor. Seçim bir bloğa
	 * düşmüyorsa `null`.
	 */
	getBlockType(): BlockType | null {
		const caret = this.#caret();
		if (caret === null) return null;
		const blok = this.#doc.children[caret.blockIndex];
		if (blok === undefined) return null;
		if (blok.type === "heading") return { type: "heading", depth: blok.depth };
		if (blok.type === "paragraph") return { type: "paragraph" };
		if (blok.type === "blockquote") return { type: "blockquote" };
		if (blok.type === "code") return { type: "code", lang: blok.lang };
		return null;
	}

	/** İmlecin bulunduğu bloğu başka bir türe çevirir. */
	setBlockType(target: BlockType): boolean {
		const caret = this.#caret();
		if (caret === null || this.#readOnly) return false;
		this.#applyEdit({
			doc: setBlockType(this.#doc, [caret.blockIndex], target),
			caret: { blockIndex: caret.blockIndex, path: [], offset: caret.offset },
		});
		return true;
	}

	/**
	 * Blok içi seçimin **canlı** karakter aralığı.
	 *
	 * `getSelection()` önbelleğe alınmış: `selectionchange` olayıyla
	 * güncelleniyor ve o olay bir sonraki göreve ertelenebiliyor. Klavye
	 * kısayolundan hemen sonra sorulduğunda eski cevabı veriyordu — Ctrl+K
	 * ve URL yapıştırma bu yüzden sessizce çalışmıyordu. Bu fonksiyon DOM'u
	 * o an okuyor, yani her zaman güncel.
	 *
	 * Seçim tek bir satır içi taşıyıcıya düşmüyorsa `null`.
	 */
	getTextRange(): { from: number; to: number } | null {
		const hedef = this.#rangeTarget();
		return hedef === null ? null : { from: hedef.from, to: hedef.to };
	}

	/** Güncel seçim — blok içi ya da bloklar arası. */
	getSelection(): EditorSelection {
		return this.#selection;
	}

	/**
	 * Verilen aralıktaki blokları seçer.
	 *
	 * Tek blok verilirse bloklar arası seçim kurulmuyor: tek bloğun içi
	 * tarayıcının işi, oraya karışmak seçim tutamaçlarını ve IME'yi bozar.
	 */
	selectBlocks(anchor: NodeId, focus: NodeId = anchor): void {
		const ilk = this.#elements.get(anchor);
		const son = this.#elements.get(focus);
		if (ilk === undefined || son === undefined) return;

		if (anchor === focus) {
			placeCaret(ilk, "start");
			return;
		}
		const selection = this.#element.ownerDocument.getSelection();
		if (selection === null) return;
		const range = this.#element.ownerDocument.createRange();
		range.setStartBefore(ilk);
		range.setEndAfter(son);
		selection.removeAllRanges();
		selection.addRange(range);
		this.#refreshSelection();
	}

	// -----------------------------------------------------------------------
	// Satır içi biçimlendirme  (F2-07)
	// -----------------------------------------------------------------------

	/**
	 * Seçili aralığa bir biçim uygular ya da kaldırır.
	 *
	 * Seçim boşsa (yalnızca imleç) hiçbir şey yapmıyor ve `false` dönüyor.
	 * Word'de imleçle Ctrl+B'ye basmak "bundan sonra yazacaklarım kalın
	 * olsun" demek; o **saklı işaret** (stored mark) makinesi ayrı bir iş ve
	 * balon araç çubuğuyla birlikte anlam kazanıyor (F3-01).
	 */
	toggleMark(mark: MarkType): boolean {
		return this.#editRange((children, from, to) => applyMark(children, from, to, mark));
	}

	/** Seçili aralık tamamen bu biçimde mi — araç çubuğunun basılı durumu. */
	isMarkActive(mark: MarkType): boolean {
		const hedef = this.#rangeTarget();
		if (hedef === null) return false;
		return markActive(hedef.children, hedef.from, hedef.to, mark);
	}

	/** Seçili aralığı bağlantıya çevirir; `url` boşsa bağlantıyı kaldırır. */
	setLink(url: string): boolean {
		const etkin = this.getActiveLink();
		// İmleç bir bağlantının içindeyse seçim boş olsa bile **tamamı**
		// değiştiriliyor: kullanıcı bağlantıyı düzenlemek için önce onu
		// seçmek zorunda kalmamalı.
		if (etkin !== null) {
			const hedef = this.#rangeTarget();
			if (hedef !== null && hedef.from === hedef.to) {
				return this.#editRangeAt(hedef.blockIndex, hedef.path, etkin.from, etkin.to, (children) =>
					applyLink(children, etkin.from, etkin.to, url),
				);
			}
		}
		return this.#editRange((children, from, to) => applyLink(children, from, to, url));
	}

	/**
	 * İmlecin içinde bulunduğu bağlantı.
	 *
	 * Seçim boş olsa da çalışıyor; bağlantı düzenleme akışı (F3-02) buna
	 * dayanıyor.
	 */
	getActiveLink(): { url: string; title: string | null; from: number; to: number } | null {
		const hedef = this.#rangeTarget();
		if (hedef === null) return null;
		return linkAt(hedef.children, hedef.from);
	}

	/** İlk bloğa odaklanır. */
	focus(): void {
		const ilk = this.#element.firstElementChild;
		if (ilk instanceof HTMLElement && ilk.isContentEditable) ilk.focus();
	}

	/**
	 * Editörü söker.
	 *
	 * DOM içeriği **bırakılıyor**, silinmiyor: sökülen bir editörün yerinde
	 * boş bir kutu bırakmak, kullanıcıya içeriğin kaybolduğunu düşündürür.
	 * Düzenlenebilirlik kaldırılıyor, geriye salt okunur bir belge kalıyor.
	 */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#element.removeEventListener("input", this.#onInput);
		this.#plugins.destroy();
		this.#element.removeEventListener("keydown", this.#onKeyDown);
		this.#element.removeEventListener("beforeinput", this.#onBeforeInput);
		this.#element.removeEventListener("compositionstart", this.#onCompositionStart);
		this.#element.removeEventListener("compositionend", this.#onCompositionEnd);
		this.#element.removeEventListener("copy", this.#onCopy);
		this.#element.removeEventListener("cut", this.#onCut);
		this.#element.removeEventListener("paste", this.#onPaste);
		this.#element.removeEventListener("pointerdown", this.#onPointerDown);
		this.#element.removeEventListener("pointermove", this.#onPointerMove);
		this.#element.ownerDocument.removeEventListener("pointerup", this.#onPointerUp);
		this.#element.ownerDocument.removeEventListener("selectionchange", this.#onSelectionChange);
		this.#paintSelection(null);
		this.#element.removeAttribute("role");
		this.#element.removeAttribute("aria-multiline");
		this.#element.classList.remove(`${this.#prefix}editor`);
		for (const el of this.#elements.values()) el.removeAttribute("contenteditable");
		this.#elements.clear();
		this.#rendered.clear();
		this.#listeners.clear();
	}

	// -----------------------------------------------------------------------
	// İç işleyiş
	// -----------------------------------------------------------------------

	#context(): RenderContext {
		return {
			document: this.#element.ownerDocument,
			prefix: this.#prefix,
			defs: this.#defs,
		};
	}

	#replaceDocument(doc: Root): void {
		this.#record(this.#caret(), doc, null);
		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		this.#sync();
		this.#emit();
	}

	/**
	 * Modeli DOM'a yansıtır.
	 *
	 * Klasik "imleci koru" sorunundan kaçınmak için değişmeyen bloklara
	 * **hiç dokunulmuyor**: referans aynıysa eleman olduğu gibi kalır, o
	 * bloktaki seçim ve IME bileşimi bozulmaz.
	 */
	#sync(): void {
		const ctx = this.#context();
		const parent = this.#element;
		const kalan = new Set(this.#elements.keys());

		let cursor: ChildNode | null = parent.firstChild;
		for (const node of this.#doc.children) {
			const id = node.id as string;
			kalan.delete(id);

			let element = this.#elements.get(id);
			// Etiket değiştiyse (paragraf → başlık) eleman yeniden kurulmalı:
			// bir `<p>` `<h2>`ye dönüşemez.
			if (element !== undefined && element.localName !== tagOf(node)) {
				// İmleç bu elemanı gösteriyorsa **önce** ilerletiliyor.
				// Kaldırılmış bir düğüme `insertBefore` yapmak
				// `NotFoundError` atıyor ve o hata tüm editör DOM'unu boş
				// bırakıyordu — giriş kuralları yazılırken tam olarak bu oldu.
				if (cursor === element) cursor = element.nextSibling;
				element.remove();
				element = undefined;
			}
			if (element === undefined) {
				element = createBlockElement(node, ctx);
				this.#elements.set(id, element);
				this.#rendered.set(id, node);
			} else if (this.#rendered.get(id) !== node) {
				fillBlock(element, node, ctx);
				this.#rendered.set(id, node);
			}

			if (cursor === element) cursor = element.nextSibling;
			else parent.insertBefore(element, cursor);
		}

		// Kalanlar modelden çıkmış bloklar.
		while (cursor !== null) {
			const next: ChildNode | null = cursor.nextSibling;
			cursor.remove();
			cursor = next;
		}
		for (const id of kalan) {
			this.#elements.delete(id);
			this.#rendered.delete(id);
		}

		this.#applyReadOnly();
	}

	#applyReadOnly(): void {
		for (const [id, element] of this.#elements) {
			const node = this.#rendered.get(id);
			const editable = !this.#readOnly && node?.type !== "thematicBreak";
			element.contentEditable = editable ? "true" : "false";
		}
		this.#element.setAttribute("aria-readonly", String(this.#readOnly));
	}

	#emit(): void {
		const onChange = this.#options.onChange;
		const aboneler = this.#listeners.get("change");
		// Serileştirme yalnızca dinleyen varsa çalışıyor.
		if (onChange === undefined && (aboneler === undefined || aboneler.size === 0)) return;
		/*
		 * Önbellek açık: editör kendi belgesinin sahibi.
		 *
		 * Ölçüm (F6-08) tuş başına maliyetin tamamının burada olduğunu
		 * gösterdi — 5.000 bloklu belgede tek bir tuş 18,9 ms serileştirme
		 * demekti, yani bir kareden fazla. Oysa tuş **tek bir bloğu**
		 * değiştiriyor ve model kalıcı: geri kalan bloklar aynı nesne
		 * olarak kalıyor, o yüzden yeniden yazılmaları gerekmiyor.
		 *
		 * Önbellek `@kalem/core`'da varsayılan olarak kapalı çünkü AST
		 * herkese açık ve yerinde değiştirilirse bayat çıktı verir. Burada
		 * açılabiliyor: bu belgeyi üreten de, değiştiren de editörün
		 * kendisi.
		 */
		const value = serialize(this.#doc, { cache: this.#serializeCache });
		onChange?.(value, this.#doc);
		this.#dispatch("change", value, this.#doc);
	}

	/**
	 * Yazma olayı: değişen bloğun satır içi içeriğini DOM'dan geri okur.
	 *
	 * Blok yeniden **render edilmiyor** — DOM zaten doğru, modeli ona
	 * eşitliyoruz. `#rendered` haritası da yeni düğümle güncelleniyor ki
	 * sonraki `#sync` bu bloğu "değişmiş" sanıp elemanı yeniden kurmasın
	 * (kurarsa imleç başa kaçar).
	 */
	#onInput = (): void => {
		if (this.#readOnly) return;
		/*
		 * Odaklı eleman **editörün kendi kökünden** soruluyor.
		 *
		 * Editör bir gölge kökün içindeyse (`@kalem/wc`nin `shadow` kipi,
		 * F5-03) `document.activeElement` düzenlenen bloğu değil, gölgeyi
		 * taşıyan ana makineyi veriyor — `closest` boş dönüyor ve model
		 * kullanıcının yazdığını hiç görmüyor. `getRootNode()` belgede
		 * belgeyi, gölgede gölge kökü veriyor; ikisinde de doğru cevap.
		 */
		const kok = this.#element.getRootNode() as Document | ShadowRoot;
		const active = kok.activeElement;
		const blockElement = active?.closest?.(`[${ID_ATTR}]`);
		if (!(blockElement instanceof HTMLElement)) return;
		this.#syncFromDom(blockElement);
		this.#runInputRules();
	};

	/**
	 * Giriş kurallarını çalıştırır.
	 *
	 * Yazma modele işlendikten **sonra** çalışıyor: kural, kullanıcının
	 * gerçekten yazdığı metni görmeli. Dönüşüm ayrı bir geçmiş kaydı olarak
	 * yazılıyor, yani tek bir Ctrl+Z kuralı iptal edip metni olduğu gibi
	 * bırakıyor — "`# ` yazdım ama başlık istemiyordum" durumunun tek makul
	 * cevabı bu.
	 */
	#onCompositionStart = (): void => {
		this.#composing = true;
	};

	/**
	 * Bileşim bitti: model zaten `input` üzerinden güncellendi, geriye
	 * kuralları çalıştırmak kalıyor. Bileşim **sırasında** çalıştırılamazlar
	 * çünkü dönüşüm bloğu yeniden basar ve yarım kalan heceyi düşürür.
	 */
	#onCompositionEnd = (): void => {
		this.#composing = false;
		this.#runInputRules();
	};

	#runInputRules(): void {
		if (this.#options.inputRules === false || this.#composing) return;
		const caret = this.#caret();
		if (caret === null) return;
		this.#applyEdit(this.#plugins.runInputRules(this.#doc, caret));
	}

	/**
	 * Tarayıcının kendi geri alma yığınını devre dışı bırakır.
	 *
	 * `contenteditable` her tarayıcıda kendi geçmişini tutuyor ve o geçmiş
	 * bizim modelimizden habersiz: kullanıcı Ctrl+Z'ye bastığında tarayıcı
	 * DOM'u eski hâline döndürüp modeli olduğu yerde bırakabiliyor, ikisi
	 * ayrışıyor. Menüden ya da dokunmatik jestle gelen geri alma da
	 * `beforeinput` üzerinden geçiyor — klavye kısayolunu engellemek tek
	 * başına yetmez.
	 */
	#onBeforeInput = (event: InputEvent): void => {
		if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
		event.preventDefault();
		if (this.#readOnly) return;
		if (event.inputType === "historyUndo") this.undo();
		else this.redo();
	};

	// -----------------------------------------------------------------------
	// Pano  (F2-11)
	// -----------------------------------------------------------------------

	#onCopy = (event: ClipboardEvent): void => {
		this.#writeClipboard(event);
	};

	/**
	 * Yapıştırma  (F3-07)
	 *
	 * Tarayıcının kendi yapıştırması **her zaman** durduruluyor: HTML'i
	 * olduğu gibi `contenteditable`'a gömmek, Word'ün `mso-*` çöpünü
	 * modele sokmak demek. İçerik `paste.ts` boru hattından geçip belgeye
	 * model olarak giriyor.
	 */
	#onPaste = (event: ClipboardEvent): void => {
		if (this.#readOnly) return;
		// Dışarıdan bir işleyici yapıştırmayı zaten tükettiyse editör ona
		// dokunmuyor — `keydown`daki kuralın aynısı (F3-03). Arayüz katmanı
		// URL yapıştırmayı böyle devralıyor (F3-02) ve olayı **yakalama
		// evresinde** dinlediği için buradan önce çalışıyor.
		if (event.defaultPrevented) return;
		const veri = event.clipboardData;
		if (veri === null) return;

		const girdi: PasteInput = {
			html: veri.getData("text/html"),
			text: veri.getData("text/plain"),
		};
		if (girdi.html === "" && girdi.text === "") return;

		event.preventDefault();
		const parca = pasteFragment(girdi, (html) => this.#parseHtml(html), {
			// Ctrl+Shift+V: bir sonraki yapıştırma biçimsiz.
			plainOnly: this.#plainPaste,
			...(this.#options.parseMarkdownOnPaste !== undefined
				? { parseMarkdown: this.#options.parseMarkdownOnPaste }
				: {}),
		});
		this.#plainPaste = false;
		this.#insertPaste(parca);
	};

	/**
	 * HTML metnini ayrıştırır.
	 *
	 * `DOMParser` kullanılıyor, `innerHTML` değil: ayrıştırılan belge
	 * **bağlantısız** (inert) — script çalışmıyor, `<img>` istek atmıyor.
	 * Yapıştırılan içerik kullanıcının yazdığı bir şey değil ve ona
	 * güvenilmiyor.
	 */
	#parseHtml(html: string): Element | null {
		const view = this.#element.ownerDocument.defaultView;
		if (view === undefined || view === null) return null;
		const belge = new view.DOMParser().parseFromString(html, "text/html");
		return belge.body;
	}

	/** Parçayı seçimin yerine koyar. */
	#insertPaste(parca: Root): void {
		// Seçili metin varsa önce siliniyor: yapıştırma her editörde
		// seçimin **yerine** geçiyor.
		if (this.#selection?.kind === "block") this.#deleteSelectedBlocks();
		else this.#deleteSelectedText();

		const caret = this.getCaret();
		if (caret === null) return;
		this.applyEdit(insertFragment(this.#doc, caret, parca));
	}

	/**
	 * Sıradaki yapıştırmayı biçimsiz yapar (Ctrl+Shift+V).
	 *
	 * Bayrak tek seferlik: bir kez biçimsiz yapıştıran kullanıcı, bundan
	 * sonraki bütün yapıştırmaların da biçimsiz olmasını istemiyor.
	 */
	pasteWithoutFormatting(): void {
		this.#plainPaste = true;
	}

	#onCut = (event: ClipboardEvent): void => {
		if (this.#readOnly) return;
		if (!this.#writeClipboard(event)) return;
		// Kesme, kopyalamanın ardından silme. Tarayıcının kendi silmesi
		// `preventDefault` ile durduruldu; model üzerinden yapılıyor ki
		// bloklar arası kesme de çalışsın.
		if (this.#selection?.kind === "block") this.#deleteSelectedBlocks();
		else this.#deleteSelectedText();
	};

	/**
	 * Seçimi panoya yazar; yazacak bir şey yoksa `false` döner.
	 *
	 * Boş seçimde hiçbir şey yapılmıyor ve olay tarayıcıya bırakılıyor —
	 * imleçle Ctrl+C basmak bir şey kopyalamaz.
	 */
	#writeClipboard(event: ClipboardEvent): boolean {
		const veri = event.clipboardData;
		if (veri === null) return false;

		if (this.#selection?.kind === "block") {
			const secili = new Set(selectedRange(this.#selection, this.#blockOrder()));
			const bloklar = this.#doc.children.filter((c) => secili.has(c.id as NodeId));
			if (bloklar.length === 0) return false;
			const yuk = blocksPayload({ type: "root", children: bloklar as Root["children"] });
			event.preventDefault();
			veri.setData("text/plain", yuk.text);
			veri.setData("text/html", yuk.html);
			return true;
		}

		const hedef = this.#rangeTarget();
		if (hedef === null || hedef.from >= hedef.to) return false;
		const yuk = inlinePayload(sliceInline(hedef.children, hedef.from, hedef.to));
		event.preventDefault();
		veri.setData("text/plain", yuk.text);
		veri.setData("text/html", yuk.html);
		return true;
	}

	/** Blok içi seçili aralığı siler ve imleci başına koyar. */
	#deleteSelectedText(): void {
		const hedef = this.#rangeTarget();
		if (hedef === null || hedef.from >= hedef.to) return;

		const dugum = nodeAt(this.#doc.children[hedef.blockIndex], hedef.path) as object;
		const doc = replaceAt(this.#doc, [hedef.blockIndex, ...hedef.path], {
			...dugum,
			children: spliceInline(hedef.children, hedef.from, hedef.to, []),
		} as never);

		this.#record({ blockIndex: hedef.blockIndex, path: hedef.path, offset: hedef.from }, doc, null);
		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		this.#sync();
		this.#placeCaretAt({ blockIndex: hedef.blockIndex, path: hedef.path, offset: hedef.from });
		this.#emit();
	}

	// -----------------------------------------------------------------------
	// Seçim  (F2-06)
	// -----------------------------------------------------------------------

	#onSelectionChange = (): void => {
		// Sürükleyerek blok seçerken tarayıcının seçimi bizimkinin gerisinde
		// kalıyor (aşağıdaki `#onPointerMove` onu zaten temizledi); onu
		// dinlemek kendi seçimimizi silerdi.
		if (this.#blockDrag) return;
		this.#refreshSelection();
	};

	#refreshSelection(): void {
		this.#applySelection(readSelection(this.#element));
	}

	/**
	 * Okunan seçimi uygular ve gerekiyorsa haber verir.
	 *
	 * `EditorSelection` kaba: metin seçiminde yalnızca hangi blokta olduğu
	 * ve boş olup olmadığı yazıyor, **ofset yazmıyor**. Bloğun içinde imleci
	 * gezdirmek o tanımı değiştirmiyor ve olay hiç doğmuyordu. Sabit araç
	 * çubuğu (F3-06) bunu ortaya çıkardı: kalın bir kelimenin içine tıklamak
	 * B düğmesini yakmıyordu, çünkü çubuğa haber gitmiyordu.
	 *
	 * Bu yüzden imlecin kendisi de karşılaştırılıyor. `EditorSelection`e
	 * ofset **eklenmedi**: o tip bloklar arası seçimi de anlatıyor ve
	 * ofsetin orada karşılığı yok.
	 */
	#applySelection(okunan: EditorSelection): void {
		const caret = this.#caret();
		const secimDegisti = !sameSelection(okunan, this.#selection);
		const imlecDegisti = !sameCaret(caret, this.#lastCaret);
		if (!secimDegisti && !imlecDegisti) return;

		this.#lastCaret = caret;
		// Boyama yalnızca seçim tanımı değişince: imleç gezdirmek blok
		// vurgularını yeniden çizmeyi gerektirmiyor.
		if (secimDegisti) {
			this.#selection = okunan;
			this.#paintSelection(okunan);
		}
		this.#options.onSelectionChange?.(okunan);
		this.#dispatch("selectionchange", okunan);
	}

	/**
	 * Bloklar arası sürükleyerek seçim.
	 *
	 * ## Neden elle yazmak zorunda kaldık
	 *
	 * `contenteditable` blok başına verilince (F2-05) Chrome, bir düzenleme
	 * kökünün içinde başlayan seçimi **o kökün dışına taşımıyor**: kullanıcı
	 * fareyi bir sonraki bloğa sürüklese de seçim ilk blokta kalıyor. Firefox
	 * ve WebKit daha izin verici, ama üçünde aynı davranışı vaat ediyorsak
	 * en kısıtlayıcısına göre yazmak gerekiyor.
	 *
	 * Bu, F1.5 doğrulama matrisinin sınayacağı riskli senaryolardan biriydi
	 * ve atlandığı için burada, gerçek kodda karşımıza çıktı.
	 *
	 * ## Nasıl
	 *
	 * İşaretçi bir blokta basılıp **başka** bir bloğa geçtiği anda blok
	 * moduna geçiliyor: tarayıcının aralığı temizleniyor, seçim kendi
	 * modelimizde tutuluyor. Tek blok içinde kalındığı sürece hiç
	 * karışmıyoruz — orada tarayıcı bizden iyi.
	 *
	 * `pointer` olayları kullanılıyor, `mouse` değil: aynı kod dokunmatik
	 * ekranda da çalışsın.
	 */
	#onPointerDown = (event: PointerEvent): void => {
		if (!event.isPrimary) return;
		const blok = this.#blockOf(event.target);
		this.#dragAnchor = blok === null ? null : (blok.getAttribute(ID_ATTR) as NodeId);
		this.#blockDrag = false;
	};

	#onPointerMove = (event: PointerEvent): void => {
		const anchor = this.#dragAnchor;
		if (anchor === null) return;
		// Birincil düğme bırakılmışsa sürükleme bitmiştir (pointerup kaçmış olabilir).
		if ((event.buttons & 1) === 0) {
			this.#dragAnchor = null;
			return;
		}

		const blok = this.#blockOf(event.target);
		if (blok === null) return;
		const focus = blok.getAttribute(ID_ATTR) as NodeId;

		// Hâlâ başladığımız bloktayız: metin seçimi tarayıcının işi.
		if (focus === anchor && !this.#blockDrag) return;

		if (!this.#blockDrag) {
			this.#blockDrag = true;
			// Tarayıcının kısmi vurgusu ekranda kalmasın; artık blok seçiyoruz.
			this.#element.ownerDocument.getSelection()?.removeAllRanges();
		}
		// Metnin sürükle-bırak ile taşınmaya başlamasını engelliyor.
		event.preventDefault();
		this.#applySelection({ kind: "block", anchor, focus });
	};

	#onPointerUp = (): void => {
		this.#dragAnchor = null;
	};

	/**
	 * Bir olay hedefinin ya da DOM düğümünün ait olduğu blok elemanı.
	 *
	 * Metin düğümü de kabul ediyor: seçim sınırları neredeyse her zaman
	 * metin düğümüdür ve yalnızca `Element` beklemek sessizce `null`
	 * döndürüyordu — bloklar arası ok tuşu gezinmesi tam bu yüzden hiç
	 * çalışmıyordu.
	 */
	#blockOf(target: EventTarget | Node | null): HTMLElement | null {
		const element =
			target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
		const blok = element?.closest(`[${ID_ATTR}]`);
		return blok instanceof HTMLElement && this.#element.contains(blok) ? blok : null;
	}

	/**
	 * Bloklar arası seçimi görünür kılar.
	 *
	 * Tarayıcının kendi vurgusu bu durumda yanıltıcı: iki düzenleme kökünü
	 * kapsayan seçimi kısmen boyar ama üzerinde hiçbir işlem yapmaz.
	 * Kapsayıcıya konan sınıf, tema CSS'inde `::selection`'ı saydamlaştırıp
	 * yerine blok vurgusunu koyuyor — kullanıcı **blok seçtiğini** görsün.
	 */
	#paintSelection(selection: EditorSelection): void {
		const secili = new Set<string>(
			selection?.kind === "block" ? selectedRange(selection, this.#blockOrder()) : [],
		);
		for (const [id, element] of this.#elements) {
			element.classList.toggle(`${this.#prefix}selected`, secili.has(id));
		}
		this.#element.classList.toggle(`${this.#prefix}block-selecting`, secili.size > 0);
	}

	#blockOrder(): NodeId[] {
		return this.#doc.children.map((child) => child.id as NodeId);
	}

	/**
	 * Klavye — şimdilik yalnızca bloklar arası silme.
	 *
	 * Blok içi tuşlar tarayıcıya bırakılıyor; Enter/Backspace'in blok
	 * sınırındaki davranışı F2-08'in işi. Buradaki tek iş, tarayıcının
	 * **yapamadığı** şey: birden çok düzenleme kökünü kapsayan seçimi silmek.
	 */
	#onKeyDown = (event: KeyboardEvent): void => {
		if (this.#readOnly) return;
		// Dışarıdan bir işleyici tuşu zaten tükettiyse editör ona dokunmuyor.
		//
		// `preventDefault()` yayılmayı durdurmuyor, yalnızca varsayılan
		// davranışı iptal ediyor. Bu kontrol olmadan arayüz katmanının
		// yakaladığı Enter hem menüde öğe seçiyor **hem de** bloğu bölüyordu —
		// slash menü yazılırken tam olarak bu oldu ve tek Ctrl+Z'yi de
		// bozuyordu.
		if (event.defaultPrevented) return;
		// Tarayıcı henüz hiçbir şeye dokunmadı; geri almanın döneceği yer bu.
		this.#caretBeforeKey = this.#caret();

		// Eklentiler çekirdekten önce: kayıt sırası tek çakışma kuralı.
		if (this.#plugins.handleKey(event)) {
			event.preventDefault();
			return;
		}

		if (this.#selection?.kind === "block") {
			if (event.key !== "Backspace" && event.key !== "Delete") return;
			event.preventDefault();
			this.#deleteSelectedBlocks();
			return;
		}

		if (event.ctrlKey || event.metaKey) {
			// Ctrl+Shift+V — biçimsiz yapıştır. Olay engellenmiyor: tarayıcı
			// kendi `paste` olayını üretmeye devam ediyor, biz yalnızca onu
			// nasıl işleyeceğimizi işaretliyoruz. Engellemek, bazı
			// tarayıcılarda pano olayının hiç doğmamasına yol açıyor.
			// kalem-locale-ok: tuş adları ASCII; Türkçe kuralı burada zarar verir
			if (event.shiftKey && event.key.toLowerCase() === "v") {
				this.#plainPaste = true;
				return;
			}
			this.#formatShortcut(event);
			if (!event.defaultPrevented) this.#blockShortcut(event);
			return;
		}
		this.#structureKey(event);
	};

	/**
	 * Blok yapısını değiştiren tuşlar.
	 *
	 * Hepsinde ortak kalıp: imleci bul, saf bir model işlemi çağır, sonucu
	 * uygula. Karar verme işi `block-edit.ts`'te ve DOM'a hiç dokunmuyor;
	 * burada yalnızca hangi tuşun hangi işleme gittiği yazıyor.
	 */
	#structureKey(event: KeyboardEvent): void {
		// Kaynak blokları (kod, ham HTML, frontmatter) `#caret()`'ten **önce**
		// ele alınıyor: onların satır içi taşıyıcısı yok, dolayısıyla `#caret()`
		// her zaman `null` dönüyor ve aşağıdaki erken çıkış Enter'ı sessizce
		// tarayıcıya bırakıyordu. WebKit de `<pre contenteditable>` içinde
		// Enter'a basınca içeriği yeniden yapılandırıp mevcut satırı yutuyordu.
		if (event.key === "Enter" && this.#sourceHolder() !== null) {
			event.preventDefault();
			this.#insertIntoSource(SATIR_SONU);
			return;
		}

		const caret = this.#caret();
		if (caret === null) return;

		if (event.key === "Enter") {
			event.preventDefault();
			this.#applyEdit(
				event.shiftKey ? insertBreak(this.#doc, caret) : splitAtCaret(this.#doc, caret),
			);
			return;
		}

		if (event.key === "Tab" && caret.path.length >= 2) {
			event.preventDefault();
			this.#applyEdit(
				event.shiftKey ? outdentItem(this.#doc, caret) : indentItem(this.#doc, caret),
			);
			return;
		}

		if (event.key === "Backspace" && this.#atStart()) {
			const sonuc = mergeWithPrevious(this.#doc, caret);
			if (sonuc === null) return;
			event.preventDefault();
			this.#applyEdit(sonuc);
			return;
		}

		if (event.key === "Delete" && this.#atEnd()) {
			const sonuc = mergeWithNext(this.#doc, caret);
			if (sonuc === null) return;
			event.preventDefault();
			this.#applyEdit(sonuc);
			return;
		}

		this.#arrowKey(event, caret);
	}

	/**
	 * Bloklar arası ok tuşu gezinmesi.
	 *
	 * Blok içinde tarayıcıya karışılmıyor — satır sarması, çift yönlü metin
	 * ve grapheme sınırları onun işi. Yalnızca **sınırda** devralınıyor:
	 * bloğun ilk satırında yukarı, son satırında aşağı.
	 *
	 * Satırın ilk/son olup olmadığı imlecin ekran konumundan anlaşılıyor;
	 * ofsete bakmak sarmalanmış paragrafta yanlış cevap verirdi (3 satırlık
	 * bir paragrafın 2. satırında ofset ne baştadır ne sonda).
	 */
	#arrowKey(event: KeyboardEvent, caret: Caret): void {
		const yon =
			event.key === "ArrowUp" || (event.key === "ArrowLeft" && this.#atStart())
				? -1
				: event.key === "ArrowDown" || (event.key === "ArrowRight" && this.#atEnd())
					? 1
					: 0;
		if (yon === 0 || event.shiftKey) return;

		if (event.key === "ArrowUp" && !this.#atEdge("start")) return;
		if (event.key === "ArrowDown" && !this.#atEdge("end")) return;

		const hedef = this.#doc.children[caret.blockIndex + yon];
		if (hedef === undefined) return;
		const element = this.#elements.get(hedef.id as string);
		if (element === undefined) return;

		event.preventDefault();
		placeCaret(element, yon === -1 ? "end" : "start");
	}

	/** Blok türü kısayolları: başlık, paragraf, liste, alıntı. */
	#blockShortcut(event: KeyboardEvent): void {
		const caret = this.#caret();
		if (caret === null) return;

		if (event.altKey) {
			const derinlik = Number(event.key);
			if (!Number.isInteger(derinlik) || derinlik < 0 || derinlik > 6) return;
			event.preventDefault();
			const hedef: BlockType =
				derinlik === 0
					? { type: "paragraph" }
					: { type: "heading", depth: derinlik as 1 | 2 | 3 | 4 | 5 | 6 };
			this.#applyEdit({
				doc: setBlockType(this.#doc, [caret.blockIndex], hedef),
				caret: { ...caret, path: [] },
			});
			return;
		}

		if (!event.shiftKey) return;
		// Word ve GitHub ile aynı: Ctrl+Shift+8 madde imli, 7 numaralı liste.
		if (event.key === "*" || event.key === "8") {
			event.preventDefault();
			this.#applyEdit(toggleList(this.#doc, caret, false));
			return;
		}
		if (event.key === "&" || event.key === "7") {
			event.preventDefault();
			this.#applyEdit(toggleList(this.#doc, caret, true));
		}
	}

	/**
	 * Biçim kısayolları.
	 *
	 * Ctrl+U burada **hiçbir şey yapmadan** engelleniyor: Markdown'da altı
	 * çizili yok ve engellenmezse tarayıcı `<u>` üretir, o da bir sonraki
	 * okumada sessizce kaybolur. Kullanıcının bastığı tuşun izsiz kaybolması,
	 * hiç tepki vermemesinden kötü.
	 *
	 * Kalan kısayollar (geri alma, liste, başlık) F2-08 ve F2-09'da.
	 */
	#formatShortcut(event: KeyboardEvent): void {
		// kalem-locale-ok: tuş adları ASCII; Türkçe kuralı burada zarar verir
		const tus = event.key.toLowerCase();

		if (tus === "z") {
			event.preventDefault();
			// Ctrl+Shift+Z, Ctrl+Y'nin yaygın ikizi.
			if (event.shiftKey) this.redo();
			else this.undo();
			return;
		}
		if (tus === "y") {
			event.preventDefault();
			this.redo();
			return;
		}

		if (tus === "u") {
			event.preventDefault();
			return;
		}
		const mark = KISAYOLLAR[tus];
		if (mark === undefined) return;
		// Ctrl+Shift+X üstü çizili; Ctrl+X kesme olarak kalmalı.
		if (mark === "delete" && !event.shiftKey) return;
		if (mark !== "delete" && event.shiftKey) return;

		event.preventDefault();
		this.toggleMark(mark);
	}

	/**
	 * Seçili blokları siler.
	 *
	 * Belge tamamen boşalırsa yerine boş bir paragraf konuyor: bloğu
	 * olmayan editöre tıklanacak yer kalmaz, kullanıcı yazmaya devam
	 * edemez.
	 */
	#deleteSelectedBlocks(): void {
		const selection = this.#selection;
		if (selection?.kind !== "block") return;

		const order = this.#blockOrder();
		const secili = selectedRange(selection, order);
		if (secili.length === 0) return;

		const ilk = order.indexOf(secili[0] as NodeId);
		let doc = this.#doc;
		for (let i = secili.length - 1; i >= 0; i--) doc = removeAt(doc, [ilk + i]);
		if (doc.children.length === 0) {
			doc = { ...doc, children: [{ ...emptyParagraph(), id: newId() }] };
		}

		this.#selection = null;
		this.#blockDrag = false;
		this.#dragAnchor = null;
		this.#replaceDocument(doc);

		// İmleç silinen aralığın **öncesine** gidiyor; öncesi yoksa ilk bloğa.
		// Silmenin ardından odak kaybolursa kullanıcı yazmaya devam edemez.
		const hedefIndex = Math.max(0, ilk - 1);
		const hedef = this.#elements.get(doc.children[hedefIndex]?.id as NodeId);
		if (hedef !== undefined) placeCaret(hedef, ilk === 0 ? "start" : "end");
	}

	// -----------------------------------------------------------------------
	// Biçimlendirmenin iç işleyişi  (F2-07)
	// -----------------------------------------------------------------------

	/**
	 * Seçimin düştüğü içerik taşıyıcısını ve karakter aralığını bulur.
	 *
	 * Taşıyıcı = `data-kalem-path` taşıyan eleman, yani modelde `children`'ı
	 * satır içi olan düğüm (paragraf, başlık, tablo hücresi, madde
	 * paragrafı). Seçim iki taşıyıcıya yayılıyorsa `null`: bir paragrafın
	 * yarısı ile diğerinin yarısını birlikte kalınlaştırmak, iki ayrı
	 * düzenleme demek ve F2-07'nin kapsamında değil.
	 */
	#rangeTarget(): {
		holder: HTMLElement;
		blockIndex: number;
		path: number[];
		children: readonly Inline[];
		from: number;
		to: number;
	} | null {
		const selection = this.#element.ownerDocument.getSelection();
		if (selection === null || selection.rangeCount === 0) return null;

		const range = selection.getRangeAt(0);
		const holder = holderOf(range.startContainer, this.#element);
		if (holder === null || holder !== holderOf(range.endContainer, this.#element)) return null;

		const blockElement = holder.closest(`[${ID_ATTR}]`);
		if (!(blockElement instanceof HTMLElement)) return null;
		const blockIndex = this.#indexOf(blockElement);
		if (blockIndex < 0) return null;

		const path = parsePath(holder.getAttribute(PATH_ATTR));
		const hedef = nodeAt(this.#doc.children[blockIndex], path) as
			| { children?: readonly Inline[] }
			| undefined;
		if (hedef?.children === undefined) return null;

		const from = offsetOf(holder, range.startContainer, range.startOffset);
		const to = offsetOf(holder, range.endContainer, range.endOffset);
		return { holder, blockIndex, path, children: hedef.children, from, to };
	}

	/**
	 * Seçili aralığı dönüştürür ve seçimi geri koyar.
	 *
	 * Blok yeniden basıldığı için DOM düğümleri değişiyor; seçim karakter
	 * ofsetiyle yeniden kuruluyor. Aralığın **uzunluğu değişmediği** için
	 * (biçim ekleniyor, metin değil) eski ofsetler geçerli kalıyor.
	 */
	#editRange(
		donustur: (children: readonly Inline[], from: number, to: number) => Inline[],
	): boolean {
		if (this.#readOnly) return false;
		const hedef = this.#rangeTarget();
		if (hedef === null || hedef.from >= hedef.to) return false;
		return this.#editRangeAt(hedef.blockIndex, hedef.path, hedef.from, hedef.to, donustur);
	}

	/**
	 * Verilen aralığı dönüştürür.
	 *
	 * `#editRange`ten ayrı: orası aralığı **seçimden** alıyor, burası
	 * çağırandan. Bağlantı düzenlemede imleç boş olsa bile bağlantının
	 * tamamı değiştiriliyor ve o aralık seçimde yok.
	 */
	#editRangeAt(
		blockIndex: number,
		path: readonly number[],
		from: number,
		to: number,
		donustur: (children: readonly Inline[], from: number, to: number) => Inline[],
	): boolean {
		if (this.#readOnly) return false;
		const dugumHam = nodeAt(this.#doc.children[blockIndex], path) as
			| { children?: readonly Inline[] }
			| undefined;
		if (dugumHam?.children === undefined) return false;
		const hedef = { blockIndex, path, children: dugumHam.children, from, to };

		const donusen = donustur(hedef.children, hedef.from, hedef.to);
		const dugum = nodeAt(this.#doc.children[hedef.blockIndex], hedef.path) as object;
		const doc = replaceAt(this.#doc, [hedef.blockIndex, ...hedef.path], {
			...dugum,
			children: donusen,
		} as never);

		// Seçim `onChange`'den **önce** geri konuyor.
		//
		// `#replaceDocument` kullanılsaydı kanca, blok yeniden basılmış ama
		// seçim henüz kurulmamışken çağrılırdı; o anda `isMarkActive`
		// sorulunca cevap yanlış çıkıyordu (demo düğmeleri bunu yakaladı).
		// Dinleyici her zaman tutarlı bir durum görmeli.
		this.#record({ blockIndex: hedef.blockIndex, path: hedef.path, offset: hedef.from }, doc, null);
		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		this.#sync();

		const blockElement = this.#elements.get(doc.children[hedef.blockIndex]?.id as string);
		const holder = blockElement === undefined ? null : holderAt(blockElement, hedef.path);
		if (holder !== null) selectRange(holder, hedef.from, hedef.to);

		this.#emit();
		return true;
	}

	/**
	 * Kaynak bloğunun metnine imleçte metin ekler.
	 *
	 * Satır içi taşıyıcılardan ayrı bir yol, çünkü içerik `Inline[]` değil
	 * düz bir `value`: kesme, biçim ve normalleştirme burada geçerli değil.
	 */
	#sourceHolder(): HTMLElement | null {
		const selection = this.#element.ownerDocument.getSelection();
		if (selection === null || selection.rangeCount === 0) return null;
		const node = selection.getRangeAt(0).startContainer;
		const element = node instanceof Element ? node : node.parentElement;
		const holder = element?.closest(`[${CODE_ATTR}]`);
		return holder instanceof HTMLElement && this.#element.contains(holder) ? holder : null;
	}

	#insertIntoSource(metin: string): void {
		const selection = this.#element.ownerDocument.getSelection();
		if (selection === null || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);

		const holder = this.#sourceHolder();
		if (holder === null) return;

		const blockElement = holder.closest(`[${ID_ATTR}]`);
		if (!(blockElement instanceof HTMLElement)) return;
		const blockIndex = this.#indexOf(blockElement);
		if (blockIndex < 0) return;

		const path = parsePath(holder.getAttribute(CODE_ATTR));
		const dugum = nodeAt(this.#doc.children[blockIndex], path) as { value?: string } | undefined;
		if (dugum?.value === undefined) return;

		const bas = offsetOf(holder, range.startContainer, range.startOffset);
		const bit = offsetOf(holder, range.endContainer, range.endOffset);
		const deger = dugum.value.slice(0, bas) + metin + dugum.value.slice(bit);

		const doc = replaceAt(this.#doc, [blockIndex, ...path], { ...dugum, value: deger } as never);
		this.#record({ blockIndex, path, offset: bas }, doc, null);
		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		this.#sync();

		const yeniBlok = this.#elements.get(doc.children[blockIndex]?.id as string);
		const yeniHolder = yeniBlok?.querySelector(`[${CODE_ATTR}]`);
		if (yeniHolder instanceof HTMLElement) {
			selectRange(yeniHolder, bas + metin.length, bas + metin.length);
			(yeniBlok as HTMLElement).focus({ preventScroll: true });
		}
		this.#emit();
	}

	/** İmlecin model konumu; seçim tek bir taşıyıcıda değilse `null`. */
	#caret(): Caret | null {
		const hedef = this.#rangeTarget();
		if (hedef === null) return null;
		return { blockIndex: hedef.blockIndex, path: hedef.path, offset: hedef.from };
	}

	#atStart(): boolean {
		const hedef = this.#rangeTarget();
		return hedef !== null && hedef.from === 0 && hedef.to === 0;
	}

	#atEnd(): boolean {
		const hedef = this.#rangeTarget();
		if (hedef === null || hedef.from !== hedef.to) return false;
		return hedef.from === contentLength(hedef.holder);
	}

	/**
	 * İmleç bloğun ilk/son **görsel satırında** mı.
	 *
	 * Ofsete bakmak yetmiyor: sarmalanmış bir paragrafın ortasındaki satırda
	 * imleç ne baştadır ne sonda, ama ArrowUp yine de bir üst satıra gitmeli.
	 * Karar imlecin ekran konumundan veriliyor.
	 */
	#atEdge(kenar: "start" | "end"): boolean {
		const selection = this.#element.ownerDocument.getSelection();
		if (selection === null || selection.rangeCount === 0) return false;
		const range = selection.getRangeAt(0);
		const blok = this.#blockOf(range.startContainer);
		if (blok === null) return false;

		const imlec = range.getBoundingClientRect();
		// Boş blokta imleç dikdörtgeni sıfır gelir; orada tek satır vardır.
		if (imlec.top === 0 && imlec.bottom === 0) return true;

		// Bloğun **kutusuyla** karşılaştırmak yetmiyordu: satır yüksekliği
		// metnin kendisinden büyük olduğu için tek satırlık bir blokta bile
		// imleç kutunun altına birkaç piksel uzakta kalıyor ve "son satırda
		// değilim" cevabı çıkıyordu. Onun yerine bloğun ilk/son satırının
		// dikdörtgeni ölçülüyor — imleç oraya oturuyorsa kenardayız.
		const doc = this.#element.ownerDocument;
		const kenarAralik = doc.createRange();
		kenarAralik.selectNodeContents(blok);
		kenarAralik.collapse(kenar === "start");
		const hedef = kenarAralik.getBoundingClientRect();
		if (hedef.top === 0 && hedef.bottom === 0) return true;

		const pay = 2;
		return kenar === "start"
			? Math.abs(imlec.top - hedef.top) < pay
			: Math.abs(imlec.bottom - hedef.bottom) < pay;
	}

	/**
	 * Model işleminin sonucunu uygular ve imleci yeni yerine koyar.
	 *
	 * Seçim yine `onChange`'den önce kuruluyor (F2-07'de yakalanan sıralama
	 * hatasının aynısı burada da geçerli).
	 */
	#applyEdit(sonuc: EditResult | null): void {
		if (sonuc === null) return;
		const doc = assignIds(sonuc.doc);
		// Yapısal değişiklikler hiç gruplanmıyor: Enter, silme ve girinti
		// kullanıcının kafasında ayrı birer adım.
		this.#record(this.#caret(), doc, null);
		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		this.#sync();
		// `null` imleç: düzenleme arka planda oldu, kullanıcı başka yerde.
		if (sonuc.caret !== null) this.#placeCaretAt(sonuc.caret);
		this.#emit();
	}

	#placeCaretAt(caret: Caret): void {
		const blok = this.#doc.children[caret.blockIndex];
		const element = blok === undefined ? undefined : this.#elements.get(blok.id as string);
		if (element === undefined) return;
		const holder = holderAt(element, caret.path);
		if (holder === null) {
			placeCaret(element, "start");
			return;
		}
		selectRange(holder, caret.offset, caret.offset);
		element.focus({ preventScroll: true });
	}

	#indexOf(blockElement: HTMLElement): number {
		const id = blockElement.getAttribute(ID_ATTR);
		return this.#doc.children.findIndex((child) => child.id === id);
	}

	/** Bir bloğun DOM'daki satır içi içeriğini modele yazar. */
	#syncFromDom(blockElement: HTMLElement): void {
		const blockIndex = this.#indexOf(blockElement);
		if (blockIndex < 0) return;

		let doc = this.#doc;
		let degisti = false;

		for (const holder of holders(blockElement, PATH_ATTR)) {
			const path = parsePath(holder.getAttribute(PATH_ATTR));
			const okunan = readInline(holder);
			const hedef = nodeAt(doc.children[blockIndex], path) as
				| { children?: readonly Inline[] }
				| undefined;
			if (hedef?.children === undefined) continue;
			if (sameInline(hedef.children, okunan)) continue;
			doc = replaceAt(doc, [blockIndex, ...path], {
				...hedef,
				children: okunan,
			} as never);
			degisti = true;
		}

		for (const holder of holders(blockElement, CODE_ATTR)) {
			const path = parsePath(holder.getAttribute(CODE_ATTR));
			const okunan = readCode(holder);
			const hedef = nodeAt(doc.children[blockIndex], path) as { value?: string } | undefined;
			if (hedef?.value === undefined || hedef.value === okunan) continue;
			doc = replaceAt(doc, [blockIndex, ...path], { ...hedef, value: okunan } as never);
			degisti = true;
		}

		if (!degisti) return;

		// Yazma değişiklikleri blok başına gruplanıyor: harf harf geri alma
		// kimsenin istediği şey değil.
		const id = blockElement.getAttribute(ID_ATTR) as string;
		// Tuşa basılmadan önceki imleç: geri alan kullanıcı yazmaya
		// **başladığı** yere dönmeli.
		this.#record(this.#caretBeforeKey, doc, `type:${id}`);
		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		// DOM zaten doğru: yeni düğümü "basılmış" say, yeniden kurma.
		this.#rendered.set(id, doc.children[blockIndex] as TopNode);
		this.#emit();
	}
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/**
 * Kaynak bloğuna eklenen satır sonu.
 *
 * Kaçış dizisi yerine kod noktası: bu dosyanın içinden geçen yama
 * betikleri ters bölüyü bir kez yiyip kaynağı bozdu.
 */
const SATIR_SONU = String.fromCharCode(10);

/** Klavye kısayolu → biçim. */
const KISAYOLLAR: Record<string, MarkType | undefined> = {
	b: "strong",
	i: "emphasis",
	e: "inlineCode",
	x: "delete",
};

/** Bir düğümün içinde bulunduğu satır içi içerik taşıyıcısı. */
function holderOf(node: Node, root: HTMLElement): HTMLElement | null {
	const element = node instanceof Element ? node : node.parentElement;
	const holder = element?.closest(`[${PATH_ATTR}]`);
	return holder instanceof HTMLElement && root.contains(holder) ? holder : null;
}

/** Blok elemanı içinde verilen yola karşılık gelen taşıyıcı. */
function holderAt(blockElement: HTMLElement, path: readonly number[]): HTMLElement | null {
	const aranan = path.join(".");
	if (blockElement.getAttribute(PATH_ATTR) === aranan) return blockElement;
	const bulunan = blockElement.querySelector(`[${PATH_ATTR}="${aranan}"]`);
	return bulunan instanceof HTMLElement ? bulunan : null;
}

/** Blok içindeki içerik taşıyıcıları — bloğun kendisi de olabilir. */
function holders(blockElement: HTMLElement, attr: string): HTMLElement[] {
	const out: HTMLElement[] = [];
	if (blockElement.hasAttribute(attr)) out.push(blockElement);
	for (const el of blockElement.querySelectorAll(`[${attr}]`)) {
		if (el instanceof HTMLElement) out.push(el);
	}
	return out;
}

function parsePath(raw: string | null): number[] {
	if (raw === null || raw === "") return [];
	return raw.split(".").map(Number);
}

function nodeAt(node: unknown, path: readonly number[]): unknown {
	let current = node;
	for (const index of path) {
		const children = (current as { children?: readonly unknown[] } | undefined)?.children;
		if (children === undefined) return undefined;
		current = children[index];
	}
	return current;
}

/**
 * DOM'dan okunan içerik modeldekiyle **anlamca** aynı mı.
 *
 * Üç alan karşılaştırma dışı ve üçünün de sebebi ayrı:
 *
 * - `position` — DOM'da yok; kaynak konumu düzenlemeden sonra zaten
 *   geçersiz.
 * - `id` — satır içi düğümlere kimlik verilmiyor.
 * - `syntax` — **asıl önemli olan.** DOM `_italik_` ile `*italik*` arasındaki
 *   farkı taşımaz. Bu alan karşılaştırmaya girseydi, kullanıcı paragrafın
 *   başka bir yerine harf eklediğinde içerik "değişmiş" sayılır ve
 *   yazım tercihi sessizce kaybolurdu. Dışarıda bırakılınca, içerik aynıysa
 *   **modeldeki düğüm korunuyor** — `syntax` de onunla birlikte.
 *
 * Karşılaştırma JSON üzerinden: içerik bir paragraf kadar küçük ve elle
 * yazılmış derin karşılaştırma, yeni bir düğüm tipi eklendiğinde sessizce
 * eksik kalırdı.
 */
function sameInline(a: readonly Inline[], b: readonly Inline[]): boolean {
	return a.length === b.length && inlineKey(a) === inlineKey(b);
}

const ATLANAN_ALANLAR = new Set(["position", "id", "syntax"]);

function inlineKey(nodes: readonly Inline[]): string {
	return JSON.stringify(nodes, (key, value: unknown) =>
		ATLANAN_ALANLAR.has(key) ? undefined : value,
	);
}
