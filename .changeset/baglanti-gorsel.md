---
"@kalem/core": minor
---

Bağlantı, görsel ve başvurulu bağlantı eklendi; F1-04 tamamlandı.

Satır içi bağlantı `[metin](url "başlık")`, görsel `![alt](url)`, ve üç
biçimde başvuru: tam `[a][b]`, daraltılmış `[a][]`, kısayol `[a]`. Her
biçim yazım tercihi olarak korunuyor.

**`parse(md)` artık çalışıyor** — blok ve satır içi katmanları birleştiren
genel ayrıştırıcı.
