/**
 * @kalem/plugin-autosave — Durum göstergesi  (İş listesi: F4-07)
 *
 * "Kaydediliyor / kaydedildi" yazan küçük bir etiket.
 *
 * ## Neden `role="status"` var (sayaçta yoktu)
 *
 * Kelime sayacı (F4-05) canlı bölge **değil**: her tuş vuruşunda değişen
 * bir sayıyı duyurmak yazmayı imkânsız kılıyor. Kaydetme durumu ise
 * seyrek değişiyor ve kullanıcının gerçekten bilmesi gereken bir şey —
 * "kaydedildi mi?" sorusunun cevabı ekranda bir yerde küçük gri bir
 * yazıysa, göremeyen kullanıcı onu hiç öğrenemiyor.
 */
import type { AutosaveLabels } from "./labels.js";
import type { SaveState } from "./plugin.js";

export interface SaveIndicator {
	render(state: SaveState): void;
	destroy(): void;
}

export function createIndicator(
	container: HTMLElement,
	options: { prefix: string; labels: AutosaveLabels },
): SaveIndicator {
	const doc = container.ownerDocument;
	const el = doc.createElement("span");
	el.className = `${options.prefix}autosave ${options.prefix}theme`;
	el.setAttribute("role", "status");
	container.append(el);

	return {
		render(state) {
			el.dataset.state = state;
			el.textContent = options.labels[state];
		},
		destroy() {
			el.remove();
		},
	};
}
