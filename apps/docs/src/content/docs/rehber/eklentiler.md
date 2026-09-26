---
title: Eklentiler
description: Yedi resmî eklenti ve kendi eklentinizi yazmak.
---

Eklentiler `@kalem/editor`e takılan ayrı paketler. Hiçbiri varsayılan
olarak gelmiyor — ödemediğiniz şeyi indirmiyorsunuz.

```ts
import { codeHighlightPlugin } from '@kalem/plugin-code-highlight';

const editor = new Editor(el, {
  value: md,
  plugins: [codeHighlightPlugin()],
});

// ya da sonradan
editor.addPlugin(codeHighlightPlugin());
editor.removePlugin('code-highlight');
```

:::note[Yerleşikler]
`plugins` verilmezse editör iki yerleşik eklenti kuruyor: giriş kuralları
ve görev listesi. **Boş dizi vermek onları kapatıyor** — çekirdek
özelliklerin gerçekten eklenti olarak çıkarılabildiğinin kanıtı.

`plugins` verdiğinizde yerleşikler gelmiyor; ikisini birden istiyorsanız
`defaultPlugins()` çağırıp kendi listenizin başına ekleyin.
:::

## Resmî eklentiler

| Paket | Ne yapıyor | Boyut (gzip) |
|---|---|---|
| `@kalem/plugin-code-highlight` | Kod bloğu vurgulama, 8 dil | 3,7 kB |
| `@kalem/plugin-find-replace` | Ctrl+F / Ctrl+H | 4,3 kB |
| `@kalem/plugin-image-upload` | Sürükle-bırak / yapıştır görsel yükleme | 2,9 kB |
| `@kalem/plugin-outline` | İçindekiler paneli | 1,9 kB |
| `@kalem/plugin-word-count` | Kelime sayacı ve okuma süresi | 1,4 kB |
| `@kalem/plugin-source-mode` | Ham Markdown kaynağı (Ctrl+Shift+M) | 1,0 kB |
| `@kalem/plugin-autosave` | Gecikmeli kaydetme + durum göstergesi | 652 B |

Her birinin kendi CSS dosyası var: `@kalem/themes/plugin-code.css`,
`plugin-find.css`, `plugin-image.css`, `plugin-outline.css`,
`plugin-word-count.css`, `plugin-source.css`, `plugin-autosave.css`.

### Kod vurgulama

```ts
import { codeHighlightPlugin } from '@kalem/plugin-code-highlight';

codeHighlightPlugin({
  maxLength: 20_000,
  onError: (hata, dil) => console.warn(dil, hata),
});
```

Yerleşik diller: `javascript`, `typescript`, `json`, `html`, `css`,
`markdown`, `python`, `shell`, `sql`. Her biri **ayrı bir parça** ve
yalnızca belgede o dilde bir kod bloğu varken `import()` ile yükleniyor —
tek dil paketi 599 B. Belgede kod yoksa **sıfır bayt** indiriliyor ve
bunu bir tarayıcı testi (ağ isteği sayarak) doğruluyor.

Eklenti modele hiç dokunmuyor: vurgulama yalnızca DOM'da yaşıyor, yani
Markdown çıktısı değişmiyor.

Kendi vurgulayıcınızı da verebilirsiniz — Prism ve Shiki için hazır
dönüştürücüler var:

```ts
import { codeHighlightPlugin, prismTokens } from '@kalem/plugin-code-highlight';
import Prism from 'prismjs';

codeHighlightPlugin({
  highlight: (kod, dil) => {
    const gramer = Prism.languages[dil];
    return gramer ? prismTokens(Prism.tokenize(kod, gramer)) : null;
  },
});
```

### Bul ve değiştir

```ts
import { findReplacePlugin } from '@kalem/plugin-find-replace';

const arama = findReplacePlugin({ limit: 5000 });
arama.open('replace');  // kendi düğmenizden
```

Kasa katlaması **belgenin diline** göre: `lang="tr"` bir belgede `ışık`
araması `IŞIK`ı buluyor, `İŞİK`i bulmuyor. Aksanlar katlanmıyor — `şık`
araması `sik` yazmıyor.

Tablo hücreleri de aranıyor ve değiştiriliyor; değişen satır dışındaki
satırlar ve sütun hizası olduğu gibi kalıyor. Satır içi görseller aramada
tek bir yer tutucu karakter sayılıyor: `a![](x.png)b` içinde `ab` bulunmuyor,
çünkü ekranda aralarında bir görsel var.

### Görsel yükleme

```ts
import { imageUploadPlugin } from '@kalem/plugin-image-upload';

imageUploadPlugin({
  maxSize: 5 * 1024 * 1024,
  async upload({ file, onProgress, signal }) {
    const yanit = await fetch('/api/yukle', { method: 'POST', body: file, signal });
    onProgress(1);
    return (await yanit.json()).url;
  },
  onError: (hata) => alert(hata.message),
});
```

Eklentinin ağ hakkında bildiği tek şey `upload` kancası: hangi servis,
hangi kimlik doğrulama, hangi yeniden deneme — hepsi uygulamanın.
Tam tarif: [Görsel yükleme](/tarifler/gorsel-yukleme/).

### İçindekiler

```ts
import { outlinePlugin } from '@kalem/plugin-outline';

outlinePlugin({
  container: document.getElementById('icindekiler'),
  scrollOffset: 80,
  onActiveChange: (item, index) => { … },
});
```

`container` verilmezse arayüz çizilmiyor; başlık listesi yine `items()`
ve `activeIndex()` ile okunabiliyor. Kütüphane ekranın bir köşesini kendi
başına sahiplenmiyor — nereye ait olduğunu uygulama biliyor.

### Kelime sayacı

```ts
import { wordCountPlugin } from '@kalem/plugin-word-count';

wordCountPlugin({
  container: document.getElementById('durum'),
  onChange: ({ words, characters, minutes }) => { … },
});
```

Sayım `Intl.Segmenter` ile, yani belgenin diline göre. Markdown işaretleri
sayılmıyor: `**kalın**` bir kelime, yedi değil.

### Kaynak kipi

```ts
import { sourceModePlugin } from '@kalem/plugin-source-mode';

const kaynak = sourceModePlugin({
  shortcut: true,                       // Ctrl/Cmd+Shift+M
  onModeChange: (kaynakta) => { … },
});
kaynak.toggle();
```

Kaynak tarafı sıradan bir `<textarea>`. Çıkışta metin belgeye yazılıyor ve
gidiş-dönüşün kayıpsızlığı testle sabit.

### Otomatik kaydetme

```ts
import { autosavePlugin, createIndicator, trAutosaveLabels } from '@kalem/plugin-autosave';

const gosterge = createIndicator(document.getElementById('durum')!, {
  prefix: 'kalem-',
  labels: trAutosaveLabels,
});

autosavePlugin({
  delay: 1500,
  storageKey: `kalem:taslak:${belgeId}`,
  save: async (markdown, signal) => {
    await fetch('/api/kaydet', { method: 'POST', body: markdown, signal });
  },
  onStateChange: (durum) => gosterge.render(durum),
});
```

Durumlar: `idle`, `dirty`, `saving`, `saved`, `error`. `save` kancası hata
fırlatırsa durum `error` oluyor — sessizce yutulmuyor.

`storageKey` **belgeye özgü** olmalı. Verilmezse yerel kurtarma kapalı:
rastgele bir anahtar üretmek, başka bir belgenin taslağını bu belgeye
getirme riski taşıyor.

Tam tarif: [Otomatik kaydetme](/tarifler/otomatik-kaydet/).

## Kendi eklentinizi yazmak

Bir eklenti dört alanlı bir nesne:

```ts
import type { Plugin } from '@kalem/editor';

export function benimEklentim(): Plugin {
  return {
    name: 'benim-eklentim',

    setup(ctx) {
      const cikar = ctx.on('change', (value) => console.log(value.length));
      return () => cikar();           // söküm temizleyicisi
    },

    keymap(event, ctx) {
      if (!event.ctrlKey || event.key !== 'j') return false;
      // …
      return true;                     // olay tüketildi
    },

    inputRules: [
      (doc, caret) => null,            // dönüşüm ürettiyse EditResult
    ],
  };
}
```

`PluginContext` dar ve bilerek öyle:

| Üye | Ne veriyor |
|---|---|
| `getDocument()` | Güncel belge (değişmez `Root`) |
| `getCaret()` | İmlecin model konumu; seçim tek taşıyıcıda değilse `null` |
| `applyEdit(result)` | Düzenleme uygular, geçmişe de yazar |
| `element` | Editörün kök elemanı |
| `isReadOnly()` | Salt okunur mod |
| `on(event, handler)` | `Editor.on` ile aynı; abonelikten çıkma döndürüyor |

### Çakışma kuralı: kayıt sırası

Eklentiler çekirdekten **önce** tuşu görüyor ve aralarında önce kaydedilen
kazanıyor. Tek kural bu; öncelik sayısı, faz sistemi ya da "yüksek
öncelikli eklenti" kavramı yok.

### Render kancası neden yok

Eklentiler DOM'u doğrudan süslüyor (`element` üzerinden) ve modele
`applyEdit` ile dokunuyor; arada bir "her düğüm için çağrılan" kanca
bulunmuyor. Böyle bir kanca, editörün imleç koruyan yama mantığını
eklentilere açardı ve her eklenti kendi imleç hatasını üretirdi.

Yedi eklentinin hiçbirinde ihtiyaç duyulmadı. Pratikte gereken şey
"değişiklik başına tek çağrı"ydı ve onu `ctx.on('change', …)` veriyor.
