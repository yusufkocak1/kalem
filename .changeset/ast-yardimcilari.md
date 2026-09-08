---
"@kalem/core": minor
---

AST gezinme, konum ve düzenleme yardımcıları eklendi (F1-02).

`walk` / `visit` / `find` ağacı belge sırasıyla gezer, `SKIP` ve `EXIT` ile
kontrol edilir. `nodeAtPath` / `pathToNode` / `parentPath` düğümleri kökten
inen indis yollarıyla adresler.

`insertAt` / `replaceAt` / `removeAt` **değişmezdir**: girdiyi değiştirmez,
yapısal paylaşımla yeni ağaç döndürür — yalnızca yol üzerindeki atalar
kopyalanır, kardeş alt ağaçların referansı korunur.

`clone`, `position` ve `id` alanlarını seçmeli bırakabilir; alt ağacı başka
bir yere takarken ikisi de istenmez.
