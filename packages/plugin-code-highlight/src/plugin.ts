/**
 * `@kalem-editor/plugin-code-highlight` — Eklenti  (İş listesi: F4-02)
 *
 * Editördeki kod bloklarını boyuyor. Modele **hiç dokunmuyor**: vurgulama
 * bir okuma kolaylığı, belgenin parçası değil. Markdown'a serileştirilen
 * şey `readCode()`un `<code>` elemanından okuduğu düz metin ve o okuma
 * eklenen `<span>`leri görmüyor (`offsets.ts` kuralı: eleman şeffaf).
 *
 * ## Neden `change` olayına abone
 *
 * Eklenti API'sinde render kancası bilerek yok (`@kalem-editor/editor/plugin.ts`).
 * Süsleme, çizimden **sonra** uygulanıyor ve belge her değiştiğinde
 * yeniden — F4-01'de görsel ilerleme süslemesi için kurulan aynı düzen.
 *
 * Kod bloğunun içinde yazmak bloğu yeniden çizdirmiyor (editör satır içi
 * içeriği DOM'dan okuyor), yani `<span>`ler tuş vuruşları arasında
 * duruyor. Yeniden çizim olduğunda ise `<code>` elemanı **yeni** bir nesne
 * oluyor ve boyama imzası `WeakMap`te bulunmadığı için blok kendiliğinden
 * yeniden boyanıyor.
 *
 * ## Kare başına bir boyama
 *
 * Her `change` olayında hemen boyamak, hızlı yazan birinde tuş başına bir
 * DOM yeniden kurulumu demek. İşi bir sonraki çizim karesine erteliyoruz;
 * araya giren değişiklikler tek boyamada birleşiyor. Gecikme bir kare
 * olduğu için göz fark etmiyor.
 *
 * ## IME
 *
 * Bileşim sürerken (Çince/Japonca/Korece giriş, ölü tuşlar) DOM'a
 * dokunmak, tarayıcının bileşim aralığını bozuyor ve yazılanı siliyor.
 * Editörün kendisi de aynı sebeple bileşim boyunca DOM'dan uzak duruyor
 * (`editor.ts` başındaki not). Boyama `compositionend`e kadar bekliyor.
 */
import type { Plugin, PluginContext } from "@kalem-editor/editor";
import type { Highlighter, HighlighterOptions } from "./highlighter.js";
import { createHighlighter } from "./highlighter.js";

export interface CodeHighlightOptions extends HighlighterOptions {}

export interface CodeHighlightPlugin extends Plugin {
	/**
	 * Boyamayı elle tetikler.
	 *
	 * Editörün dışından gelen bir değişiklikten sonra gerekiyor: kod
	 * bloğunu doğrudan DOM'da değiştiren bir başka eklenti gibi. Normal
	 * yazma akışında çağırmaya gerek yok.
	 */
	refresh(): void;
	/** Süren gramer yüklemeleri bitene kadar bekler — testler için. */
	whenIdle(): Promise<void>;
}

export function codeHighlightPlugin(options: CodeHighlightOptions = {}): CodeHighlightPlugin {
	let vurgulayici: Highlighter | null = null;
	let kok: HTMLElement | null = null;
	/** Bileşim sürerken boyama ertelenmiş mi. */
	let bekleyen = false;
	let composing = false;
	let iptal: (() => void) | null = null;

	function boya(): void {
		if (vurgulayici === null || kok === null) return;
		vurgulayici.refresh(kok);
	}

	/** Bir sonraki karede boyar; aradaki çağrılar birleşiyor. */
	function planla(): void {
		if (kok === null || iptal !== null) return;
		if (composing) {
			bekleyen = true;
			return;
		}
		const gorunum = kok.ownerDocument.defaultView;
		if (gorunum === null) {
			// Belge bir pencereye bağlı değil (jsdom'un ayrık belgesi gibi):
			// çizim karesi hiç gelmeyeceği için hemen boyuyoruz.
			boya();
			return;
		}
		const id = gorunum.requestAnimationFrame(() => {
			iptal = null;
			boya();
		});
		iptal = () => {
			gorunum.cancelAnimationFrame(id);
		};
	}

	const onCompositionStart = (): void => {
		composing = true;
	};

	const onCompositionEnd = (): void => {
		composing = false;
		if (!bekleyen) return;
		bekleyen = false;
		planla();
	};

	return {
		name: "code-highlight",

		setup(ctx: PluginContext) {
			vurgulayici = createHighlighter(options);
			kok = ctx.element;
			kok.addEventListener("compositionstart", onCompositionStart);
			kok.addEventListener("compositionend", onCompositionEnd);
			// İlk boyama beklemeden: editör kurulduğunda belge zaten çizilmiş
			// oluyor ve bir sonraki `change` olayı kullanıcı yazana kadar
			// gelmiyor — yani boyanmamış kod bloğu ekranda kalırdı.
			boya();
			const birak = ctx.on("change", planla);

			return () => {
				birak();
				iptal?.();
				iptal = null;
				kok?.removeEventListener("compositionstart", onCompositionStart);
				kok?.removeEventListener("compositionend", onCompositionEnd);
				// Eklenti söküldüğünde blok, editörün bıraktığı düz metne
				// dönüyor: yarısı boyalı bir DOM bırakmak, sonraki okuma
				// için sessiz bir tuzak olurdu.
				if (kok !== null) vurgulayici?.clear(kok);
				vurgulayici = null;
				kok = null;
				composing = false;
				bekleyen = false;
			};
		},

		refresh: boya,

		async whenIdle() {
			await vurgulayici?.whenIdle();
		},
	};
}
