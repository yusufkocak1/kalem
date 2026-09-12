---
title: Temalar ve arayüz
description: Renk sözlüğü, koyu tema ve mountUi seçenekleri.
---

Kalem'in görünümü iki parçadan geliyor: **CSS dosyaları** (`@kalem/themes`)
ve **arayüz bileşenleri** (`@kalem/ui`). İkisi bağımsız — kendi araç
çubuğunuzu yazıp temayı kullanabilir ya da tersini yapabilirsiniz.

## CSS katmanları

Her katman ayrı bir dosya; yalnızca kullandığınızı yükleyin.

| Dosya | Ne için | Boyut (gzip) |
|---|---|---|
| `tokens.css` | Renk, tipografi ve ölçü sözlüğü — **hepsinin temeli** | 482 B |
| `viewer.css` | Belge tipografisi (başlık, liste, kod, tablo) | 869 B |
| `editor.css` | Düzenleme katmanı (odak halkası, blok seçimi) | 357 B |
| `ui.css` | Araç çubuğu, menü, tutamaç, popover | 1,6 kB |
| `dark.css` | "Sayfanın tamamı koyu" senaryosu (aşağıya bakın) | 333 B |
| `minimal.css` | Yalın tema — gölge ve yuvarlatma yok | 221 B |
| `plugin-*.css` | Eklenti başına stil | 210–665 B |

```ts
import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
import '@kalem/themes/editor.css';
import '@kalem/themes/ui.css';
```

Salt okunur bir sayfa yalnızca ilk ikisini yüklüyor: kullanıcıya
kullanmayacağı düzenleme stillerini indirtmenin anlamı yok.

## Marka rengini değiştirmek

Sözlük **sıfır özgüllükte** (`:where()` içinde) yazıldı. Yani kendi
kuralınız `!important` ya da uzun seçici zinciri olmadan kazanıyor:

```css
.kalem-theme {
  --kalem-accent: #7c3aed;
  --kalem-accent-fg: #ffffff;
}
```

Tek blok hem belgeyi hem araç çubuğunu hem menüleri çeviriyor. Önceden her
katmanın kendi sözlüğü vardı (`--kalem-accent`, `--kalem-ui-accent`) ve
biri unutulduğunda araç çubuğu belgeden farklı renkte kalıyordu.

### Sözlük neden `:root`ta değil

Bir Markdown kütüphanesinin, gömüldüğü uygulamanın düğmelerinin rengini
değiştirmesi kabul edilemez. Değişkenler yalnızca Kalem'in kendi
yüzeylerinde tanımlı: `.kalem-theme`, `.kalem-doc`, `.kalem-editor` ve
yüzen parçalar.

:::caution[Uygulamanızın kabuğu bu değişkenleri okuyamaz]
`--kalem-*` değerlerini kendi düğmeleriniz için kullanmaya çalışırsanız
kural **geçersiz** oluyor ve stil sessizce kayboluyor. Uygulamanın kendi
paleti olmalı. Bu tam olarak
[Kalem Notlar](https://github.com/kalem-editor/kalem/tree/main/apps/notlar)
yazılırken yaşandı.
:::

## Koyu tema

Üç durum var ve üçü de karşılanıyor:

```css
/* 1. Kullanıcı seçim yapmadı → sistem tercihi */
@media (prefers-color-scheme: dark) { … }

/* 2. Açıkça koyu seçti */
[data-theme="dark"] … { … }

/* 3. Açıkça açık seçti → sistem koyu olsa bile açık */
[data-theme="light"] … { … }
```

Uygulamanız yalnızca `<html>` üzerindeki özniteliği değiştiriyor:

```ts
document.documentElement.dataset.theme = 'dark';
```

Öznitelik **atada** olabiliyor; editörün kendisinde olması gerekmiyor.

:::note[`dark.css` bunun için değil]
O dosya üçüncü bir durum için: **sayfanın tamamı koyu ve kullanıcıya seçim
sunulmuyor**. Ayrı dosya olmasının sebebi `[data-theme]` yazamayan gömme
senaryoları — bir CMS bloğuna kütüphaneyi koyan kişi kök elemana öznitelik
ekleyemiyor olabilir ama hangi CSS'in yükleneceğine karar verebiliyor.

Koşulsuz yüklerseniz tema düğmeniz çalışmaz: editör `[data-theme]` ne
olursa olsun koyu kalır. Seçim sunuyorsanız `tokens.css` zaten yetiyor.
:::

## `mountUi`

Word deneyiminin tamamı tek çağrıda:

```ts
import { mountUi } from '@kalem/ui';

const ui = mountUi(editor, { toolbar: 'both' });
// …
ui.destroy();
```

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `toolbar` | `"bubble" \| "fixed" \| "both" \| false` | `"bubble"` | Hangi araç çubuğu |
| `toolbarGroups` | `readonly ToolbarGroup[]` | hepsi | Sabit çubuktaki grup sırası |
| `slashMenu` | `boolean` | `true` | `/` menüsü |
| `slashItems` | `readonly SlashItem[]` | `[]` | Menüye eklenen öğeler |
| `blockHandle` | `boolean` | `true` | Blok tutamacı ve sürükle-bırak |
| `linkPopover` | `boolean` | `true` | Ctrl+K bağlantı akışı |
| `placeholder` | `boolean` | `true` | Boş belgede ipucu metni |
| `labels` | `UiLabels` | belgenin diline göre | Arayüz metinleri |
| `locale` | `string` | belgenin `lang`i | Arama karşılaştırma dili |
| `classPrefix` | `string` | `"kalem-"` | Editörle aynı olmalı |

`mountUi` bir `Ui` nesnesi döndürüyor: `bubbleToolbar`, `fixedToolbar`,
`slashMenu`, `blockHandle`, `blockMenu`, `linkPopover`, `liveRegion`,
`labels` ve `destroy()`.

### Hangi araç çubuğu?

- **`"bubble"`** — seçim yapınca beliren balon. Kısayolları bilmeyen
  kullanıcı için biçimlendirmenin görünür yolu; kimse Ctrl+B'yi
  kendiliğinden keşfetmiyor.
- **`"fixed"`** — editörün üstünde duran sabit çubuk. Word'e alışkın
  kullanıcı "burada neler var"ı seçim yapmadan görüyor.
- **`"both"`** — biri keşif, öteki erişim için.
- **`false`** — hiçbiri; kendi arayüzünüzü yazıyorsunuz.

:::tip[Kip bir çalışma zamanı anahtarı değil]
`mountUi` tek seferlik bir montaj. Araç çubuğunu değiştirmek için
`ui.destroy()` çağırıp yeniden kurun.
:::

### Arayüz metinleri

Sözlük belgenin `lang`ine göre seçiliyor (`tr` → Türkçe, aksi hâlde
İngilizce). Kendi sözlüğünüzü verebilirsiniz:

```ts
import { mountUi, trLabels } from '@kalem/ui';

mountUi(editor, {
  labels: { ...trLabels, editor: 'Ürün açıklaması' },
});
```

## Yalın tema

`minimal.css` gölgeyi ve yuvarlatmayı kaldırıp vurgu rengini metnin
kendisine çekiyor — kütüphanenin "kendi görünüşünü" tamamen geri aldığı
yer. Kendi tasarım sistemi olan uygulamalar için başlangıç noktası.

```ts
import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
import '@kalem/themes/editor.css';
import '@kalem/themes/ui.css';
import '@kalem/themes/minimal.css'; // en sonda
```
