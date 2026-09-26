---
title: Bilinen kısıtlar
description: Nerede çalışıyor, mobilde ne eksik, neler kasıtlı olarak yok.
---

Bu sayfa Kalem'in **yapmadığı** şeyleri anlatıyor. Bir kütüphaneyi seçerken
asıl işe yarayan liste genelde budur; okuduktan sonra sürpriz kalmasın
istiyoruz.

## Desteklenen tarayıcılar

| Tarayıcı | Durum | Nasıl doğrulanıyor |
| --- | --- | --- |
| Chrome / Chromium | Destekleniyor | 400+ test, her koşuda |
| Firefox | Destekleniyor | 350+ test, her koşuda |
| Safari (macOS) | Destekleniyor | 380+ test, her koşuda (WebKit) |
| Edge | Destekleniyor | Tarayıcı geçiş testi, gerçek Edge kurulumunda |
| iOS Safari | **Çalışır, optimize değil** | Cihaz benzetimiyle geçiş testi |
| Android Chrome | **Çalışır, optimize değil** | Cihaz benzetimiyle geçiş testi |

Üç motorda toplam 1.150'nin üstünde tarayıcı testi koşuyor; sayıların
eşit olmamasının sebebi motorun taklit edemediği şeyler — Firefox sentetik
yapıştırma verisini okutmuyor, `longtask` ölçümü yalnızca Chromium'da var.
Varsayılan yerel ayar `tr-TR` — yerel ayara duyarlı bir hatanın
İngilizce'de geçip Türkçe'de patlaması bu şekilde zorlaşıyor.

Edge, Chrome'la aynı motoru (Blink + V8) kullandığı için tüm testleri
ikinci kez koşturmuyoruz; farklı olan kabuk ve onu geçiş testi yokluyor.

:::note[Son iki sürüm ne demek]
Kalem hiçbir tarayıcı sürümüne özel kod taşımıyor ve derleme hedefi
yaygın olarak desteklenen modern sözdizimi. Kullanılan API'lerden en
yenileri `ElementInternals` (form bütünleşmesi, yalnızca
`@kalem/wc` kullanıyorsa) ve `CompressionStream` (yalnızca playground'un
paylaşma özelliğinde, yokluğunda kendiliğinden devre dışı kalıyor).
:::

## Mobil

Karar açık: mobil **çalışır ama optimize değil**. Yani belgenizi
telefondan yazabilirsiniz, ama masaüstünde aldığınız Word benzeri
deneyimin tamamını almazsınız.

### Çalışıyor

- Bloğa dokunup yazmak, imleci başka bloğa taşımak.
- Enter ile yeni blok, Backspace ile birleştirme.
- Giriş kuralları: `# ` başlık, `* ` liste, `> ` alıntı, ` ``` ` kod.
- Slash menüsü (`/` yazınca) — blok türü değiştirmenin dokunmatikteki
  asıl yolu.
- Sabit araç çubuğu: dar ekranda satırlara sarıyor, taşmıyor ve
  düğmeleri dokunulabilir boyutta (WCAG 2.2'nin istediği 24×24 CSS
  pikselinin üstünde).
- Balon araç çubuğu ve bul-değiştir paneli görünüm alanının içinde
  kalıyor.
- Uzun kod blokları ve uzun bağlantılar sayfayı yana kaydırmıyor.

### Eksik ya da belirsiz

**Blok tutamacı dar ekranda çıkmayabilir.** Tutamaç bloğun soluna, kenar
boşluğuna konumlanıyor; boşluk yetmiyorsa hiç görünmüyor — metnin üstüne
binmek dokunmaları ve seçimi yutardı. Ölçümde 393 px genişlikte
çıkmıyor, 412 px'te çıkıyor. Blok türü değiştirmek ve blok silmek için
slash menüsü ve giriş kuralları yedek yol olarak duruyor, ama
**sürükleyerek yeniden sıralamanın dokunmatikte eşdeğeri yok**.

**Sürükleyerek sıralama gerçek cihazda doğrulanmadı.** Tutamacın üstünde
`touch-action: none` var, yani tarayıcı parmağı kaydırma sayıp sürüklemeyi
iptal etmiyor. Ama bunu gerçek bir telefonda ölçmedik; cihaz benzetimi
yerel dokunmatik sürükleme jestini üretemiyor.

**Sanal klavye davranışı ölçülmedi.** Yazılım klavyeleri `beforeinput`
olaylarını fiziksel klavyeden farklı üretiyor: otomatik düzeltme, kelime
tamamlama ve bileşim (composition) araya giriyor. Kalem bileşimi
(`compositionstart`/`compositionend`) hesaba katıyor ve masaüstü IME'siyle
test ediliyor, ama mobil otomatik düzeltmenin giriş kurallarıyla nasıl
etkileştiği **bilinmiyor**. Klavyenin ekranı kaplayıp görünüm alanını
kaydırması da hesaba katılmış değil — imleç klavyenin altında kalabilir.

**Yerel metin seçme jestleri otomasyonla test edilemiyor.** Mobilde metin
seçmek uzun basıp tutamaçları sürüklemek demek ve bu işletim sistemi
katmanında oluyor. Seçim kurulduğunda balon çubuğun doğru yerde çıktığını
programla kurulmuş seçimle doğruladık; jestin kendisini doğrulayamadık.

**Tablet sınanmadı.** Geçiş testleri telefon genişliklerinde
(393 px ve 412 px) koşuyor; tablet genişliğinde ne masaüstü düzeninin ne
de dokunmatik hedeflerin nasıl davrandığını ölçmedik.

## Kasıtlı olarak yok

Bunlar eksik değil, **verilmiş kararlar**:

**Sanal kaydırma yok.** Ölçüm gerektirmediğini gösterdi: 10.000 bloklu
belgede tuş başına maliyet 13 ms, bir karenin altında. Ayrıntı
[Büyük belgeler ve performans](/rehber/performans/) sayfasında.

**İşbirlikli düzenleme (CRDT) yok.** Kalem tek kullanıcılı bir editör.
Model kalıcı ve düzenlemeler saf fonksiyonlar olduğu için üstüne bir
senkronizasyon katmanı yazmak mümkün, ama kütüphanenin kendisi bunu
yapmıyor.

**Gömülü HTML çalıştırılmıyor.** Markdown içindeki ham HTML metin olarak
korunuyor, ayrıştırılıp DOM'a basılmıyor. Sebebi güvenlik: kullanıcı
metnini HTML olarak ayrıştırmak bu kütüphanenin hiçbir yerinde
yapılmıyor. Ayrıntı [Güvenlik](/rehber/guvenlik/) sayfasında.

**Bağlantı protokolleri beyaz listeyle sınırlı.** Yalnızca `http:`,
`https:`, `mailto:`, `tel:` ve `ftp:` geçiyor; listede olmayan her şey —
`javascript:` ve bugün var olmayan ama yarın icat edilecek olanlar dâhil —
düşürülüyor. Görsellerde ayrıca `data:image/png|jpeg|gif|webp|avif`
kabul ediliyor; `data:image/svg+xml` **kasten dışarıda**, çünkü SVG
içinde script çalışıyor.

## Henüz ölçülmemiş

Dürüst olmak gerekirse bu maddeler "çalışıyor" demeye yetecek kadar
sınanmadı:

- **Ekran okuyucuyla elle test** (NVDA, VoiceOver). Erişilebilirlik
  otomatik olarak `axe` ile her koşuda denetleniyor ve klavye gezinmesi
  testlerle sabitleniyor, ama bir ekran okuyucunun deneyimi elle
  dinlenmedi.
- **Linux'ta görsel referanslar.** Görsel regresyon anlık görüntüleri
  Windows'ta üretildi; Linux'ta font işleme farklı olduğu için o
  platformda referanslar henüz yok.

## Bir kısıtla karşılaştıysanız

Bu listede olmayan bir şeyle karşılaştıysanız o bir hata olabilir —
hangi tarayıcı, hangi cihaz ve hangi belgeyle olduğunu yazarak bildirin.
