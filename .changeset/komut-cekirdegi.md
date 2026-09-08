---
"@kalem/core": minor
---

Komut çekirdeği eklendi (F1-11).

`toggleMark`, `setBlockType`, `wrapIn`, `lift`, `splitBlock`, `joinBlocks`,
`insertNode` — hepsi DOM'suz, saf ve değişmez. Faz 2'deki editör motoru
bunları çağıracak.

Serileştiricide bir düzeltme: boş liste maddesi artık `- ` yerine `-`
üretiyor (sonda görünmez boşluk kalmıyor).
