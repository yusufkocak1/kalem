---
"@kalem/core": minor
---

HTML blokları ve bağlantı tanımları eklendi; F1-03 tamamlandı.

CommonMark'ın yedi HTML blok türünün hepsi destekleniyor. Ham HTML
korunuyor, çalıştırılmıyor.

Bağlantı tanımları (`[etiket]: url "başlık"`) ayrıştırılıyor. Etiket
eşleştirmesi CommonMark gereği locale'den bağımsız Unicode katlamasıyla
yapılıyor — Türkçe kuralı uygulansaydı aynı belge başka araçlarda farklı
çözülürdü.
