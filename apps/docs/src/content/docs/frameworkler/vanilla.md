---
title: Vanilla / TypeScript
description: Çerçevesiz kurulum — kütüphanenin doğal hâli.
---

Kalem'in çekirdeği hiçbir çerçeve bilmiyor. Aşağıdaki kod `@kalem/editor`in
tamamı; sarmalayıcılar bunun üstüne yalnızca yaşam döngüsü ekliyor.

```ts
import { Editor } from '@kalem/editor';
import { mountUi } from '@kalem/ui';

import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
import '@kalem/themes/editor.css';
import '@kalem/themes/ui.css';

const el = document.getElementById('app')!;

const editor = new Editor(el, {
  value: '# Merhaba\n\nYazmaya başlayın.',
  lang: 'tr',
  label: 'Belge',
  onChange: (markdown) => localStorage.setItem('taslak', markdown),
});

const ui = mountUi(editor, { toolbar: 'both' });
```

Sökerken **önce arayüz**:

```ts
ui.destroy();
editor.destroy();
```

Sıra önemli: `ui.destroy()` editöre kaydettiği kısayol eklentisini
kaldırıyor, editör yıkıldıktan sonra çağrılsaydı olmayan bir kayda
dokunurdu.

## Kendi araç çubuğunuz

`mountUi` çağırmadan, imperatif API ile:

```ts
const kalin = document.getElementById('kalin')!;

// `mousedown` engelleniyor: tıklama seçimi düşürürse biçim uygulanacak
// metin kalmıyor.
kalin.addEventListener('mousedown', (e) => e.preventDefault());
kalin.addEventListener('click', () => editor.toggleMark('strong'));

editor.on('selectionchange', () => {
  kalin.setAttribute('aria-pressed', String(editor.isMarkActive('strong')));
});
```

Biçim uygulandığında seçim aynı kaldığı için `selectionchange`
tetiklenmiyor; düğme durumunu `change` olayında da tazeleyin.

## Salt okunur görüntüleme

Düzenleme ihtimali yoksa editörü hiç kurmayın:

```ts
import { parse } from '@kalem/core';
import { renderToDOM } from '@kalem/viewer';

renderToDOM(parse(markdown), document.getElementById('app')!);
```

2,7 kB, düzenleme kodu yok. Ayrıntı: [Viewer](/rehber/viewer/).

## Modül sistemi

Paketler hem ESM hem CJS yayımlıyor ve `exports` haritaları
`are-the-types-wrong` ile doğrulanıyor.

```js
// ESM
import { Editor } from '@kalem/editor';

// CJS
const { Editor } = require('@kalem/editor');
```

Alt girişler ayrı: `@kalem/core/commands` (editör komutları) ve
`@kalem/core/html` (yapıştırma dönüştürücüsü). Yalnızca Markdown işleyen
bir betik onların boyutunu ödemiyor.

## Derleme adımı olmadan

Paketleyici kullanmıyorsanız [CDN sayfasına](/frameworkler/cdn/) bakın:
tek bir `<script>` etiketiyle çalışan, kendi kendine yeten bir derleme var.
