---
title: Güvenlik
description: XSS yüzeyi, URL beyaz listesi ve ham HTML politikası.
---

Bir Markdown editörü, kullanıcı metnini ekrana basan bir program. Bu onu
doğrudan XSS hedefi yapıyor ve Kalem'in birkaç kuralı bu yüzden
**pazarlığa kapalı**.

## `innerHTML` hiç kullanılmıyor

Ne görüntüleyici ne editör kullanıcı içeriğini HTML olarak ayrıştırıyor.
Her düğüm `createElement` / `createTextNode` ile kuruluyor;
`renderToString` de kaçışı kendisi yapıyor.

Tek bir `innerHTML` satırı tüm yüzeyi geri getirdiği için bu bir üslup
tercihi değil, sürdürülen bir sınır.

## URL beyaz listesi

Bağlantı ve görsel adresleri bir **beyaz listeden** geçiyor:

```ts
import { ALLOWED_PROTOCOLS, isSafeUrl, sanitizeUrl } from '@kalem/core';

ALLOWED_PROTOCOLS; // ["http:", "https:", "mailto:", "tel:", "ftp:"]

isSafeUrl('javascript:alert(1)');  // false
sanitizeUrl('javascript:alert(1)'); // "#"
```

Kara liste değil beyaz liste: `javascript:` yazımının kaç varyantı olduğunu
(`java\tscript:`, `JaVaScRiPt:`, sıfır genişlikli karakterler) saymak
yerine, bilinen güvenli şemaların dışındaki her şey reddediliyor.

Güvensiz URL **silinmiyor, etkisizleştiriliyor** (`#` oluyor): bağlantının
metni yerinde kalıyor, yani kullanıcı içeriğinin bir parçasının sessizce
yok olduğunu görmüyor.

### Görsellerde `data:`

Görseller için ayrıca birkaç `data:` MIME türüne izin var: `image/png`,
`image/jpeg`, `image/gif`, `image/webp`, `image/avif`.

`data:image/svg+xml` **kasten dışarıda**: SVG içinde script çalışıyor ve
bu, `<img>` üzerinden bile bazı bağlamlarda tehlikeli.

## Ham HTML politikası

Markdown ham HTML'e izin veriyor. Kalem varsayılan olarak onu
kaçırıyor:

```ts
renderToString(ast, { html: 'escape' }); // varsayılan
```

| Politika | Davranış | Ne zaman |
|---|---|---|
| `"escape"` | HTML metin olarak görünüyor | Varsayılan; güvenli |
| `"strip"` | Tamamen atılıyor | HTML'in hiç görünmemesi gerektiğinde |
| `"allow"` | Çağıranın kancasına veriliyor | Güvendiğiniz içerik |

`"allow"` seçtiğinizde iş size geçiyor — kütüphane HTML ayrıştırmıyor:

```ts
import DOMPurify from 'dompurify';

renderToDOM(ast, el, {
  html: 'allow',
  sanitizeHtml: (html) => DOMPurify.sanitize(html),
  renderRawHtml: (html) => {
    const sablon = document.createElement('template');
    sablon.innerHTML = html;   // temizlenmiş HTML — sorumluluk sizde
    return sablon.content;
  },
});
```

Kanca vermezseniz ham HTML **metin olarak** basılıyor: sessizce
kaybolmaktansa görünür ve zararsız olması tercih edildi.

## Yapıştırma

Word ve Google Docs'tan yapıştırılan HTML, tarayıcının `DOMParser`ı ile
değil Kalem'in kendi dönüştürücüsüyle (`@kalem/core/html`) işleniyor ve
sonuç **AST'ye** çevriliyor. Yani yapıştırılan içerik de aynı beyaz
listeden ve aynı kaçış kurallarından geçiyor; `<script>` ya da
`onerror=` taşıyan bir yapıştırma belgeye giremiyor.

## Çekirdek sunucuda çalışıyor

`@kalem/core` ve `@kalem/viewer` DOM'a dokunmuyor. Bunu bir **kapı**
(`pnpm guard:purity`) doğruluyor: çekirdek bundle'ında `document`,
`window`, `navigator`, `localStorage` ya da `HTMLElement` geçmesi CI'ı
kırıyor.

Pratik sonucu: Markdown'ı sunucuda HTML'e çevirirken tarayıcı taklidi
(jsdom) kurmanıza gerek yok — ve kullanıcı içeriği, bir DOM
uygulamasının tuhaflıklarına hiç uğramadan işleniyor.

## Bildirim

Güvenlik açığı bulursanız issue açmak yerine
[güvenlik politikasını](https://github.com/kalem-editor/kalem/security)
izleyin.
