/**
 * `@kalem-editor/plugin-find-replace` — Eklenti  (İş listesi: F4-03)
 *
 * Ctrl+F / Ctrl+H'yi paneli açmaya, paneli de arama motoruna bağlıyor.
 *
 * ## Dizin ne zaman yenileniyor
 *
 * Pahalı olan tarama değil **katlama** (`search.ts`): belgeyi bir kez
 * katlayıp her tuşta yeniden taramak, 100 sayfalık belgede farkı
 * milisaniyelerden saniyelere çeviriyor. Dizin bu yüzden belge
 * değiştiğinde (`change`) geçersizleniyor, sorgu değiştiğinde değil.
 *
 * ## Tarayıcının kendi araması neden kapatılıyor
 *
 * Ctrl+F varsayılan olarak tarayıcının arama çubuğunu açıyor ve o çubuk
 * Markdown'ı değil **ekrandaki metni** buluyor: bulduğunu değiştiremiyor,
 * kod bloğunun içini modelden ayıramıyor ve Türkçe kasayı bilmiyor. Panel
 * açıkken olay tüketiliyor; eklenti kurulu değilse tarayıcınınki aynen
 * çalışmaya devam ediyor.
 *
 * ## Salt okunur belge
 *
 * Arama çalışıyor, değiştirme düğmeleri kapalı. Aramanın okuma eylemi
 * olması, salt okunur belgede de en çok işe yarayan şey.
 */
import type { Plugin, PluginContext } from "@kalem-editor/editor";
import { blockElementOf, holderIn, selectRange } from "@kalem-editor/editor";
import { createDecorator } from "./decorate.js";
import type { FindLabels } from "./labels.js";
import { labelsFor } from "./labels.js";
import { createPanel } from "./panel.js";
import { replaceAll, replaceOne } from "./replace.js";
import type { Match, SearchIndex } from "./search.js";
import { createIndex, findMatches, nextFrom } from "./search.js";

export interface FindReplaceOptions {
	/** Arayüz metinleri; verilmezse belgenin `lang`'ine göre seçiliyor. */
	labels?: FindLabels;
	/** Kasa katlaması için dil; verilmezse belgenin `lang`'i. */
	locale?: string;
	/** CSS sınıf öneki (varsayılan `"kalem-"`, editörle aynı olmalı). */
	classPrefix?: string;
	/** Eşleşme üst sınırı (varsayılan 5000, bkz. `search.ts`). */
	limit?: number;
}

export interface FindReplacePlugin extends Plugin {
	/** Paneli açar — kendi araç çubuğuna düğme koyan uygulamalar için. */
	open(mode?: "find" | "replace"): void;
	close(): void;
	/** Geçerli eşleşmeler — testler ve gömen uygulama için. */
	matches(): readonly Match[];
	/** Geçerli eşleşmenin indisi; yoksa -1. */
	currentIndex(): number;
}

export function findReplacePlugin(options: FindReplaceOptions = {}): FindReplacePlugin {
	const p = options.classPrefix ?? "kalem-";
	const limit = options.limit ?? 5000;

	let ctx: PluginContext | null = null;
	let panel: ReturnType<typeof createPanel> | null = null;
	let decorator: ReturnType<typeof createDecorator> | null = null;
	let index: SearchIndex | null = null;
	let matches: readonly Match[] = [];
	let current = -1;
	let locale = "en";

	/** Belge değişti: dizin bayat. */
	function gecersizle(): void {
		index = null;
	}

	function dizin(): SearchIndex | null {
		if (ctx === null) return null;
		if (index === null) index = createIndex(ctx.getDocument(), locale);
		return index;
	}

	/**
	 * Sorguyu yeniden çalıştırır.
	 *
	 * `koru` geçerli eşleşmeyi olabildiğince yerinde tutuyor: kullanıcı
	 * "kedi" yazarken her harfte listeye baştan atlamak, aradığı yeri
	 * kaybettiriyor.
	 */
	function tazele(koru = true): void {
		const idx = dizin();
		if (idx === null || panel === null) return;

		const oncekiKonum = current >= 0 ? matches[current] : undefined;
		matches = findMatches(idx, panel.query(), {
			caseSensitive: panel.caseSensitive(),
			wholeWord: panel.wholeWord(),
			limit,
		});

		if (matches.length === 0) current = -1;
		else if (koru && oncekiKonum !== undefined) {
			current = nextFrom(matches, oncekiKonum.regionIndex, oncekiKonum.from);
		} else {
			current = imlectenSonraki();
		}

		ciz();
	}

	/** İmlecin bulunduğu yerden sonraki ilk eşleşme. */
	function imlectenSonraki(): number {
		const idx = dizin();
		const caret = ctx?.getCaret() ?? null;
		if (idx === null || caret === null) return matches.length === 0 ? -1 : 0;
		const bolgeIndex = idx.regions.findIndex(
			(r) =>
				r.blockIndex === caret.blockIndex &&
				r.path.length === caret.path.length &&
				r.path.every((n, i) => n === caret.path[i]),
		);
		return bolgeIndex < 0 ? nextFrom(matches, 0, 0) : nextFrom(matches, bolgeIndex, caret.offset);
	}

	function ciz(): void {
		if (panel === null || decorator === null) return;
		panel.setStatus(Math.max(current, 0), matches.length, matches.length >= limit);
		decorator.paint(matches, current);
		const hedef = current >= 0 ? matches[current] : undefined;
		if (hedef !== undefined) decorator.reveal(hedef);
	}

	function git(yon: 1 | -1): void {
		if (matches.length === 0) return;
		current = (current + yon + matches.length) % matches.length;
		ciz();
	}

	function degistir(hepsi: boolean): void {
		if (ctx === null || panel === null || ctx.isReadOnly()) return;
		const idx = dizin();
		if (idx === null || matches.length === 0) return;
		const value = panel.replacement();

		const sonuc = hepsi
			? replaceAll(ctx.getDocument(), idx.regions, matches, value)
			: replaceOne(ctx.getDocument(), idx.regions, matches[current] as Match, value);
		if (sonuc === null) return;

		// `applyEdit` `change` yayıyor, o da dizini geçersizliyor; tazeleme
		// bundan sonra yapılmak zorunda.
		ctx.applyEdit(sonuc);
		// Değiştirilen eşleşme artık yok; sıradakine geçiliyor ki
		// "değiştir"e art arda basmak belgede ilerlesin.
		tazele(true);
	}

	function ac(mode: "find" | "replace"): void {
		if (ctx === null || panel === null) return;
		panel.setReadOnly(ctx.isReadOnly());
		panel.open(mode, secilenMetin());
		tazele(false);
	}

	/** Seçili metin arama kutusuna ön-dolduruluyor (Word ve tarayıcı gibi). */
	function secilenMetin(): string {
		const secim = ctx?.element.ownerDocument.getSelection();
		if (secim === null || secim === undefined || secim.isCollapsed) return "";
		const metin = secim.toString();
		// Çok satırlı bir seçim arama kutusuna sığmıyor ve büyük ihtimalle
		// aranmak istenen şey değil.
		return metin.includes("\n") || metin.length > 100 ? "" : metin;
	}

	function kapat(): void {
		panel?.close();
		decorator?.clear();
		matches = [];
		current = -1;
		odakla();
	}

	/**
	 * Odağı editöre, kullanıcının bıraktığı yere geri veriyor.
	 *
	 * Kökün kendisi odaklanabilir değil — her blok kendi
	 * `contenteditable` elemanı (F2-05). Panel açılırken imleç modelde
	 * duruyor; kapanışta o konum DOM'a geri yazılıyor, yoksa kullanıcı
	 * Escape'e basınca belgenin başına düşerdi.
	 */
	function odakla(): void {
		if (ctx === null) return;
		const caret = ctx.getCaret();
		const id = caret === null ? null : (ctx.getDocument().children[caret.blockIndex]?.id ?? null);
		const blok = id === null ? null : blockElementOf(ctx.element, id);
		const holder = blok === null || caret === null ? null : holderIn(blok, caret.path);

		if (blok !== null && holder !== null && caret !== null) {
			blok.focus();
			selectRange(holder, caret.offset, caret.offset);
			return;
		}

		const ilk = ctx.element.firstElementChild;
		if (ilk instanceof HTMLElement && ilk.isContentEditable) ilk.focus();
	}

	return {
		name: "find-replace",

		setup(context: PluginContext) {
			ctx = context;
			const belgeDili = context.getLang();
			locale = options.locale ?? belgeDili;
			const labels = options.labels ?? labelsFor(belgeDili);

			decorator = createDecorator(context.element, (i) => {
				const blok = context.getDocument().children[i];
				return blok?.id ?? null;
			});

			panel = createPanel(context.element, {
				prefix: p,
				labels,
				onQueryChange: () => tazele(false),
				onOptionsChange: () => tazele(false),
				onNext: () => git(1),
				onPrevious: () => git(-1),
				onReplace: () => degistir(false),
				onReplaceAll: () => degistir(true),
				onClose: kapat,
			});

			const abonelikler = [
				context.on("change", () => {
					gecersizle();
					if (panel?.isOpen() === true) tazele(true);
				}),
				context.on("readonlychange", (readOnly) => panel?.setReadOnly(readOnly)),
			];

			return () => {
				for (const birak of abonelikler) birak();
				decorator?.clear();
				panel?.destroy();
				panel = null;
				decorator = null;
				index = null;
				matches = [];
				current = -1;
				ctx = null;
			};
		},

		keymap(event) {
			// `metaKey` macOS için: Cmd+F orada aynı işi yapıyor.
			const mod = event.ctrlKey || event.metaKey;
			if (!mod || event.altKey) return false;
			// kalem-locale-ok: tuş adı ASCII; Türkçe klavyede de "f" geliyor
			const tus = event.key.toLowerCase();
			if (tus === "f") {
				event.preventDefault();
				ac("find");
				return true;
			}
			if (tus === "h") {
				event.preventDefault();
				ac("replace");
				return true;
			}
			return false;
		},

		open: (mode = "find") => ac(mode),
		close: kapat,
		matches: () => matches,
		currentIndex: () => current,
	};
}
