---
title: Editör
description: Seçenekler, API, olaylar ve klavye kısayolları.
---

`@kalem/editor` **başsız** bir blok editör motoru: model, DOM eşlemesi,
seçim, klavye, geçmiş. Hiçbir arayüz çizmiyor — araç çubuğu, balon menü ve
slash menüsü [`@kalem/ui`](/rehber/temalar/) paketinde.

## Kurulum

```ts
import { Editor } from '@kalem/editor';

const editor = new Editor(document.getElementById('app')!, {
  value: '# Başlık\n\nParagraf.',
  lang: 'tr',
  label: 'Belge',
  onChange: (markdown, doc) => console.log(markdown, doc),
});
```

İlk argüman kapsayıcı eleman. Editör onun **içine** her blok için bir
`contenteditable` eleman çiziyor; kapsayıcının kendisi düzenlenebilir
değil.

## Seçenekler

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `value` | `string` | `""` | Başlangıç Markdown metni |
| `onChange` | `(value: string, doc: Root) => void` | — | İçerik her değiştiğinde |
| `onSelectionChange` | `(selection: EditorSelection) => void` | — | Seçim değiştiğinde (bloklar arası dâhil) |
| `readOnly` | `boolean` | `false` | İçerik görünür, düzenlenemez |
| `lang` | `string` | kapsayıcıdan miras | Belge dili — yazım denetimi ve locale davranışı |
| `label` | `string` | — | Erişilebilir ad (`aria-label`) |
| `classPrefix` | `string` | `"kalem-"` | CSS sınıf öneki |
| `inputRules` | `boolean` | `true` | `# ` yazınca başlık, `- ` yazınca liste |
| `parseMarkdownOnPaste` | `boolean` | `true` | Yapıştırılan düz metin Markdown'sa ayrıştırılır |
| `plugins` | `readonly Plugin[]` | yerleşikler | **Boş dizi vermek yerleşikleri kapatır** |

:::note[`onChange` ucuz değil]
Markdown her çağrıda baştan üretiliyor. Kanca **verilmemişse** serileştirme
hiç çalışmıyor; verilmişse her tuşta çalışıyor. Metne her tuşta ihtiyacınız
yoksa `change` olayına abone olmak yerine gerektiğinde `getValue()` çağırın.
:::

:::caution[`label` neden varsayılansız]
`role="textbox"` bir ad taşımak zorunda; adsız bir metin kutusu ekran
okuyucuda "düzenle, çok satırlı" diye duyuruluyor ve **neyi** düzenlediği
hiç söylenmiyor. Bu paket başsız olduğu için içinde hiçbir kullanıcı metni
yok ve buraya varsayılan bir dize yazılmıyor — yazılsaydı Türkçe bir
belgede İngilizce duyurulurdu. Üç seçenekten biri seçilmek zorunda:
`label` vermek, kök elemana kendiniz `aria-label`/`aria-labelledby`
yazmak, ya da `mountUi` kullanmak (sözlüğünden bir ad koyuyor).
:::

## API

### İçerik

```ts
editor.getValue();              // string — güncel Markdown
editor.getDocument();           // Root — değişmez AST
editor.setValue(markdown);      // belgeyi baştan yükler (geçmişi sıfırlar)
```

`setValue` "başka bir belge aç" demek: kimlikler yeniden dağıtılıyor, tüm
bloklar yeniden kuruluyor ve geçmiş sıfırlanıyor. Yazarken çağırmayın.

### Biçim

```ts
editor.toggleMark('strong');            // strong | emphasis | delete | inlineCode
editor.isMarkActive('emphasis');        // boolean
editor.setLink('https://ornek.com');    // seçili metni bağlantı yapar
editor.getActiveLink();                 // { url, title, from, to } | null
```

### Blok

```ts
editor.getBlockType();                              // { type: 'heading', depth: 2 } gibi
editor.setBlockType({ type: 'heading', depth: 2 });
editor.getBlockIds();                               // sıradaki blok kimlikleri
editor.getBlockElement(id);                         // HTMLElement | undefined
editor.selectBlocks(anchorId, focusId);
```

### Seçim ve imleç

```ts
editor.getSelection();   // { kind: 'text', blockId, collapsed } | { kind: 'block', … } | null
editor.getCaret();       // Caret | null
editor.getTextRange();   // { from, to } | null — blok içi karakter aralığı
editor.focus();
```

### Geçmiş

```ts
editor.undo();     // boolean — bir şey geri alındı mı
editor.redo();
editor.canUndo();
editor.canRedo();
```

### Durum ve yaşam döngüsü

```ts
editor.setReadOnly(true);
editor.isReadOnly();
editor.getElement();      // kök eleman
editor.destroy();
```

`destroy()` DOM içeriğini **bırakıyor**, silmiyor: sökülen bir editörün
yerinde boş bir kutu bırakmak kullanıcıya içeriğin kaybolduğunu
düşündürür. Düzenlenebilirlik kaldırılıyor, geriye salt okunur bir belge
kalıyor.

### Olaylar

```ts
const cikar = editor.on('change', (value, doc) => { … });
editor.on('selectionchange', (selection) => { … });
editor.on('readonlychange', (readOnly) => { … });

cikar(); // aboneliği bırakır
```

Üç olay var: `"change"`, `"selectionchange"`, `"readonlychange"`.
`on` bir **abonelikten çıkma fonksiyonu** döndürüyor.

### Eklentiler

```ts
editor.addPlugin(codeHighlightPlugin());
editor.removePlugin('kalem-code-highlight');
editor.plugins; // kayıtlı eklenti adları, kayıt sırasıyla
```

Ayrıntı: [Eklentiler](/rehber/eklentiler/).

## Klavye kısayolları

### Biçim

| Kısayol | İş |
|---|---|
| `Ctrl/Cmd + B` | Kalın |
| `Ctrl/Cmd + I` | İtalik |
| `Ctrl/Cmd + E` | Satır içi kod |
| `Ctrl/Cmd + Shift + X` | Üstü çizili |
| `Ctrl/Cmd + K` | Bağlantı (`@kalem/ui` ile) |

`Ctrl+U` **bilerek engelleniyor ve hiçbir şey yapmıyor**: Markdown'da altı
çizili yok, engellenmezse tarayıcı `<u>` üretiyor ve o da bir sonraki
okumada sessizce kayboluyor. Kullanıcının bastığı tuşun izsiz kaybolması,
hiç tepki vermemesinden kötü.

### Blok

| Kısayol | İş |
|---|---|
| `Ctrl/Cmd + Alt + 1…6` | Başlık (seviye) |
| `Ctrl/Cmd + Alt + 0` | Paragraf |
| `Ctrl/Cmd + Shift + 8` | Madde imli liste |
| `Ctrl/Cmd + Shift + 7` | Numaralı liste |
| `Tab` / `Shift + Tab` | Liste öğesini içeri/dışarı al |
| `Ctrl/Cmd + Shift + ↑ / ↓` | Bloğu taşı (`@kalem/ui` ile) |

Liste kısayolları Word ve GitHub ile aynı tuşlarda.

### Düzenleme

| Kısayol | İş |
|---|---|
| `Ctrl/Cmd + Z` | Geri al |
| `Ctrl/Cmd + Shift + Z` · `Ctrl + Y` | İleri al |
| `Ctrl/Cmd + Shift + V` | Biçimsiz yapıştır |
| `Enter` | Bloğu böl |
| `Backspace` (blok başında) | Önceki blokla birleştir |
| `Delete` (blok sonunda) | Sonraki blokla birleştir |

Eklentilerin getirdikleri: `Ctrl+F` bul, `Ctrl+H` değiştir,
`Ctrl+Shift+M` ham Markdown kaynağı.

## Giriş kuralları

Yazarken otomatik dönüşüm varsayılan olarak açık:

| Yazdığınız | Olan |
|---|---|
| `# ` … `###### ` | Başlık |
| `- ` · `* ` · `+ ` | Madde imli liste |
| `1. ` · `1) ` | Numaralı liste |
| `> ` | Alıntı |
| ` ``` ` | Kod bloğu |
| `---` | Yatay çizgi |
| `**kalın**` · `*italik*` · `` `kod` `` | Satır içi biçim |

Dönüşüm **ayrı bir geçmiş kaydı** olarak yazılıyor: tek bir `Ctrl+Z`
kuralı iptal edip metni olduğu gibi bırakıyor. "`# ` yazdım ama başlık
istemiyordum" durumunun tek makul cevabı bu.

Kapatmak için `inputRules: false`.

## Yapıştırma

Kalem üç kaynağı ayırt ediyor: Word/Google Docs HTML'i, düz Markdown metni
ve Kalem'in kendi panosu. Word'den yapıştırılan bir liste liste olarak,
kalın metin kalın olarak geliyor — `<span style="font-weight:700">`
çorbası değil.

Düz metin yalnızca **gerçekten Markdown'a benziyorsa** ayrıştırılıyor;
`parseMarkdownOnPaste: false` ile tümden kapatılıyor. `Ctrl+Shift+V` tek
seferlik biçimsiz yapıştırma yapıyor.

## Salt okunur

```ts
editor.setReadOnly(true);
```

İçerik görünür kalıyor, düzenlenebilirlik kalkıyor ve `readonlychange`
olayı yayılıyor — arayüz katmanı düğmelerini buna göre kapatıyor.
Sürekli yoklamak yerine haber vermek, `@kalem/ui`nin editörü sorgulamasını
gereksiz kılıyor.
