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
import { parse, removeAt, replaceAt, serialize } from "@kalem/core";
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
	splitAtCaret,
	toggleList,
} from "./block-edit.js";
import { assignIds, newId } from "./ids.js";
import { applyLink, applyMark, markActive } from "./inline-edit.js";
import { contentLength, offsetOf, selectRange } from "./offsets.js";
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
	/** Seçim her değiştiğinde çağrılır (bloklar arası seçim dâhil). */
	onSelectionChange?: (selection: EditorSelection) => void;
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
	#readOnly: boolean;
	#destroyed = false;
	#selection: EditorSelection = null;
	/** Sürüklemenin başladığı blok; işaretçi basılı değilse `null`. */
	#dragAnchor: NodeId | null = null;
	/** Sürükleme blok moduna geçti mi (bkz. `#onPointerMove`). */
	#blockDrag = false;

	constructor(element: HTMLElement, options: EditorOptions = {}) {
		this.#element = element;
		this.#options = options;
		this.#prefix = options.classPrefix ?? "kalem-";
		this.#readOnly = options.readOnly ?? false;

		this.#doc = this.#load(options.value ?? "");
		this.#defs = collectDefinitions(this.#doc);

		element.classList.add(`${this.#prefix}editor`, `${this.#prefix}doc`);
		element.setAttribute("role", "textbox");
		element.setAttribute("aria-multiline", "true");
		if (options.lang !== undefined) element.lang = options.lang;

		element.addEventListener("input", this.#onInput);
		element.addEventListener("change", this.#onCheckbox);
		element.addEventListener("keydown", this.#onKeyDown);
		element.addEventListener("pointerdown", this.#onPointerDown);
		element.addEventListener("pointermove", this.#onPointerMove);
		element.ownerDocument.addEventListener("pointerup", this.#onPointerUp);
		// `selectionchange` yalnızca belge üzerinde tetiklenir; elemana
		// bağlanamaz. Sökülürken kaldırılması bu yüzden önemli.
		element.ownerDocument.addEventListener("selectionchange", this.#onSelectionChange);

		this.#sync();
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
		this.#replaceDocument(this.#load(markdown));
	}

	/** Markdown'ı düzenlenebilir bir belgeye çevirir. */
	#load(markdown: string): Root {
		return assignIds(normalizeDocument(parse(markdown)));
	}

	setReadOnly(readOnly: boolean): void {
		this.#readOnly = readOnly;
		this.#applyReadOnly();
	}

	isReadOnly(): boolean {
		return this.#readOnly;
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
		return this.#editRange((children, from, to) => applyLink(children, from, to, url));
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
		this.#element.removeEventListener("change", this.#onCheckbox);
		this.#element.removeEventListener("keydown", this.#onKeyDown);
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
		if (onChange === undefined) return;
		onChange(serialize(this.#doc), this.#doc);
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
		const active = this.#element.ownerDocument.activeElement;
		const blockElement = active?.closest?.(`[${ID_ATTR}]`);
		if (!(blockElement instanceof HTMLElement)) return;
		this.#syncFromDom(blockElement);
	};

	/** Görev listesi kutusu — içerik değil, maddenin durumu değişiyor. */
	#onCheckbox = (event: Event): void => {
		if (this.#readOnly) return;
		const target = event.target;
		if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
		const li = target.closest("li");
		const blockElement = target.closest(`[${ID_ATTR}]`);
		if (li === null || !(blockElement instanceof HTMLElement)) return;

		const blockIndex = this.#indexOf(blockElement);
		const block = this.#doc.children[blockIndex];
		if (block === undefined || block.type !== "list") return;

		const index = Array.from(blockElement.querySelectorAll("li")).indexOf(li);
		const item = block.children[index];
		if (item === undefined) return;

		this.#replaceDocument(
			replaceAt(this.#doc, [blockIndex, index], { ...item, checked: target.checked }),
		);
	};

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

	#applySelection(okunan: EditorSelection): void {
		if (sameSelection(okunan, this.#selection)) return;
		this.#selection = okunan;
		this.#paintSelection(okunan);
		this.#options.onSelectionChange?.(okunan);
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

		if (this.#selection?.kind === "block") {
			if (event.key !== "Backspace" && event.key !== "Delete") return;
			event.preventDefault();
			this.#deleteSelectedBlocks();
			return;
		}

		if (event.ctrlKey || event.metaKey) {
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
		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		this.#sync();
		this.#placeCaretAt(sonuc.caret);
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

		this.#doc = doc;
		this.#defs = collectDefinitions(doc);
		// DOM zaten doğru: yeni düğümü "basılmış" say, yeniden kurma.
		const id = blockElement.getAttribute(ID_ATTR) as string;
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
