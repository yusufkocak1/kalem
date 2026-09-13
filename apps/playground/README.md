# apps/playground — Kalem playground

Kütüphanenin vitrini: bir sayfa, beş iddia ve hepsinin kanıtı.

```bash
pnpm build                          # önce paketler
pnpm --filter kalem-playground dev  # http://localhost:5173
```

## Ne gösteriyor

1. **Word deneyimi** — balon araç çubuğu, sabit çubuk, slash menüsü, blok
   tutamağı, bağlantı balonu. `mountUi(editor)` tek satır.
2. **Çıktı Markdown** — sağ panel her tuşta güncelleniyor. JSON yok.
3. **Kayıpsız gidiş-dönüş** — rozet `serialize(parse(v)) === v` ölçümünü
   gösteriyor. Bir kütüphane bunu söyleyebilir; burada kendi yazdığınız
   metinde görüyorsunuz.
4. **Word'den yapıştırma** — tek düğme. `mso-list` ile sahte liste yapan,
   iç içe boş `<span>` döşeyen gerçek Word HTML'i başlığa, listeye ve
   bağlantıya dönüşüyor.
5. **Büyük belge** — bin bloklu örnek. "Akıcı mı" sorusu okunarak değil
   yazarak cevaplanıyor.

Ayrıca: tema seçici (açık / koyu / yalın), araç çubuğu kipi, giriş
kuralları anahtarı, salt okunur, içindekiler paneli, ham Markdown kaynağı,
kelime sayacı ve otomatik kaydetme göstergesi.

## Neden `apps/demo` değil

İş listesi bu maddeyi (`F6-06`) `apps/demo` diye adlandırıyor ama
`apps/demo` bu arada başka bir işe sahip oldu: **on yedi tarayıcı test
dosyasının zemini**. `editor.html`, `viewer.html` ve `wc.html`
sayfalarındaki eleman kimlikleri 1100 testin bağlı olduğu bir sözleşme, ve
üzerlerindeki hata ayıklama göstergeleri (blok sayısı, seçim durumu,
geçmiş, etkin biçimler) geliştirici için.

Orayı ürün demosuna çevirmek ikisini de bozardı: vitrinin içinde hata
ayıklama tabloları, testlerin altında ise kayan bir zemin olurdu. İki
uygulamanın işi gerçekten farklı.

## Word yapıştırması nasıl benzetiliyor

Tarayıcı, kullanıcının izni olmadan panoya yazdırmıyor — ve izin istese
bile kullanıcının kendi panosunu ezmek kaba olurdu. Düğme, Word'ün panoya
koyduğu veriyi doğrudan bir `paste` olayı olarak editöre gönderiyor:
editörün gördüğü şey gerçek bir yapıştırmadakinin aynısı, `text/html` ve
`text/plain` taşıyan bir `DataTransfer`.

Örnek HTML `src/word-ornegi.ts` içinde ve okunmak için kısaltılmış; daha
uzun ve daha zorlu sürümü tarayıcı testlerinde
(`e2e/fixtures/word-clipboard.ts`).

## Görsel yükleme

Sunucu yok: yüklenen görsel `FileReader` ile `data:` adresine çevriliyor.
Uçtan uca çalışıyor ve çevrimdışı kalıyor. Beyaz liste `data:image/png`,
`jpeg`, `gif`, `webp` ve `avif`e izin veriyor; SVG kasten dışarıda
(içinde script çalışıyor).

## Testler

```bash
pnpm e2e:examples playground
```

On bir tarayıcı testi yukarıdaki beş iddiayı ve denetimleri sınıyor.
