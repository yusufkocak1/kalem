/**
 * @kalem-editor/editor — Yerleşik eklentiler  (İş listesi: F2-12)
 *
 * ## Neden bunlar eklenti
 *
 * F2-12'nin dogfooding kuralı: eklenti API'si, çekirdek bir özelliği
 * taşıyacak kadar geniş olduğunu **kendi üstünde** kanıtlamalı. Burada
 * iki gerçek özellik eklentiye çıkarıldı ve varsayılan olarak kayıtlı:
 *
 * - **Giriş kuralları** (`# ` → başlık, `**a**` → kalın)
 * - **Görev listesi** (kutuya tıklayınca maddenin durumu değişiyor)
 *
 * İkisi de `new Editor(el, { plugins: [] })` ile kapatılabiliyor; kapanınca
 * davranış gerçekten kayboluyor ve tekrar eklenince geri geliyor. Bu, API
 * yeterliliğinin ölçülebilir kanıtı.
 *
 * ## Görev listesi render'ı neden hâlâ çekirdekte
 *
 * Kutunun **çizimi** `render.ts`'te kaldı, yalnızca **davranışı** buraya
 * taşındı. Düğüm başına render kancası, blok motorunun en sıcak yolunda
 * her düğüm için bir dolaylı çağrı demek; ihtiyaç ölçülmeden ödenecek bir
 * bedel değil (bkz. `plugin.ts`).
 */
import { replaceAt } from "@kalem-editor/core";
import { applyBlockRule, applyInlineRule } from "./input-rules.js";
import type { Plugin } from "./plugin.js";
import { ID_ATTR } from "./render.js";

/** `# ` → başlık, `- ` → liste, `**a**` → kalın … (F2-10). */
export function inputRulesPlugin(): Plugin {
	return {
		name: "input-rules",
		inputRules: [applyBlockRule, applyInlineRule],
	};
}

/**
 * Görev listesi kutusunun davranışı.
 *
 * Kutu `contenteditable="false"`, yani tıklanabilir ama imleç içine
 * girmiyor; durum değişikliği `change` olayından geliyor ve içerik
 * düzenlemesinden bağımsız bir model güncellemesi.
 */
export function taskListPlugin(): Plugin {
	return {
		name: "task-list",
		setup(ctx) {
			const isle = (event: Event): void => {
				if (ctx.isReadOnly()) return;
				const target = event.target;
				if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;

				const li = target.closest("li");
				const blockElement = target.closest(`[${ID_ATTR}]`);
				if (li === null || !(blockElement instanceof HTMLElement)) return;

				const doc = ctx.getDocument();
				const id = blockElement.getAttribute(ID_ATTR);
				const blockIndex = doc.children.findIndex((child) => child.id === id);
				const blok = doc.children[blockIndex];
				if (blok === undefined || blok.type !== "list") return;

				const index = Array.from(blockElement.querySelectorAll("li")).indexOf(li);
				const item = blok.children[index];
				if (item === undefined) return;

				ctx.applyEdit({
					doc: replaceAt(doc, [blockIndex, index], { ...item, checked: target.checked }),
					caret: { blockIndex, path: [index, 0], offset: 0 },
				});
			};

			ctx.element.addEventListener("change", isle);
			return () => ctx.element.removeEventListener("change", isle);
		},
	};
}

/** Varsayılan olarak kayıtlı eklentiler. */
export function defaultPlugins(): Plugin[] {
	return [inputRulesPlugin(), taskListPlugin()];
}
