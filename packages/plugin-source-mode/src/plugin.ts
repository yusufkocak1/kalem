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
 * ## İmleç korunmuyor
 *
 * Kaynağa geçerken imleç metnin başında, geri dönerken belgenin
 * başında. Korumak için model konumunu kaynak ofsetine çeviren bir
 * eşleme gerekiyor; serileştirici bunu üretmiyor (konum bilgisi
 * **ayrıştırmadan** geliyor, üretimden değil). Yanlış yere konan bir
 * imleç, hiç konmayandan kötü.
 */
import { parse, serialize } from "@kalem-editor/core";
import type { Plugin, PluginContext } from "@kalem-editor/editor";
import { assignIds } from "@kalem-editor/editor";
import type { SourceLabels } from "./labels.js";
import { labelsFor } from "./labels.js";
import type { SourceView } from "./view.js";
import { createSourceView } from "./view.js";

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

	function gir(): void {
		if (ctx === null || view === null || kaynakta()) return;
		const metin = serialize(ctx.getDocument());
		girisMetni = metin;
		view.show(metin, ctx.isReadOnly());
		options.onModeChange?.(true);
	}

	function cik(): void {
		if (ctx === null || view === null || !kaynakta()) return;
		const metin = view.text();
		const onceki = girisMetni;
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
		odakla();
	}

	/** Odağı editörün ilk düzenlenebilir bloğuna verir. */
	function odakla(): void {
		const ilk = ctx?.element.firstElementChild;
		if (ilk instanceof HTMLElement && ilk.isContentEditable) ilk.focus();
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
