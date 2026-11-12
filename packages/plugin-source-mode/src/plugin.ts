/**
 * `@kalem-editor/plugin-source-mode` — Ham Markdown kipi  (İş listesi: F4-06)
 *
 * WYSIWYG ile kaynak metin arasında geçiş. Kaynak tarafı sıradan bir
 * `<textarea>`.
 *
 * ## Neden CodeMirror yok
 *
 * İş listesi bunu açıkça istiyor ve gerekçesi boyut: CodeMirror tek
 * başına Kalem'in tamamından büyük. Ham Markdown kipi, kullanıcının
 * **kaçış kapısı** — "editör bunu yanlış yaptı, kaynağı kendim
 * düzelteyim" anı. O an için sözdizimi vurgulaması, kod katlama ve
 * çoklu imleç gerekmiyor; metnin kendisi gerekiyor.
 *
 * `<textarea>` ayrıca bedavaya doğru davranıyor: yerel geri alma, IME,
 * ekran okuyucu, mobil klavye, yazım denetimi. Hepsi tarayıcının.
 *
 * ## İçerik kaybı olmaması
 *
 * Kabul kriteri bu. İki yerden geliyor:
 *
 * 1. **Kaynağa geçerken** belge `serialize` ile metne çevriliyor;
 *    çekirdeğin gidiş-dönüş garantisi (F1-07) bunun kayıpsız olmasını
 *    sağlıyor.
 * 2. **Geri dönerken** metin değişmediyse belgeye **hiç dokunulmuyor**.
 *    Bu, en ince ayrıntının bile korunmasını sağlıyor: `setValue`
 *    çağırmak belgeyi yeniden ayrıştırır, düğüm kimliklerini değiştirir
 *    ve geçmişe anlamsız bir adım yazardı. Kullanıcı kaynağa bakıp
 *    hiçbir şey yapmadan döndüğünde hiçbir şey olmamalı.
 *
 * ## Okunan yer korunuyor
 *
 * Geçişte sayfa başa atlamıyor: ekranın üstündeki blok bulunuyor,
 * kaynakta o bloğun başladığı satır aynı yüksekliğe getiriliyor ve imleç
 * oraya konuyor; geri dönerken kaynağın ekranın üstündeki satırı hangi
 * bloğa düşüyorsa o blok aynı yere getiriliyor. Eşleme blok düzeyinde:
 * her bloğun kaynaktaki başlangıcı, belgenin o bloğa kadarki kısmı
 * serileştirilerek bulunuyor (serileştirici konum üretmiyor). Blok
 * içindeki imleç korunmuyor; yanlış yere konan bir imleç, hiç
 * konmayandan kötü.
 */
import type { Root } from "@kalem-editor/core";
import { parse, serialize } from "@kalem-editor/core";
import type { Plugin, PluginContext } from "@kalem-editor/editor";
import { assignIds, ID_ATTR } from "@kalem-editor/editor";
import type { SourceLabels } from "./labels.js";
import { labelsFor } from "./labels.js";
import type { SourceView } from "./view.js";
import { createSourceView, gorunurUst, kaydiranAta } from "./view.js";

export interface SourceModeOptions {
	/** Arayüz metinleri; verilmezse belgenin `lang`'ine göre seçiliyor. */
	labels?: SourceLabels;
	/** CSS sınıf öneki (varsayılan `"kalem-"`, editörle aynı olmalı). */
	classPrefix?: string;
	/**
	 * Kipi değiştiren kısayol (varsayılan `Ctrl/Cmd+Shift+M`).
	 *
	 * `false` kısayolu kapatıyor: kendi düğmesini koyan uygulama,
	 * kullanıcının başka bir şeye bağladığı tuşu çalmak zorunda değil.
	 */
	shortcut?: boolean;
	/** Kip değiştiğinde — araç çubuğundaki düğmeyi güncellemek için. */
	onModeChange?: (source: boolean) => void;
}

export interface SourceModePlugin extends Plugin {
	/** Ham Markdown kipine geçer. */
	enter(): void;
	/** WYSIWYG'e döner; kaynak değiştiyse belgeye yazar. */
	exit(): void;
	toggle(): void;
	isSource(): boolean;
	/** Kaynak kipindeyken metin kutusundaki metin. */
	text(): string;
}

export function sourceModePlugin(options: SourceModeOptions = {}): SourceModePlugin {
	const p = options.classPrefix ?? "kalem-";

	let ctx: PluginContext | null = null;
	let view: SourceView | null = null;
	/** Kaynağa geçerken üretilen metin; dönüşte karşılaştırma için. */
	let girisMetni: string | null = null;

	function kaynakta(): boolean {
		return girisMetni !== null;
	}

	/** Belgenin üst düzey bloklarının kaynakta başladığı yerler, sırayla. */
	function blokBaslari(doc: Root, metin: string): number[] {
		return doc.children.map((_, i) => {
			if (i === 0) return 0;
			const once = serialize({ ...doc, children: doc.children.slice(0, i) }).trimEnd().length;
			// Aradaki boş satırlar atlanıyor: blok, ilk dolu karakterinden başlıyor.
			let at = Math.min(once, metin.length);
			while (at < metin.length && /\s/.test(metin[at] as string)) at++;
			return at;
		});
	}

	/** Ekranın üstündeki (ya da en üstte kısmen görünen) blok ve görünür alanın tepesine uzaklığı. */
	function ustBlok(): { index: number; delta: number } | null {
		if (ctx === null) return null;
		const ust = gorunurUst(ctx.element);
		const doc = ctx.getDocument();
		for (let i = 0; i < doc.children.length; i++) {
			const eleman = blokElemani(doc, i);
			if (eleman === null) continue;
			const kutu = eleman.getBoundingClientRect();
			if (kutu.bottom > ust + 1) return { index: i, delta: kutu.top - ust };
		}
		return null;
	}

	function blokElemani(doc: Root, i: number): HTMLElement | null {
		const id = doc.children[i]?.id;
		if (ctx === null || id === undefined) return null;
		return ctx.element.querySelector<HTMLElement>(
			`:scope > [${ID_ATTR}="${CSS.escape(String(id))}"]`,
		);
	}

	function gir(): void {
		if (ctx === null || view === null || kaynakta()) return;
		const doc = ctx.getDocument();
		const metin = serialize(doc);
		const yer = ustBlok();
		girisMetni = metin;
		const baslar = yer === null ? [] : blokBaslari(doc, metin);
		const ofset = yer === null ? 0 : (baslar[yer.index] ?? 0);
		view.show(metin, ctx.isReadOnly(), ofset, yer?.delta ?? 0);
		options.onModeChange?.(true);
	}

	function cik(): void {
		if (ctx === null || view === null || !kaynakta()) return;
		const metin = view.text();
		const onceki = girisMetni;
		// Kaynağın ekranın üstündeki yeri: dönüşte o blok aynı yere geliyor.
		const ust = view.topOffset();
		girisMetni = null;
		view.hide();

		// Metin değişmediyse belgeye dokunulmuyor (dosya başındaki not).
		if (metin !== onceki && !ctx.isReadOnly()) {
			const doc = assignIds(parse(metin));
			// `caret: null` = imlece dokunma. Odak henüz editöre dönmedi ve
			// imleci taşımak, dönmeden önce seçimi bozardı.
			ctx.applyEdit({ doc, caret: null });
		}

		options.onModeChange?.(false);
		const blok = ust === null ? null : yerlestir(metin, ust.offset, ust.delta);
		odakla(blok);
	}

	/** Kaynakta `ofset`te başlayan bloğu, görünür alanın tepesinden `delta` uzağa getirir. */
	function yerlestir(metin: string, ofset: number, delta: number): HTMLElement | null {
		if (ctx === null) return null;
		const doc = ctx.getDocument();
		const baslar = blokBaslari(doc, serialize(doc));
		// Kaynak düzenlendiyse ofsetler kayabilir: oransal olarak eşleniyor.
		const toplam = serialize(doc).length;
		const hedef = metin.length === 0 ? 0 : Math.round((ofset / metin.length) * toplam);
		let index = 0;
		for (let i = 0; i < baslar.length; i++) if ((baslar[i] as number) <= hedef) index = i;
		const eleman = blokElemani(doc, index);
		if (eleman === null) return null;
		const kaydiran = kaydiranAta(ctx.element);
		const fark = eleman.getBoundingClientRect().top - gorunurUst(ctx.element) - delta;
		kaydiran.scrollTop += fark;
		return eleman;
	}

	/** Odağı okunan bloğa (yoksa ilk düzenlenebilir bloğa) verir; sayfa kaymadan. */
	function odakla(blok: HTMLElement | null): void {
		const hedef = blok?.isContentEditable === true ? blok : ctx?.element.firstElementChild;
		if (hedef instanceof HTMLElement && hedef.isContentEditable)
			hedef.focus({ preventScroll: true });
	}

	function degistir(): void {
		if (kaynakta()) cik();
		else gir();
	}

	/** Kısayol bu mu — üç işletim sisteminde de aynı tuş. */
	function kisayolMu(event: KeyboardEvent): boolean {
		if (options.shortcut === false) return false;
		if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return false;
		// kalem-locale-ok: tuş adı ASCII; Türkçe klavyede de "m" geliyor
		return event.key.toLowerCase() === "m";
	}

	return {
		name: "source-mode",

		setup(context: PluginContext) {
			ctx = context;
			const belgeDili = context.getLang();
			const labels = options.labels ?? labelsFor(belgeDili);

			view = createSourceView(context.element, {
				prefix: p,
				labels,
				// Kaynak kutusundaki kısayol ve Escape buradan geliyor:
				// odak `<textarea>`da olduğu için editörün tuş haritası
				// çalışmıyor.
				onExit: cik,
				isShortcut: kisayolMu,
			});

			const birak = context.on("readonlychange", (readOnly) => {
				if (kaynakta()) view?.setReadOnly(readOnly);
			});

			return () => {
				birak();
				// Sökülürken kaynakta kalınmıyor: eklentisiz bir editörde
				// gizli kalmış bir `<textarea>` ve görünmeyen bir belge
				// bırakmak, kullanıcının içeriğini kaybettiğini düşündürür.
				if (kaynakta()) cik();
				view?.destroy();
				view = null;
				girisMetni = null;
				ctx = null;
			};
		},

		keymap(event) {
			if (!kisayolMu(event)) return false;
			event.preventDefault();
			degistir();
			return true;
		},

		enter: gir,
		exit: cik,
		toggle: degistir,
		isSource: kaynakta,
		text: () => view?.text() ?? "",
	};
}
