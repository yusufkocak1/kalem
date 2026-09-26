---
title: Viewer (salt okunur)
description: Markdown'ı DOM'a veya HTML dizesine çizin — düzenleme kodu indirmeden.
---

`@kalem/viewer` Markdown'ı **gösteriyor**, düzenlemiyor. 2,7 kB (min+gzip)
ve düzenleme motorundan tamamen bağımsız: bir blog, bir yorum listesi ya da
bir e-posta önizlemesi için editörün 27 kB'ını indirmenize gerek yok.

İki çıkış var ve **aynı sonucu** veriyorlar:

```ts
import { parse } from '@kalem/core';
import { renderToDOM, renderToString } from '@kalem/viewer';

const ast = parse('# Başlık\n\nBir **paragraf**.');

renderToDOM(ast, document.getElementById('app')!);   // tarayıcıda
const html = renderToString(ast);                     // sunucuda
```

Üç tarayıcı motorunda `renderToDOM` ve `renderToString` çıktılarının
**byte-birebir** aynı olduğu testle sabit. Yani sunucuda ürettiğiniz HTML
ile istemcinin çizdiği ağaç arasında hidrasyon uyuşmazlığı çıkmıyor.

## `innerHTML` hiç kullanılmıyor

`renderToDOM` her düğümü `createElement` / `createTextNode` ile kuruyor.
Bu bir performans tercihi değil, güvenlik kararı: kullanıcı metnini HTML
olarak ayrıştıran tek bir satır, tüm XSS yüzeyini geri getirir.
`renderToString` de aynı sebeple kendi kaçışını yapıyor.

Ayrıntı: [Güvenlik](/rehber/guvenlik/).

## Seçenekler

```ts
renderToString(ast, {
  html: 'escape',        // ham HTML politikası
  classPrefix: 'kalem-', // CSS sınıf öneki
  frontmatter: false,    // `---` bloğu gösterilsin mi
});
```

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `html` | `"escape" \| "strip" \| "allow"` | `"escape"` | Markdown içindeki ham HTML'e ne yapılacağı |
| `sanitizeHtml` | `(html: string) => string` | — | `html: "allow"` seçildiğinde temizleme kancası |
| `classPrefix` | `string` | `"kalem-"` | Üretilen sınıfların öneki |
| `frontmatter` | `boolean` | `false` | YAML/TOML frontmatter gösterilsin mi |

`renderToDOM` bunlara iki tane daha ekliyor:

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `containerClass` | `string \| false` | `"<önek>doc"` | Kapsayıcıya eklenen sınıf; `false` ile kapatılıyor |
| `renderRawHtml` | `(html: string) => Node \| null` | — | `html: "allow"` için düğüm üretme kancası |

:::caution[`html: "allow"` tek başına yetmiyor]
Kütüphane HTML **ayrıştırmıyor**. `allow` seçtiğinizde ham HTML'i düğüme
çevirme işi size ait (`renderRawHtml`) ve temizlemesi de
(`sanitizeHtml`). Kanca vermezseniz ham HTML **metin olarak** basılıyor:
sessizce kaybolmaktansa görünür ve zararsız olması tercih edildi.
:::

## Sınıflar neden az

Viewer "her elemana bir sınıf" yaklaşımını kullanmıyor. Sınıf yalnızca
etiketin kendisinin anlatmadığı yerlerde veriliyor: görev listesi
onay kutusu, tablo hücresi hizalaması, kod bloğunun dili. Gerisi düz
semantik HTML — `<h1>`, `<p>`, `<ul>`, `<blockquote>`.

Sebep hem boyut hem de gürültü: `class="kalem-paragraph"` taşıyan bir
`<p>`, `<p>`den daha fazla bir şey söylemiyor ama her paragrafta 24 bayt
yer kaplıyor ve sizin kendi CSS'inizle çakışıyor.

## Stil

Tipografi `@kalem/themes/viewer.css` içinde ve `.kalem-doc` altına
kapatılı — sayfanın geri kalanına tek kural sızmıyor.

```ts
import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
```

`renderToString` kullanıyorsanız kapsayıcıyı kendiniz sarmalıyorsunuz:

```html
<article class="kalem-doc kalem-theme">
  <!-- renderToString çıktısı -->
</article>
```

`kalem-theme` sınıfı renk sözlüğünü getiriyor; ayrıntı
[Temalar](/rehber/temalar/).

## Sunucuda

`@kalem/core` ve `@kalem/viewer` DOM'a dokunmuyor — Node'da, worker'da ve
edge çalışma zamanlarında aynı şekilde çalışıyorlar. Bir saflık kapısı
(`pnpm guard:purity`) bunu CI'da doğruluyor: çekirdek bundle'ında
`document`, `window` ya da `navigator` geçmesi build'i kırıyor.

```ts
// Bir Astro / Next.js / Express sunucusunda
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export function markdownToHtml(md: string): string {
  return renderToString(parse(md));
}
```

Tam tarif: [Sunucuda Markdown → HTML](/tarifler/sunucuda-markdown/).

## Ne zaman viewer, ne zaman editör?

Aynı sayfada ikisini birden kurmayın. Editör zaten salt okunur moda
geçebiliyor:

```ts
editor.setReadOnly(true);
```

Viewer'ı seçmenin tek sebebi **düzenleme kodunu hiç indirmemek**. Sayfada
düzenleme ihtimali varsa editörü salt okunur başlatmak daha az iş.
