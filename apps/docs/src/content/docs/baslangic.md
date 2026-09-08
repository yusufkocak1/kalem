---
title: Başlangıç
description: Kalem'i beş satırda projenize ekleyin.
---

:::caution
Planlanan v1.0 API'si. Paketler henüz npm'de değil.
:::

## Kurulum

İhtiyacınız kadarını kurun.

```bash
# Sadece görüntüleme (salt okunur)
npm i @kalem/viewer

# Düzenleme, kendi arayüzünüzle
npm i @kalem/editor

# Word benzeri tam deneyim
npm i @kalem/editor @kalem/ui
```

## Beş satırda ilk editör

```ts
import { Editor } from '@kalem/editor';
import { toolbar, slashMenu, dragHandle } from '@kalem/ui';
import '@kalem/themes/default.css';

const editor = new Editor(document.getElementById('app')!, {
  value: '# Merhaba\n\nYazmaya başlayın veya `/` ile komut çalıştırın.',
  plugins: [toolbar(), slashMenu(), dragHandle()],
  onChange: (markdown) => console.log(markdown),
});
```

## Temel kavramlar

### Değer her zaman Markdown metnidir

`editor.getValue()` size bir `string` döndürür, bir JSON ağacı değil. Bu yüzden
Kalem'in çıktısı git'e commit edilebilir, başka araçlarda açılabilir, bir dil
modeline doğrudan verilebilir.

### Blok-tabanlı düzenleme

Her paragraf, başlık ve liste öğesi kendi DOM elemanıdır. Kullanıcı bir bloğu
tutamacından sürükleyerek taşıyabilir; `Ctrl+Shift+↑/↓` aynı işi klavyeyle yapar.

### Eklentiler isteğe bağlıdır

`@kalem/editor` tek başına çalışır ama görsel arayüzü yoktur — klavyeyle tam
işlevlidir. Word benzeri deneyim için `@kalem/ui` eklentilerini takarsınız.
Böylece kendi arayüzünü yazmak isteyen geliştirici, kullanmayacağı UI kodunu
indirmez.

## Sonraki adım

- [Viewer rehberi](/rehber/viewer/) — sadece görüntülemek istiyorsanız
- [Editör rehberi](/rehber/editor/) — seçenekler, API, kısayollar
- [React](/frameworkler/react/) · [Vue](/frameworkler/vue/) · [CDN](/frameworkler/cdn/)
