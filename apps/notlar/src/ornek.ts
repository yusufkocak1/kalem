/**
 * Kalem Notlar — İlk not  (İş listesi: F5-05)
 *
 * Boş bir defter açmak, kullanıcıya "şimdi ne yapacağım" dedirtiyor.
 * Buradaki not aynı zamanda bir test: her satırı uygulamanın gerçekten
 * çalışması gereken bir özelliğe denk geliyor.
 */
export const ILK_NOT = `# Kalem Notlar

Bu bir **not defteri** ve aynı zamanda Kalem'in kendi kullanım denemesi.
Yazmaya başlayın; her şey tarayıcınızda kalıyor.

## Denenecekler

* Bir kelimeyi seçin — biçimlendirme balonu beliriyor
* Boş satırda \`/\` yazın — blok menüsü açılıyor
* \`# \` ya da \`- \` yazın — satır kendiliğinden başlığa, listeye dönüyor
* Ctrl+F ile arayın, Ctrl+H ile değiştirin
* Ctrl+Shift+M — ham Markdown kaynağı

## Türkçe

Kasa katlaması belgenin diline bağlı: \`ışık\` araması \`IŞIK\`ı buluyor,
\`İŞİK\`i bulmuyor. Kelime sayacı da Türkçe'ye göre sayıyor.

> Notlar Markdown olarak duruyor; "Dışa aktar" ile aldığınız \`.md\`
> dosyası başka her yerde açılıyor.

- [x] Yerel kayıt
- [ ] İlk gerçek notunuz

\`\`\`ts
const editor = new Editor(el, { value: markdown });
\`\`\`
`;
