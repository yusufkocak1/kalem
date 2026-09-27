/**
 * `@kalem-editor/plugin-word-count` — Kelime sayacı  (İş listesi: F4-05)
 *
 * Kelime, karakter ve okuma süresi; isteğe bağlı bir durum çubuğu.
 *
 * ## Neden gecikmeli sayıyor
 *
 * Sayma belge uzunluğunda doğrusal ve `Intl.Segmenter` ucuz değil: 100
 * sayfalık bir belgeyi her tuş vuruşunda saymak, yazmayı hissedilir
 * şekilde ağırlaştırıyor. Sayaç yazmanın **sonucu**, kendisi değil —
 * 200 ms sonra güncellenmesi kimseyi rahatsız etmiyor, her karakterde
 * takılan bir editör ediyor.
 *
 * Bekleme süresi sıfırlanabilir (`delay: 0`): testler ve küçük belgeler
 * için.
 *
 * ## Durum çubuğu neden zorunlu değil
 *
 * `container` verilmezse eklenti hiçbir şey çizmiyor, yalnızca sayıyor.
 * Kendi durum çubuğu olan bir uygulama `onChange` ile sayıları alıp
 * kendi yerleşimine koyuyor; kütüphane ekranın altını sahiplenmiyor
 * (F4-04'teki aynı karar).
 */
import type { Plugin, PluginContext } from "@kalem-editor/editor";
import type { CountOptions, Counts } from "./count.js";
import { countText } from "./count.js";
import type { WordCountLabels } from "./labels.js";
import { labelsFor } from "./labels.js";
import type { StatusBar } from "./status.js";
import { createStatusBar } from "./status.js";
import type { TextOptions } from "./text.js";
import { textOf } from "./text.js";

export interface WordCountOptions extends CountOptions, TextOptions {
	/** Durum çubuğunun çizileceği eleman; verilmezse arayüz çizilmiyor. */
	container?: HTMLElement | null;
	/** Arayüz metinleri; verilmezse belgenin `lang`'ine göre seçiliyor. */
	labels?: WordCountLabels;
	/** CSS sınıf öneki (varsayılan `"kalem-"`, editörle aynı olmalı). */
	classPrefix?: string;
	/** Yazma durduktan kaç ms sonra sayılacağı (varsayılan 200). */
	delay?: number;
	/** Sayılar değiştiğinde — kendi arayüzünü çizen uygulama için. */
	onChange?: (counts: Counts) => void;
}

export interface WordCountPlugin extends Plugin {
	/** Son sayılan değerler. */
	counts(): Counts;
	/** Beklemeden yeniden sayar. */
	refresh(): void;
}

const BOS: Counts = { words: 0, characters: 0, charactersNoSpaces: 0, minutes: 0 };

export function wordCountPlugin(options: WordCountOptions = {}): WordCountPlugin {
	const p = options.classPrefix ?? "kalem-";
	const gecikme = options.delay ?? 200;

	let ctx: PluginContext | null = null;
	let bar: StatusBar | null = null;
	let counts: Counts = BOS;
	let locale = "en";
	let zamanlayici: ReturnType<typeof setTimeout> | null = null;

	function say(): void {
		if (ctx === null) return;
		const metin = textOf(ctx.getDocument(), options);
		const yeni = countText(metin, {
			locale,
			...(options.wordsPerMinute === undefined ? {} : { wordsPerMinute: options.wordsPerMinute }),
		});
		if (
			yeni.words === counts.words &&
			yeni.characters === counts.characters &&
			yeni.minutes === counts.minutes
		) {
			return;
		}
		counts = yeni;
		bar?.render(counts);
		options.onChange?.(counts);
	}

	function planla(): void {
		if (gecikme <= 0) {
			say();
			return;
		}
		if (zamanlayici !== null) clearTimeout(zamanlayici);
		zamanlayici = setTimeout(() => {
			zamanlayici = null;
			say();
		}, gecikme);
	}

	return {
		name: "word-count",

		setup(context: PluginContext) {
			ctx = context;
			const belgeDili = context.getLang();
			locale = options.locale ?? belgeDili;
			const labels = options.labels ?? labelsFor(belgeDili);

			if (options.container != null) {
				bar = createStatusBar(options.container, { prefix: p, labels });
			}

			const birak = context.on("change", planla);
			// İlk sayım beklemeden: kullanıcı henüz yazmadı, gecikme bir şey
			// kazandırmıyor ve boş bir durum çubuğu göstermek kötü.
			say();
			bar?.render(counts);

			return () => {
				birak();
				if (zamanlayici !== null) clearTimeout(zamanlayici);
				zamanlayici = null;
				bar?.destroy();
				bar = null;
				counts = BOS;
				ctx = null;
			};
		},

		counts: () => counts,
		refresh: say,
	};
}
