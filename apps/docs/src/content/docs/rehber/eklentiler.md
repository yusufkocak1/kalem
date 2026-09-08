---
title: Eklentiler
description: Hazır eklentiler ve kendi eklentinizi yazma.
---

Kalem'in çekirdek özellikleri de aynı halka açık eklenti API'siyle yazılmıştır.
Bu bir tercih değil, bir denetim: API yetersiz kalsaydı kendi özelliklerimizi
yazamazdık.

## Hazır eklentiler

| Paket | Ne yapar |
|---|---|
| `@kalem/ui` | Balon araç çubuğu, slash menü, drag handle, üst araç çubuğu |
| `@kalem/plugin-image-upload` | Sürükle-bırak görsel, yükleme kancası, yer tutucu |
| `@kalem/plugin-code-highlight` | Kod bloğu vurgulama (tembel yüklenir) |
| `@kalem/plugin-find-replace` | Ctrl+F / Ctrl+H |
| `@kalem/plugin-outline` | İçindekiler paneli |
| `@kalem/plugin-word-count` | Kelime · karakter · okuma süresi |
| `@kalem/plugin-source-mode` | WYSIWYG ↔ ham Markdown geçişi |
| `@kalem/plugin-autosave` | Debounce'lu kaydetme, localStorage kurtarma |
| `@kalem/plugin-table` | Tablo düzenleme — *v1.1* |

:::note[Tablo hakkında]
v1'de tablo **düzenleme arayüzü** yoktur, ancak ayrıştırıcı ve serileştirici
tabloları **kayıpsız korur**. Tablo içeren bir dosyayı Kalem'de açıp kaydettiğinizde
tablo bozulmaz.
:::

## Kendi eklentiniz

```ts
import type { Plugin } from '@kalem/editor';

export function highlightMark(): Plugin {
  return {
    name: 'highlight',
    nodes: [{ type: 'highlight', inline: true, tag: 'mark' }],
    commands: {
      toggleHighlight: (state) => state.toggleMark('highlight'),
    },
    keymap: { 'Mod-Shift-h': 'toggleHighlight' },
    inputRules: [{ match: /==([^=]+)==$/, node: 'highlight' }],
    toolbar: [{ command: 'toggleHighlight', label: 'Vurgula', icon: 'H' }],
    parse: (token) => ({ type: 'highlight', children: token.children }),
    serialize: (node, ctx) => `==${ctx.serializeChildren(node)}==`,
  };
}
```

Kullanımı:

```ts
new Editor(el, { plugins: [highlightMark()] });
```

## Eklenti sözleşmesi

| Alan | Ne için |
|---|---|
| `nodes` | Yeni blok veya satır içi düğüm tipi |
| `commands` | Çağrılabilir işlemler (`editor.exec`) |
| `keymap` | Kısayol → komut eşlemesi (`Mod` = Ctrl/Cmd) |
| `inputRules` | Yazarken dönüşüm |
| `toolbar` | `@kalem/ui` araç çubuğuna katkı |
| `parse` / `serialize` | Markdown ↔ AST dönüşümü |
| `view` | Özel DOM davranışı (ör. Mermaid çizimi) |
| `onDestroy` | Temizlik |

Bir eklenti `parse` **ve** `serialize` verirse, ürettiği sözdizimi gidiş-dönüş
testlerine dahil edilir.

## Tembel yükleme

Ağır eklentileri dinamik `import()` ile yükleyin — ana bundle'a sıfır byte eklenir.

```ts
const editor = new Editor(el);

document.getElementById('kod')!.addEventListener('click', async () => {
  const { codeHighlight } = await import('@kalem/plugin-code-highlight');
  editor.use(codeHighlight({ languages: ['ts', 'python'] }));
});
```
