/**
 * Kalem Notlar — Not başlığı  (İş listesi: F5-05)
 *
 * Not listesinde görünen ad, belgenin **kendisinden** okunuyor: ayrı bir
 * "başlık" alanı yok. Sebebi Markdown: bir belgenin adı zaten ilk
 * satırında yazıyor ve ikinci bir alan istemek, kullanıcıdan aynı şeyi
 * iki kez yazmasını istemek olurdu.
 *
 * Ayrıştırıcıya gitmiyor. `@kalem-editor/core.parse` doğru cevabı verirdi ama
 * liste her tuşta yeniden çiziliyor ve tüm notların tam ayrıştırması
 * gereksiz; burada ilk anlamlı satıra bakmak yetiyor.
 */

/** Başlık satırından işaretleri söker: `## Başlık` → `Başlık`. */
function isaretleriSok(satir: string): string {
	return (
		satir
			.replace(/^\s{0,3}#{1,6}\s+/, "")
			.replace(/\s+#+\s*$/, "")
			// Satır içi vurgu işaretleri: ad olarak görünmemeleri gerekiyor.
			.replace(/[*_`~]/g, "")
			.replace(/^\s{0,3}[-*+]\s+/, "")
			.replace(/^\s{0,3}>\s?/, "")
			.trim()
	);
}

/**
 * Notun listede görünecek adı.
 *
 * Öncelik ilk başlıkta; yoksa ilk anlamlı satır. Hiçbiri yoksa `bos`
 * dönüyor — çağıran yerelleştirilmiş metni kendisi veriyor.
 */
export function baslikCikar(markdown: string, bos = "Adsız not"): string {
	for (const satir of markdown.split("\n")) {
		if (satir.trim() === "") continue;
		// Çitli kod bloğunun açılışı ad olamaz; içindeki `# yorum` satırı da
		// başlık değil, ama tek satıra bakarak ayırt edilemiyor — açılışı
		// görünce durmak yanlış ad üretmekten iyi.
		if (/^\s{0,3}(```|~~~)/.test(satir)) break;
		const ad = isaretleriSok(satir);
		if (ad !== "") return ad;
	}
	return bos;
}

/** Listede ikinci satır olarak görünen özet. */
export function ozetCikar(markdown: string, uzunluk = 90): string {
	const satirlar = markdown.split("\n");
	let baslikGecildi = false;
	for (const satir of satirlar) {
		if (satir.trim() === "") continue;
		if (!baslikGecildi) {
			baslikGecildi = true;
			continue;
		}
		if (/^\s{0,3}(```|~~~|---|===)/.test(satir)) continue;
		const metin = isaretleriSok(satir);
		if (metin === "") continue;
		return metin.length > uzunluk ? `${metin.slice(0, uzunluk - 1)}…` : metin;
	}
	return "";
}
