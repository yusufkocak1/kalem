---
title: Başlangıç
description: Kalem'i beş satırda projenize ekleyin.
---

:::caution[Henüz npm'de değil]
Kütüphane yazıldı ve çalışıyor; ilk yayın **v1.0** olacak. Aşağıdaki API
depodaki koddan alınmıştır.
:::

## Hangi paket?

Kalem tek bir paket değil. İhtiyacınız kadarını kurun — ödemediğiniz şeyi
indirmezsiniz.

| Ne yapmak istiyorsunuz | Paket | Boyut (min+gzip) |
|---|---|---|
| Markdown'ı **göstermek** (salt okunur) | `@kalem-editor/viewer` | 2,9 kB |
| Markdown'ı **ayrıştırmak** (sunucuda, betikte) | `@kalem-editor/core` | 13,4 kB |
| **Düzenlemek**, kendi arayüzünüzle | `@kalem-editor/editor` | 29,3 kB |
| **Word benzeri** tam deneyim | `@kalem-editor/editor` + `@kalem-editor/ui` | 38,0 kB |

Çerçeve sarmalayıcıları bunların üstüne birkaç yüz bayt ekliyor:
`@kalem-editor/react` 907 B, `@kalem-editor/vue` 686 B, `@kalem-editor/wc` 1,99 kB.

```bash
# Word benzeri tam deneyim
npm i @kalem-editor/editor @kalem-editor/ui @kalem-editor/themes
```

## Beş satırda ilk editör

```ts
import { Editor } from '@kalem-editor/editor';
import { mountUi } from '@kalem-editor/ui';

import '@kalem-editor/themes/tokens.css';
import '@kalem-editor/themes/viewer.css';
import '@kalem-editor/themes/editor.css';
import '@kalem-editor/themes/ui.css';

const editor = new Editor(document.getElementById('app')!, {
  value: '# Merhaba\n\nYazmaya başlayın veya `/` ile komut çalıştırın.',
  lang: 'tr',
  label: 'Belge',
  onChange: (markdown) => console.log(markdown),
});

mountUi(editor);
```

Bu kadar. `mountUi` balon araç çubuğunu, sabit çubuğu, slash menüsünü,
blok tutamacını ve bağlantı balonunu kuruyor.

:::note[`lang` süs değil]
Tarayıcı yazım denetimi sözlüğünü, hecelemeyi ve tırnak biçimini bu
özniteliğe göre seçiyor. Türkçe bir belgeyi İngilizce sözlükle denetlemek
her kelimeyi kırmızı yapıyor. Kalem de arama ve büyük/küçük harf
katlamasında aynı değeri kullanıyor — ayrıntı [Markdown uyumu](/rehber/markdown-uyumu/)
sayfasında.
:::

## Temel kavramlar

### Değer her zaman Markdown metnidir

`editor.getValue()` size bir `string` döndürüyor, bir JSON ağacı değil.
Kalem'in çıktısı git'e commit edilebiliyor, başka araçlarda açılabiliyor,
bir dil modeline doğrudan verilebiliyor.

Dahası, dokunulmayan satır **byte düzeyinde** aynı kalıyor:

```ts
import { parse, serialize } from '@kalem-editor/core';

const md = '* yıldızla yazılmış liste\n';
serialize(parse(md)) === md; // true — `-` olarak geri gelmiyor
```

Bu, editörün kullanıcının yazım tercihlerini (liste işareti, ayraç, başlık
biçimi) modelde saklamasından geliyor. Ayrıntı: [Markdown uyumu](/rehber/markdown-uyumu/).

### Her blok kendi elemanı

Paragraf, başlık, liste öğesi — her biri kendi `contenteditable`
elemanında. Kullanıcı bir bloğu tutamacından sürükleyerek taşıyabiliyor;
`Ctrl+Shift+↑/↓` aynı işi klavyeyle yapıyor.

Bunun bedeli ve kazancı [Mimari](/mimari/) sayfasında.

### Arayüz ayrı bir paket

`@kalem-editor/editor` tek başına çalışıyor ama **hiçbir arayüz çizmiyor** —
klavyeyle tam işlevli. Word benzeri deneyim `mountUi` ile geliyor.
Kendi tasarım sistemi olan bir uygulama, arayüzü kendisi yazıp yalnızca
motoru kullanabiliyor.

## Kendi arayüzünüz

`mountUi` çağırmadan, editörün imperatif API'siyle:

```ts
const editor = new Editor(el, { value: '# Merhaba' });

document.getElementById('kalin')!.addEventListener('click', () => {
  editor.toggleMark('strong');
});

editor.on('selectionchange', () => {
  kalinDugmesi.setAttribute('aria-pressed', String(editor.isMarkActive('strong')));
});
```

:::tip
Düğmeye `mousedown` üzerinde `preventDefault()` çağırın; yoksa tıklama
seçimi düşürüyor ve biçim uygulanacak metin kalmıyor.
:::

## Sonraki adım

- [Viewer rehberi](/rehber/viewer/) — sadece göstermek istiyorsanız
- [Editör rehberi](/rehber/editor/) — bütün seçenekler, API ve kısayollar
- [Eklentiler](/rehber/eklentiler/) — kod vurgulama, bul-değiştir, otomatik kaydetme
- Çerçeveniz: [React](/frameworkler/react/) · [Vue](/frameworkler/vue/) ·
  [Svelte](/frameworkler/svelte/) · [Angular](/frameworkler/angular/) ·
  [Next.js](/frameworkler/nextjs/) · [Nuxt](/frameworkler/nuxt/) ·
  [CDN](/frameworkler/cdn/)
