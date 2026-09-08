---
title: Editör
description: Seçenekler, API, olaylar ve kısayollar.
---

## Oluşturma

```ts
import { Editor } from '@kalem/editor';

const editor = new Editor(element, {
  value: '# Başlık',
  readOnly: false,
  autofocus: true,
  placeholder: 'Yazmaya başlayın veya / ile komut çalıştırın',
  plugins: [],
  onChange: (markdown, ast) => {},
  onSelectionChange: (selection) => {},
});
```

## Seçenekler

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `value` | `string` | `''` | Başlangıç Markdown metni |
| `readOnly` | `boolean` | `false` | Düzenlemeyi kapatır |
| `autofocus` | `boolean` | `false` | İlk bloğa odaklanır |
| `placeholder` | `string` | — | Boş dokümanda gösterilir |
| `plugins` | `Plugin[]` | `[]` | Eklenti listesi |
| `markdown` | `SerializeOptions` | — | `bulletMarker`, `emphasisMarker`, `codeFence` |
| `allowedProtocols` | `string[]` | http, https, mailto, tel | URL beyaz listesi |
| `onChange` | `(md, ast) => void` | — | Her değişiklikte |

## API

```ts
editor.getValue();                 // string — Markdown
editor.getAST();                   // Root — mdast uyumlu ağaç
editor.setValue(markdown);         // içeriği değiştir (geçmişe yazılır)
editor.focus();
editor.exec('toggleMark', { mark: 'strong' });
editor.use(plugin);                // çalışma anında eklenti ekle
editor.on('change', handler);
editor.destroy();                  // dinleyicileri ve DOM'u temizler
```

:::caution[Bellek sızıntısı]
Tek sayfa uygulamalarda bileşen kaldırılırken `editor.destroy()` çağırın.
`@kalem/react` ve `@kalem/vue` sarmalayıcıları bunu sizin için yapar.
:::

## Klavye kısayolları

| Kısayol | İşlem |
|---|---|
| `Ctrl/Cmd + B` · `I` | Kalın · italik |
| `Ctrl/Cmd + K` | Bağlantı |
| `Ctrl/Cmd + Z` · `Y` | Geri al · yinele |
| `Ctrl/Cmd + Alt + 1…6` | Başlık seviyesi |
| `Ctrl/Cmd + Shift + ↑/↓` | Bloğu taşı |
| `/` (boş blokta) | Komut menüsü |
| `Tab` · `Shift + Tab` | Liste girintisi |
| `Ctrl/Cmd + Shift + V` | Biçimsiz yapıştır |

`Ctrl+Shift+↑/↓`, sürükle-bırakın klavye alternatifidir. Sürükle-bırak hiçbir
zaman tek yol değildir — erişilebilirlik için bu bir gerekliliktir.

## Giriş kuralları

Markdown bilen kullanıcılar için yazarken dönüşüm çalışır:

| Yazdığınız | Oluşan |
|---|---|
| `# ` | Başlık 1 |
| `- ` veya `* ` | Madde listesi |
| `1. ` | Numaralı liste |
| `> ` | Alıntı |
| ` ``` ` | Kod bloğu |
| `[] ` | Görev listesi |
| `---` | Ayırıcı |
| `**metin**` | Kalın |

Dönüşümün hemen ardından bir kez `Ctrl+Z` dönüşümü iptal eder ama yazdığınız
metni korur — Word'ün otomatik biçimlendirmesindeki davranışın aynısı.

## Yapıştırma

Word, Google Docs, Excel ve genel web HTML'i otomatik normalize edilir:
`mso-*` stilleri, boş `<span>` yığınları ve listeyi taklit eden paragraflar
temizlenir; `font-weight: bold` gibi satır içi stillerden biçim çıkarımı yapılır.

Düz metin yapıştırıldığında Kalem içeriğin Markdown olup olmadığını sezer ve
size sorar.
