/**
 * Playground'un örnek belgeleri  (İş listesi: F6-06)
 *
 * Üçü de bir şey **kanıtlamak** için var, süs olsun diye değil:
 *
 * - `TANITIM` — Markdown'ın her yapısını bir arada gösteriyor ve içinde
 *   kasten "tuzaklı" tercihler taşıyor (yıldızlı liste, parantez ayracı,
 *   setext başlık). Gidiş-dönüş göstergesi bunlar sayesinde anlamlı.
 * - `BOS` — boş belgede yer tutucu ve slash menüsü nasıl görünüyor.
 * - `UZUN` — bin bloklu belge. "Büyük dokümanda yazmak akıcı mı"
 *   sorusunun cevabı okunarak değil, yazarak veriliyor.
 */

export const TANITIM = `# Işık ve Gölge

Word kadar kolay, **Markdown** kadar taşınabilir. Bu editörde yazdığınız
her şey sağda Markdown olarak duruyor — ve *dokunmadığınız satır*
byte düzeyinde değişmiyor.

Alt başlık
----------

Bir kelimeyi seçin: biçimlendirme balonu belirir. Boş satırda \`/\` yazın:
blok menüsü açılır. Sol kenardaki tutamağı sürükleyin: blok taşınır.

* yıldız işareti korunuyor
* çünkü yazım tercihi modelde duruyor
  * iç içe liste de öyle

1) parantez ayracı da öyle
2) numaralandırma biçimi de

> Alıntı, \`satır içi kod\` ve [bağlantı](https://ornek.com).

\`\`\`ts
const editor = new Editor(el, { value: markdown, lang: "tr" });
mountUi(editor);
\`\`\`

| Paket | Boyut |
|---|---|
| \`@kalem-editor/core\` | 11,5 kB |
| \`@kalem-editor/editor\` | 26,1 kB |

- [x] Kayıpsız gidiş-dönüş
- [ ] Sizin ilk belgeniz

---

Türkçe kasa katlaması belgenin diline bağlı: \`ışık\` araması \`IŞIK\`ı
buluyor, \`İŞİK\`i bulmuyor.
`;

export const BOS = "";

/** Bin bloklu belge; performans iddiası okunarak değil yazarak sınanıyor. */
export function uzunBelge(blokSayisi = 1000): string {
	const parcalar: string[] = ["# Bin bloklu belge", ""];
	for (let i = 1; i <= blokSayisi; i++) {
		if (i % 25 === 0) {
			parcalar.push(`## Bölüm ${i / 25}`, "");
			continue;
		}
		if (i % 7 === 0) {
			parcalar.push(`* ${i}. madde — listeler de bloktur`, "");
			continue;
		}
		parcalar.push(
			`${i}. paragraf. Bu belgede **bin blok** var; her biri kendi ` +
				"düzenlenebilir elemanı. Yazmayı deneyin — takılıyor mu?",
			"",
		);
	}
	return parcalar.join("\n");
}

export interface Ornek {
	readonly ad: string;
	readonly metin: () => string;
	readonly aciklama: string;
}

export const ORNEKLER: readonly Ornek[] = [
	{ ad: "Tanıtım", metin: () => TANITIM, aciklama: "Markdown'ın her yapısı bir arada" },
	{ ad: "Boş belge", metin: () => BOS, aciklama: "Yer tutucu ve slash menüsü" },
	{
		ad: "Bin blok",
		metin: () => uzunBelge(1000),
		aciklama: "Büyük belgede yazmak akıcı mı",
	},
];
