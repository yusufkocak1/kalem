---
title: Viewer (salt okunur)
description: Markdown'ı güvenle render edin — tarayıcıda veya sunucuda.
---

`@kalem/viewer` yalnızca **görüntüler**. Editör kodunu içermez, bu yüzden bundle'ınıza
sadece ~14 kB ekler.

## Tarayıcıda

```ts
import { parse } from '@kalem/core';
import { renderToDOM } from '@kalem/viewer';
import '@kalem/themes/default.css';

const ast = parse('# Başlık\n\nMerhaba **dünya**.');
renderToDOM(ast, document.getElementById('out')!);
```

## Sunucuda (SSR / statik üretim)

`renderToString` saf bir fonksiyondur — DOM'a dokunmaz. Node, Deno, Cloudflare
Workers, Next.js RSC ve Nuxt/Nitro içinde çalışır.

```ts
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export function GET() {
  const html = renderToString(parse(markdown));
  return new Response(`<article class="kalem">${html}</article>`, {
    headers: { 'content-type': 'text/html' },
  });
}
```

Next.js App Router'da sunucu bileşeni olarak:

```tsx
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export default async function Post({ markdown }: { markdown: string }) {
  return (
    <article
      className="kalem"
      dangerouslySetInnerHTML={{ __html: renderToString(parse(markdown)) }}
    />
  );
}
```

`renderToString` çıktısı zaten kaçış karakterlenmiştir; ham HTML'i açmadığınız
sürece bu kullanım güvenlidir.

## Ham HTML politikası

Varsayılan olarak Markdown içindeki ham HTML **çalıştırılmaz**, kaçış
karakterlenip metin olarak gösterilir.

```ts
renderToString(ast, {
  allowHtml: true,                          // ham HTML'i etkinleştir
  sanitizeHtml: (html) => myPurifier(html), // kendi temizleyicinizi takın
});
```

Ayrıntılar için [Güvenlik](/rehber/guvenlik/) sayfasına bakın.

## Neden `innerHTML` yok?

Viewer, AST'yi `document.createElement` ve `textContent` ile DOM'a çevirir.
Hiçbir noktada HTML string'i parse edilmez. Bu, XSS yüzeyini **yapısal olarak**
ortadan kaldırır — Kalem'in DOMPurify gibi bir temizleyiciye bağımlılığı yoktur
ve bu tek başına ~9 kB tasarruf demektir.
