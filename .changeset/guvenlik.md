---
"@kalem/core": minor
---

Güvenlik katmanı eklendi (F1-10).

`isSafeUrl` / `sanitizeUrl` protokol beyaz listesi uygular; 55 XSS vektörü
test altında. Şema çözümlemesi önce kontrol karakterlerini temizler —
`java\tscript:` gibi vektörler tam olarak bu adım atlandığı için çalışır.

`data:image/svg+xml` görsel bağlamında bile reddedilir: SVG içinde script
çalışır.

Ham HTML politikası: `escape` (varsayılan), `strip`, `allow` +
`sanitizeHtml` kancası.
