/**
 * Canlı örneklerin paylaştığı belge  (İş listesi: F6-03)
 *
 * Üç çerçevenin **aynı** metinle açılması sayfanın iddiasının parçası:
 * fark yalnızca montaj kodunda, çıktıda değil.
 *
 * Metin bilerek "tuzaklı": yıldızlı liste, parantez ayracı ve satır içi
 * kod, gidiş-dönüşün kayıpsızlığını okuyucunun gözüyle sınayabileceği
 * yerler.
 *
 * İki dilde: site Türkçe (kök) ve İngilizce (`/en/`) sayfalar sunuyor ve
 * İngilizce sayfadaki editörün Türkçe bir belgeyle açılması okuyucuya
 * ürünün Türkçe'ye özel olduğunu düşündürürdü.
 */

/** Sitenin dilleri. */
export type Dil = "tr" | "en";

export const ORNEK_BELGE = `# Işık ve Gölge

Bu editör **gerçekten çalışıyor**. Yazmayı deneyin — sağdaki Markdown her
tuşta güncelleniyor ve yazım tercihiniz korunuyor.

* yıldız işareti korunuyor
* çünkü tercih modelde duruyor

1) parantez ayracı da öyle

> Alıntı, \`kod\` ve [bağlantı](https://ornek.com).
`;

export const ORNEK_BELGE_EN = `# Light and Shadow

This editor **really works**. Try typing — the Markdown on the right
updates on every keystroke, and your writing style is kept.

* the asterisk bullet is kept
* because the choice lives in the model

1) so is the parenthesis delimiter

> A quote, \`code\` and a [link](https://example.com).
`;

/** Giriş sayfasındaki editörün belgesi. */
export const GIRIS_BELGESI: Record<Dil, string> = {
	tr: `# Işık ve Gölge

Word kadar kolay, **Markdown** kadar taşınabilir. Bir kelime seçin —
biçimlendirme balonu belirir. Boş satırda \`/\` yazın — blok menüsü açılır.

* yıldız işareti korunuyor
* çünkü yazım tercihi modelde duruyor

1) parantez ayracı da öyle
`,
	en: `# Light and Shadow

Easy as Word, portable as **Markdown**. Select a word — the formatting
bubble appears. Type \`/\` on an empty line — the block menu opens.

* the asterisk bullet is kept
* because the writing style lives in the model

1) so is the parenthesis delimiter
`,
};

export function ornekBelge(dil: Dil): string {
	return dil === "en" ? ORNEK_BELGE_EN : ORNEK_BELGE;
}

/** Canlı örneklerin erişilebilir adları. */
export function canliEtiket(dil: Dil, cerceve: string): string {
	return dil === "en" ? `Live example — ${cerceve}` : `Canlı örnek — ${cerceve}`;
}
