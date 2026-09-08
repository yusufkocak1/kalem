---
"@kalem/core": minor
---

HTML → AST dönüştürücü eklendi (F1-09), `@kalem/core/html` alt yolunda.

Word, Google Docs ve genel web HTML'ini AST'ye çevirir: beyaz liste, stil
çıkarımı, Word `<o:p>` temizliği, Google Docs'un sahte kalın sarmalayıcısı,
görev listesi ve tablo.

DOM tiplerine bağlı değil — gerçek bir `Element`'in yapısal olarak uyduğu
küçük bir arayüzle çalışır, böylece `@kalem/core` sunucuda çalışmaya devam
eder ve testler jsdom gerektirmez.

Ayrı giriş noktası olmasının sebebi boyut: yalnızca Markdown işleyen
kullanıcı bu kodu indirmez.
