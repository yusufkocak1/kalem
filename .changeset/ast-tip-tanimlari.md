---
"@kalem/core": minor
---

AST tip tanımları, düğüm künye kaydı ve tip koruyucular eklendi (F1-01).

Ağaç mdast şemasıyla şekil olarak uyumlu; `unified` bağımlılığı yok.
Uyumluluk, elle yazılmış mdast arayüzlerine atanabilirlik testiyle korunuyor.

Her düğüm, kaynaktaki yazım tercihini (`-` mi `*` mi, ATX mi setext mi,
``` mi ~~~ mi) `syntax` alanında taşıyabiliyor — gidiş-dönüş sadakatinin
(F1-07) önkoşulu bu.
