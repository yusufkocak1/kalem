/**
 * Tema seçici  (İş listesi: F6-06)
 *
 * Üç seçenek, iki farklı mekanizma — ve ayrım kütüphanenin kendi
 * kararından geliyor:
 *
 * - **Açık / Koyu** → `<html data-theme>`. `tokens.css` üç durumu da
 *   karşılıyor (sistem tercihi, açık seçim, varsayılan), yani fazladan
 *   dosya gerekmiyor.
 * - **Yalın** → `minimal.css`. Gölgeyi ve yuvarlatmayı kaldırıp vurgu
 *   rengini metnin kendisine çekiyor; kütüphanenin "kendi görünüşünü"
 *   geri aldığı yer. Ayrı bir katman olduğu için ayrı yükleniyor.
 *
 * `?inline` ile CSS metin olarak alınıyor: sayfa açılışında yüklenip
 * beklemiyor, seçildiğinde enjekte ediliyor.
 */
import yalinCss from "@kalem/themes/minimal.css?inline";

const KIMLIK = "kalem-yalin-tema";

export function temaUygula(tema: string): void {
	const kok = document.documentElement;
	kok.dataset["theme"] = tema === "koyu" ? "dark" : "light";

	const var_ = document.getElementById(KIMLIK);
	if (tema !== "yalin") {
		var_?.remove();
		return;
	}
	if (var_ !== null) return;

	const stil = document.createElement("style");
	stil.id = KIMLIK;
	stil.textContent = yalinCss;
	document.head.append(stil);
}
