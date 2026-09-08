---
"@kalem/core": minor
---

Gidiş-dönüş korpusu, CommonMark spec verisi ve özellik tabanlı testler
eklendi; Faz 1 tamamlandı.

Özellik testleri yedi serileştirici hatası buldu ve hepsi düzeltildi: boş
vurgu düğümleri, boş kod span'leri, paragraf kenarındaki sert satır sonları,
işaret yanındaki boşluk, sınır çakışmaları, saran işaretin metne sağladığı
"eş", ve `!` ile biten metnin ardından gelen bağlantının görsele dönüşmesi.

Kaçışlama artık **yalnızca gerçekten blok açan** işaretleri kaçırıyor:
`#5 bolt`, `+++`, `===`, `~1 hafta` artık ters bölüyle dolmuyor.

`@kalem/core/commands` ayrı giriş noktası oldu — core 12 kB bütçesinin
altına indi (7.96 kB).
