# `@kalem-editor/vue` — Nuxt (SSR)

```bash
pnpm --filter example-nuxt dev
```

**`<ClientOnly>` gerekmiyor.** Vue dünyasında editör sarmalayıcılarının
neredeyse hepsi onu istiyor ve bedeli görünür: sunucu boş bir kutu
gönderiyor, içerik sonradan beliriyor, arama motoru metni hiç görmüyor.

Burada belge sunucuda `@kalem-editor/viewer` ile çiziliyor — ilk boyada okunabilir
bir metin var, JavaScript geldiğinde editör **aynı elemanı** devralıyor.
Bir test ham HTTP yanıtında `<h1>` ve `<li>` olduğunu, bir başkası
hidrasyonda tek bir konsol uyarısı bile olmadığını doğruluyor.

Hidrasyon uyuşmazlığı `innerHTML`i dondurarak engelleniyor: dize bir kez
hesaplanıyor ve bir daha değişmiyor. Değişseydi Vue elemanın içini silip
yeniden yazar, editörün DOM'u, imleci ve geçmişi onunla giderdi.

Örnek Nuxt 4'ü sabitliyor; sarmalayıcıda Nuxt'a özel tek satır yok.
