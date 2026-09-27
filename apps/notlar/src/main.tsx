import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

import "@kalem-editor/themes/tokens.css";
import "@kalem-editor/themes/viewer.css";
import "@kalem-editor/themes/editor.css";
import "@kalem-editor/themes/ui.css";
import "@kalem-editor/themes/plugin-code.css";
import "@kalem-editor/themes/plugin-find.css";
import "@kalem-editor/themes/plugin-outline.css";
import "@kalem-editor/themes/plugin-word-count.css";
import "@kalem-editor/themes/plugin-source.css";
import "@kalem-editor/themes/plugin-autosave.css";
import "./stil.css";

/*
 * `dark.css` **yüklenmiyor** ve bu bir eksiklik değil.
 *
 * O dosya "sayfanın tamamı koyu, kullanıcıya seçim sunulmuyor" senaryosu
 * için: koşulsuz yüklendiğinde editör, `[data-theme="light"]` yazsanız
 * bile koyu kalıyor. (Bu uygulamayı yazarken tam olarak o oldu — kabuk
 * açık, editör koyuydu.) `tokens.css` zaten üç durumu da karşılıyor:
 * sistem tercihi, açık seçim ve varsayılan. Tema düğmesi `<html>`
 * üzerindeki `data-theme`i değiştiriyor, gerisi kendiliğinden geliyor.
 */

/*
 * `StrictMode` açık ve bilerek.
 *
 * React 19'un geliştirme kipi her etkiyi kurup söküp yeniden kuruyor.
 * Bir editör için bu, en zor yaşam döngüsü sınavı: iki kez kurulan bir
 * editör ekranda iki belge bırakır. Dogfooding uygulamasının bunu
 * kapatması, ölçmek istediği şeyden kaçınması olurdu.
 */
const kok = document.getElementById("kok");
if (kok !== null) {
	createRoot(kok).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
