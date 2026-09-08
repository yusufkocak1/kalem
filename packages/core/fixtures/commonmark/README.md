# CommonMark spec test verisi

Kaynak: <https://spec.commonmark.org/0.31.2/spec.json>
Lisans: CC-BY-SA 4.0 (CommonMark spec ile aynı)

652 örnek, 26 bölüm. Her kayıt: `example`, `section`, `markdown`, `html`.

## Şu an ne ölçülüyor

`spec.test.ts` bu veriyle **iki** şey ölçüyor:

1. **Dayanıklılık** — 652 girdinin hiçbirinde ayrıştırıcı patlamıyor.
   Bu pazarlıksız: kullanıcının dosyası ne kadar tuhaf olursa olsun editör
   çökmemeli.
2. **Gidiş-dönüş oranı** — `serialize(parse(md)) === md` bölüm bölüm.
   Yapıyı doğru anladığımızın dolaylı ama güçlü göstergesi.

## Şu an ne ölçülemiyor

**Asıl uyum oranı**, yani `markdown → HTML` karşılaştırması. Çünkü HTML
render'ı henüz yok — `renderToString` **F2-02**'de geliyor.

Bu, iş listesinde yakalanmamış bir bağımlılık: F1-03 ve F1-04'ün kabul
kriterleri "spec suite'te ≥ %90 geçiş" diyor ama spec suite HTML çıktısı
karşılaştırıyor. `html` alanı bu yüzden veride tutuluyor: F2-02 gelir gelmez
aynı dosyayla gerçek uyum ölçülecek.
