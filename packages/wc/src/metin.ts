/**
 * @kalem/wc — Metin yardımcıları  (İş listesi: F5-03)
 *
 * Saf fonksiyonlar; DOM'a dokunmuyorlar ve birim testleri Node altında
 * koşuyor. Elemanın geri kalanı tarayıcıda sınanıyor.
 */

/** İki dizenin ortak öneki. */
function ortakOnek(a: string, b: string): string {
	const n = Math.min(a.length, b.length);
	let i = 0;
	while (i < n && a[i] === b[i]) i++;
	return a.slice(0, i);
}

/**
 * HTML'e gömülü Markdown'ın girintisini söker.
 *
 * Başlangıç metnini elemanın içine yazabilmek için gerekiyor:
 *
 *     <kalem-editor>
 *         # Başlık
 *
 *         Paragraf.
 *     </kalem-editor>
 *
 * Buradaki dört boşluk sayfanın girintisi, yazarın niyeti değil — ama
 * Markdown onu **kod bloğu** sayar. Yani girintiyi sökmemek, sayfayı
 * güzel biçimlendiren herkesin belgesini sessizce koda çevirmek olurdu.
 *
 * Sökülen şey yalnızca **ortak** önek: içerideki göreli girintiler (liste
 * seviyeleri, gerçek kod blokları) olduğu gibi kalıyor.
 */
export function dedent(kaynak: string): string {
	const satirlar = kaynak.split("\n");
	// Baştaki ve sondaki boş satırlar atılıyor: açılış etiketinden sonra ve
	// kapanış etiketinden önce HTML'de hep bir satır sonu var.
	while (satirlar.length > 0 && satirlar[0]?.trim() === "") satirlar.shift();
	while (satirlar.length > 0 && satirlar[satirlar.length - 1]?.trim() === "") satirlar.pop();

	let ortak: string | null = null;
	for (const satir of satirlar) {
		// Boş satırların girintisi yok; hesaba katılsalardı ortak önek hep
		// boş çıkardı ve hiçbir şey sökülmezdi.
		if (satir.trim() === "") continue;
		const girinti = satir.slice(0, satir.length - satir.trimStart().length);
		ortak = ortak === null ? girinti : ortakOnek(ortak, girinti);
		if (ortak === "") break;
	}

	if (ortak === null || ortak === "") return satirlar.join("\n");
	const onek = ortak;
	return satirlar
		.map((s) => (s.startsWith(onek) ? s.slice(onek.length) : s.trimStart()))
		.join("\n");
}
