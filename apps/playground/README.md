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

Ayrıca **"Bağlantıyı kopyala"**: yazdığınız belge adresin içine giriyor,
bağlantıyı açan aynı belgeyi görüyor.

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

## Paylaşılabilir bağlantı

Belge, adresin **karma (hash) parçasında** sıkıştırılmış olarak taşınıyor
(`src/baglanti.ts`). Üç karar var.

**Karma, sorgu değil.** Karma parçası sunucuya hiç gönderilmiyor: paylaşılan
bir belgenin metni, bağlantıyı barındıran sunucunun günlüklerine düşmüyor ve
bir ara vekil onu göremiyor. Bir yazma aracında bu, gizlilik açısından en
ucuz doğru karar. Yan fayda: sunucuların sorgu dizesine uyguladığı uzunluk
sınırları (çoğu 8 kB) karmayı bağlamıyor. Bir tarayıcı testi bunu
sabitliyor — düğmeye basıldıktan sonra giden isteklerin hiçbirinde karma yok.

**`lz-string` değil, tarayıcının kendisi.** İş listesi "LZ sıkıştırma" diyor
ve akla ilk gelen paket `lz-string`. Ama tarayıcı bunu zaten yapıyor:
`CompressionStream("deflate-raw")` — daha iyi sıkıştırıyor (LZ77 + Huffman)
ve uygulamaya tek bayt eklemiyor. Desteklemeyen tarayıcıda sıkıştırma
atlanıyor, bağlantı yine çalışıyor; ön ek (`1` / `0`) hangi biçim olduğunu
söylüyor.

Ölçüm iki ucu da gösteriyor:

| Belge | Ham | Bağlantıda |
| --- | --- | --- |
| Tanıtım (890 karakter) | 890 | 857 (%96) |
| 200 blok | 20.122 | 1.096 (%5) |
| 1.000 blok | 100.825 | 4.600 (%5) |

Küçük belgede kazanç neredeyse yok: base64 taşımayı %33 şişiriyor ve
deflate'in kazandırdığı kadarını geri alıyor. Asıl fayda uzun belgede ve
paylaşımın çöktüğü yer de orası — sıkıştırma olmasaydı bin bloklu belge
134 bin karakterlik bir bağlantı üretirdi ve hiçbir sohbet uygulaması onu
taşımazdı.

**Yalnızca belge.** Tema, araç çubuğu kipi ve özellik anahtarları
**okuyucunun tercihi**, yazarın içeriği değil; bir bağlantının karşı tarafın
temasını değiştirmesi beklenmedik olurdu.

Adres 12.000 karakteri aşarsa bağlantı yine üretiliyor ama kullanıcı
uyarılıyor: tarayıcılar çok daha uzununu taşıyor, araya giren araçlar
taşımıyor.

Adres çubuğu `history.replaceState` ile güncelleniyor, `location.hash = …`
ile değil — ikincisi geçmişe kayıt ekliyor ve geri tuşu kullanıcıyı kendi
belgesinden çıkarıyordu. Pano yazması başarısız olsa da (güvensiz köken,
izin reddi) bağlantı adres çubuğunda duruyor.

## Görsel yükleme

Sunucu yok: yüklenen görsel `FileReader` ile `data:` adresine çevriliyor.
Uçtan uca çalışıyor ve çevrimdışı kalıyor. Beyaz liste `data:image/png`,
`jpeg`, `gif`, `webp` ve `avif`e izin veriyor; SVG kasten dışarıda
(içinde script çalışıyor).

## Testler

```bash
pnpm e2e:examples playground
```

On beş tarayıcı testi yukarıdaki iddiaları ve denetimleri sınıyor; dördü
paylaşımı (aynı içerik açılıyor, karma sunucuya gitmiyor, bozuk bağlantı
uygulamayı açmaya engel olmuyor, geçmişe kayıt eklenmiyor).

```bash
pnpm vitest run apps/playground
```

On iki birim testi bağlantı kodlamasını sınıyor: gidiş-dönüş, Türkçe
karakterler, sıkıştırmanın gerçekten kazandırması, adres-güvenli karakter
kümesi ve bozuk girdide `null`.
