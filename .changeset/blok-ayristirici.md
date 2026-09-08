---
"@kalem/core": minor
---

Kaynak tarayıcı ve yaprak blok ayrıştırıcı eklendi (F1-03, kısmi).

`scan()` kaynağı satırlara böler; sekme genişletme, satır sonu çeşitleri
(LF/CRLF/CR), BOM ve NUL normalleştirmesi tek yerde toplandı.

`parseBlocks()` paragraf, ATX + setext başlık, yatay çizgi, çitli ve
girintili kod bloklarını ayrıştırır. Her düğüm `position` ve yazım
tercihini (`syntax`) taşır.

API henüz kararlı değil: kapsayıcı bloklar, HTML blokları ve satır içi
ayrıştırma eksik.
