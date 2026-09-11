/**
 * @kalem/plugin-word-count — Durum çubuğu  (İş listesi: F4-05)
 *
 * Üç sayıyı gösteren küçük bir şerit.
 *
 * ## Neden `aria-live` yok
 *
 * Sayaç her tuş vuruşunda değişiyor; canlı bölge yapmak, ekran okuyucu
 * kullanan birine yazdığı her kelimeden sonra "247 kelime" dedirtmek
 * demek — yazmayı imkânsız kılacak bir gürültü. Bunun yerine şerit
 * adlandırılmış bir bölge (`role="status"` **değil**, sıradan bir grup):
 * kullanıcı istediğinde imleci oraya götürüp okuyor.
 */
import type { Counts } from "./count.js";
import type { WordCountLabels } from "./labels.js";

export interface StatusBarOptions {
	readonly prefix: string;
	readonly labels: WordCountLabels;
}

export interface StatusBar {
	render(counts: Counts): void;
	destroy(): void;
}

export function createStatusBar(container: HTMLElement, options: StatusBarOptions): StatusBar {
	const doc = container.ownerDocument;
	const p = options.prefix;

	const kok = doc.createElement("div");
	kok.className = `${p}wordcount ${p}theme`;
	kok.setAttribute("role", "group");
	kok.setAttribute("aria-label", options.labels.title);

	const kelime = parca(doc, p);
	const karakter = parca(doc, p);
	const sure = parca(doc, p);
	kok.append(kelime, karakter, sure);
	container.append(kok);

	return {
		render(counts) {
			kelime.textContent = options.labels.words(counts.words);
			karakter.textContent = options.labels.characters(counts.characters);
			// Boş belgede okuma süresi anlamsız; yer de kaplamıyor.
			sure.textContent = counts.minutes === 0 ? "" : options.labels.minutes(counts.minutes);
			sure.hidden = counts.minutes === 0;
		},

		destroy() {
			kok.remove();
		},
	};
}

function parca(doc: Document, prefix: string): HTMLSpanElement {
	const span = doc.createElement("span");
	span.className = `${prefix}wordcount-item`;
	return span;
}
