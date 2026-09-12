---
title: Salt okunur mod
description: Belgeyi kilitlemek, önizleme ve yetki kontrolü.
---

## Editörü kilitlemek

```ts
editor.setReadOnly(true);
editor.isReadOnly(); // true
```

İçerik görünür kalıyor; düzenlenebilirlik kalkıyor, kök elemana
`aria-readonly="true"` yazılıyor ve `readonlychange` olayı yayılıyor.

```ts
editor.on('readonlychange', (saltOkunur) => {
  kaydetDugmesi.disabled = saltOkunur;
});
```

Arayüz katmanı düğmelerini bu olayla kapatıyor — editörü sürekli
yoklamak yerine haber vermek.

## Baştan kilitli

```ts
new Editor(el, { value: md, readOnly: true, label: 'Belge (salt okunur)' });
```

## Çerçevelerde

```tsx
<KalemEditor value={metin} readOnly={!yetkiliMi} />
```

```vue
<KalemEditor v-model="metin" :read-only="!yetkiliMi" />
```

```html
<kalem-editor readonly></kalem-editor>
```

Özel elemanda `disabled` de var ve aynı işi yapıyor — form tarafından
devre dışı bırakılan bir alan (`<fieldset disabled>` dâhil) otomatik
kilitleniyor. Editörde "devre dışı" diye ayrı bir kip yok; salt okunur
yeterli ve doğrusu da o: içerik görünür kalıyor, yalnızca
düzenlenemiyor.

## Editörü hiç kurmamak

Sayfada düzenleme **ihtimali yoksa** editörü yüklemeyin. 26 kB yerine
2,7 kB:

```ts
import { parse } from '@kalem/core';
import { renderToDOM } from '@kalem/viewer';

renderToDOM(parse(markdown), document.getElementById('app')!);
```

```ts
import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
// editor.css ve ui.css gerekmiyor
```

Seçim kuralı basit: **düzenleme ihtimali varsa** editörü salt okunur
başlatmak daha az iş; **hiç yoksa** viewer daha küçük.

## Yan yana önizleme

Aynı belgeyi hem düzenleyip hem canlı göstermek:

```ts
import { renderToDOM } from '@kalem/viewer';

const editor = new Editor(sol, {
  value: md,
  onChange: (_markdown, doc) => renderToDOM(doc, sag),
});
```

`onChange` ikinci argümanda AST'yi de veriyor, yani metni yeniden
ayrıştırmanıza gerek yok.

## Yetki kontrolü nerede

Salt okunur mod bir **arayüz** kolaylığı, güvenlik sınırı değil.
Kullanıcı konsoldan `editor.setReadOnly(false)` çağırabiliyor. Yetki
kontrolü sunucuda: kaydetme uç noktanız kimin neyi değiştirebileceğine
kendisi karar vermeli.
