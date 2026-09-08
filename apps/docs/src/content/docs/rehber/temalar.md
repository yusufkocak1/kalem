---
title: Temalar
description: CSS değişkenleriyle markanıza uydurun.
---

Kalem'de CSS-in-JS yoktur — ne bağımlılık, ne runtime maliyeti. Tüm stil tek bir
CSS dosyasından gelir ve **CSS Custom Properties** ile ayarlanır.

```ts
import '@kalem/themes/default.css';
// veya
import '@kalem/themes/minimal.css';
```

## Markalama

Tek bir değişken bloğu, editörün tamamını markanıza uydurur:

```css
.kalem {
  --kalem-font-body: "Source Serif 4", Georgia, serif;
  --kalem-font-ui: "IBM Plex Sans", system-ui, sans-serif;
  --kalem-font-mono: "IBM Plex Mono", monospace;

  --kalem-color-bg: #ffffff;
  --kalem-color-text: #15191c;
  --kalem-color-muted: #79847f;
  --kalem-color-accent: #1f6f6b;
  --kalem-color-border: #e4e2dc;
  --kalem-color-code-bg: #f2f1ec;

  --kalem-radius: 7px;
  --kalem-block-gap: 2px;
  --kalem-measure: 65ch;
}
```

## Koyu tema

İki yaklaşım da desteklenir — sistem tercihi ve açık seçim:

```css
@media (prefers-color-scheme: dark) {
  .kalem:not([data-theme="light"]) {
    --kalem-color-bg: #111517;
    --kalem-color-text: #e8e9e6;
    --kalem-color-accent: #63bfb7;
  }
}

[data-theme="dark"] .kalem {
  --kalem-color-bg: #111517;
  --kalem-color-text: #e8e9e6;
  --kalem-color-accent: #63bfb7;
}
```

## Sınıf önekleri

Tüm sınıflar `kalem-` önekiyle başlar; Tailwind, Bootstrap veya kendi
stillerinizle çakışmaz.

## Shadow DOM neden kapalı?

`@kalem/wc` custom element'inde bile Shadow DOM varsayılan olarak **kapalıdır**.
Sebebi: kapalı bir shadow ağacı, sayfanızdaki fontları ve CSS değişkenlerini
editörün içine geçirmenizi zorlaştırır. İzolasyona gerçekten ihtiyacınız varsa
açabilirsiniz:

```html
<kalem-editor shadow></kalem-editor>
```
