---
title: Sunucuda Markdown → HTML
description: Tarayıcı taklidi olmadan, Node'da, worker'da ve edge'de.
---

`@kalem/core` ve `@kalem/viewer` DOM'a dokunmuyor. Markdown'ı sunucuda
HTML'e çevirmek için jsdom kurmanıza gerek yok.

```ts
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export function markdownToHtml(md: string): string {
  return renderToString(parse(md));
}
```

Toplam 15,3 kB (min+gzip) ve üçüncü parti bağımlılığı yok.

## Bunu bir kapı koruyor

`pnpm guard:purity` çekirdek bundle'ında `document`, `window`,
`navigator`, `localStorage` ya da `HTMLElement` geçip geçmediğine bakıyor.
Geçerse CI kırmızı. Yani "sunucuda çalışır" bir vaat değil, ölçülen bir
özellik.

## Çıktı istemciyle birebir aynı

`renderToString` ve `renderToDOM` aynı planı üretiyor; üç tarayıcı
motorunda çıktılarının **byte-birebir** aynı olduğu testle sabit.
Sunucuda ürettiğiniz HTML'i istemcide hidrate ederken uyuşmazlık
çıkmıyor — Nuxt örneği tam olarak bunun üstüne kurulu.

## Kapsayıcı ve stil

```html
<article class="kalem-doc kalem-theme">
  <!-- renderToString çıktısı -->
</article>
```

```html
<link rel="stylesheet" href="/@kalem/themes/tokens.css">
<link rel="stylesheet" href="/@kalem/themes/viewer.css">
```

`editor.css` ve `ui.css` gerekmiyor: okuyucuya kullanmayacağı düzenleme
stillerini indirtmenin anlamı yok.

## Güvenlik

Varsayılan ayarlarla çıktı güvenli:

- Ham HTML **kaçırılıyor** (`html: "escape"`).
- Bağlantı ve görsel adresleri beyaz listeden geçiyor; `javascript:`
  etkisizleştiriliyor.
- `innerHTML` hiç kullanılmıyor; kaçış kütüphanenin kendisinde.

Güvendiğiniz içerikte ham HTML'e izin vermek isterseniz iş size geçiyor:

```ts
renderToString(ast, {
  html: 'allow',
  sanitizeHtml: (html) => DOMPurify.sanitize(html),
});
```

Ayrıntı: [Güvenlik](/rehber/guvenlik/).

## Örnekler

### Express

```ts
app.get('/yazi/:id', async (req, res) => {
  const md = await yaziyiOku(req.params.id);
  res.send(`<article class="kalem-doc kalem-theme">${renderToString(parse(md))}</article>`);
});
```

### Astro

```astro
---
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

const html = renderToString(parse(Astro.props.markdown));
---
<article class="kalem-doc kalem-theme" set:html={html} />
```

### Cloudflare Workers / edge

Paketler saf ES modülleri, Node API'si kullanmıyorlar:

```ts
export default {
  async fetch(istek: Request): Promise<Response> {
    const md = await istek.text();
    return new Response(renderToString(parse(md)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
```

## Yalnızca ayrıştırmak

HTML üretmeden AST'yi işlemek isterseniz — başlıkları çıkarmak, bağlantı
denetlemek, içerik taşımak:

```ts
import { parse, visit } from '@kalem/core';

const basliklar: string[] = [];
visit(parse(md), (node) => {
  if (node.type === 'heading') basliklar.push(metniAl(node));
});
```

`@kalem/core` tek başına 12,6 kB ve `@kalem/viewer`e ihtiyaç duymuyor.
