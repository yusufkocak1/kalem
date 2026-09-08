---
title: Vanilla / TypeScript
description: Framework olmadan, doğrudan DOM ile.
---

Kalem'in çekirdeği zaten vanilla'dır. Sarmalayıcılar yalnızca bir kolaylık
katmanıdır — hiçbiri zorunlu değildir.

## Kurulum

```bash
npm i @kalem/editor @kalem/ui
```

## Kullanım

```ts
import { Editor } from '@kalem/editor';
import { toolbar, slashMenu, dragHandle } from '@kalem/ui';
import '@kalem/themes/default.css';

const el = document.getElementById('app')!;

const editor = new Editor(el, {
  value: localStorage.getItem('taslak') ?? '# Yeni belge\n\n',
  plugins: [toolbar({ mode: 'bubble' }), slashMenu(), dragHandle()],
  onChange: (md) => localStorage.setItem('taslak', md),
});

// Sayfa kapanırken temizle
window.addEventListener('beforeunload', () => editor.destroy());
```

## Sadece görüntüleme

```ts
import { parse } from '@kalem/core';
import { renderToDOM } from '@kalem/viewer';

renderToDOM(parse(markdown), document.getElementById('out')!);
```

## Kendi arayüzünüzü yazmak

`@kalem/ui`'ı hiç kurmadan, `@kalem/editor`'ün komutlarını kendi butonlarınıza
bağlayabilirsiniz. Editör klavyeyle zaten tam işlevlidir.

```ts
const editor = new Editor(el);

document.getElementById('kalin')!.onclick = () =>
  editor.exec('toggleMark', { mark: 'strong' });

document.getElementById('baslik')!.onclick = () =>
  editor.exec('setBlockType', { type: 'heading', depth: 2 });

editor.on('selectionChange', (sel) => {
  document.getElementById('kalin')!
    .classList.toggle('aktif', sel.marks.includes('strong'));
});
```

Bu yolda bundle'ınıza ~35 kB eklenir, `@kalem/ui`'ın ~20 kB'ı gelmez.
