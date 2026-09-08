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
import type { Definition, Inline, Root } from "@kalem/core";
import { parse, replaceAt, serialize } from "@kalem/core";
import { assignIds } from "./ids.js";
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

	constructor(element: HTMLElement, options: EditorOptions = {}) {
		this.#element = element;
		this.#options = options;
		this.#prefix = options.classPrefix ?? "kalem-";
		this.#readOnly = options.readOnly ?? false;

		this.#doc = assignIds(parse(options.value ?? ""));
		this.#defs = collectDefinitions(this.#doc);

		element.classList.add(`${this.#prefix}editor`, `${this.#prefix}doc`);
		element.setAttribute("role", "textbox");
		element.setAttribute("aria-multiline", "true");
		if (options.lang !== undefined) element.lang = options.lang;

		element.addEventListener("input", this.#onInput);
		element.addEventListener("change", this.#onCheckbox);

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
		this.#replaceDocument(assignIds(parse(markdown)));
	}

	setReadOnly(readOnly: boolean): void {
		this.#readOnly = readOnly;
		this.#applyReadOnly();
	}

	isReadOnly(): boolean {
		return this.#readOnly;
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
