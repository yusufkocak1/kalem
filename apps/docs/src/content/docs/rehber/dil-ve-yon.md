---
title: Dil ve yön
description: Belge dili nereden geliyor, arayüz nasıl çevriliyor, sağdan sola yazı ve Türkçe kasa kuralları.
---

Kalem'de dile bağlı iki ayrı iş var ve ikincisi genelde unutulur:

1. **Çeviri** — arayüzün hangi dilde konuştuğu.
2. **Yerel ayara duyarlı davranış** — büyük/küçük harf, arama, sayı biçimi.
   Bunlar yanlış olunca hiçbir şey patlamıyor; sadece yanlış çalışıyor.
   İngilizce'de test edilip geçen bir `toLowerCase()` Türkçe'de "IŞIK"
   aramasını "ışık"la eşleştiremez.

İkisi de aynı yerden, **belgenin dilinden** besleniyor.

## Belge dili nereden geliyor

```ts
import { Editor } from '@kalem/editor';

const editor = new Editor(element, { lang: 'tr' });
editor.getLang(); // "tr"
```

`lang` seçeneği elemanın `lang` özniteliğine yazılıyor. Verilmezse sırayla:

| Sıra | Kaynak | Ne zaman işe yarıyor |
| --- | --- | --- |
| 1 | Elemanın ya da en yakın atasının `lang`i | Sayfanın bir bölümü farklı dildeyse |
| 2 | `<html lang>` | Eleman henüz belgeye bağlanmadıysa |
| 3 | `navigator.language` | Sayfa dil beyan etmiyorsa — kullanıcının tarayıcısı |
| 4 | `"en"` | Hiçbiri yoksa |

Arayüz, özel eleman ve tüm eklentiler dili **buradan** okuyor; kendi
başına karar veren parça yok. `lang=""` HTML'de "dil bilinmiyor" demek
ve atlanıyor.

:::note[Dil montaj anında okunuyor]
Arayüz ve eklentiler kurulurken dili bir kez okuyor. Dili değiştirdikten
sonra arayüzü yeniden kurun — araç çubuğu kipiyle aynı model:

```ts
import { mountUi } from '@kalem/ui';

editor.getElement().lang = 'en';
ui.destroy();
ui = mountUi(editor);
```
:::

## Arayüz metinleri

Arayüzün gösterdiği **her** metin bir sözlükten geliyor: araç çubuğu
ipuçları, slash menü etiketleri, menüler, ekran okuyucu duyuruları, hata
mesajları. Hiçbir bileşen kendi içinde dize taşımıyor.

Türkçe ve İngilizce hazır. Dil `tr` ile başlıyorsa (`tr`, `tr-TR`,
`tr-CY`) Türkçe, aksi hâlde İngilizce seçiliyor.

Her paketin kendi sözlüğü var ve hepsi aynı biçimde dışa aktarılıyor:

| Paket | Tip | İngilizce | Türkçe |
| --- | --- | --- | --- |
| `@kalem/ui` | `UiLabels` | `enLabels` | `trLabels` |
| `@kalem/wc` | `WcLabels` | `enWcLabels` | `trWcLabels` |
| `@kalem/plugin-find-replace` | `FindLabels` | `enFindLabels` | `trFindLabels` |
| `@kalem/plugin-outline` | `OutlineLabels` | `enOutlineLabels` | `trOutlineLabels` |
| `@kalem/plugin-word-count` | `WordCountLabels` | `enWordCountLabels` | `trWordCountLabels` |
| `@kalem/plugin-source-mode` | `SourceLabels` | `enSourceLabels` | `trSourceLabels` |
| `@kalem/plugin-image-upload` | `ImageLabels` | `enImageLabels` | `trImageLabels` |
| `@kalem/plugin-autosave` | `AutosaveLabels` | `enAutosaveLabels` | `trAutosaveLabels` |

### Tek bir metni değiştirmek

```ts
import { mountUi, trLabels } from '@kalem/ui';

mountUi(editor, {
  labels: { ...trLabels, editor: 'Ürün açıklaması' },
});
```

### Başka bir dil eklemek

Sözlük düz bir nesne; tipi derleyicinin eksik anahtarı göstermesini
sağlıyor. Almanca bir arayüz:

```ts
import { mountUi, enLabels, type UiLabels } from '@kalem/ui';
import { wordCountPlugin, type WordCountLabels } from '@kalem/plugin-word-count';

const deLabels: UiLabels = {
  ...enLabels,          // çevrilmemiş anahtarlar İngilizce kalsın
  editor: 'Dokument',
  bold: 'Fett',
  italic: 'Kursiv',
  // …
};

const zahl = new Intl.NumberFormat('de');
const deZaehler: WordCountLabels = {
  title: 'Dokumentstatistik',
  words: (n) => `${zahl.format(n)} ${n === 1 ? 'Wort' : 'Wörter'}`,
  characters: (n) => `${zahl.format(n)} Zeichen`,
  minutes: (n) => `${zahl.format(n)} Min. Lesezeit`,
};

mountUi(editor, { labels: deLabels });
editor.addPlugin(wordCountPlugin({ container, labels: deZaehler }));
```

Sayı alan metinler fonksiyon, çünkü **çoğul kuralı dile bağlı**:
İngilizce'de "1 word / 2 words", Türkçe'de ikisi de "kelime", Almanca'da
"Wort / Wörter".

### Eklentinizin kendi metinleri

Bir eklenti yazıyorsanız aynı deseni izleyin: kendi sözlük tipiniz, iki
hazır sözlük ve `labels` seçeneği. Dili kendiniz çözmeyin, bağlamdan
alın — böylece arayüzle her zaman aynı dili konuşursunuz:

```ts
import type { Plugin } from '@kalem/editor';

export function myPlugin(options: { labels?: MyLabels } = {}): Plugin {
  return {
    name: 'my-plugin',
    setup(context) {
      const labels = options.labels ?? labelsFor(context.getLang());
      // …
    },
  };
}
```

## Sayılar

Kelime sayacı sayıları belgenin dilinde biçimliyor:

| Dil | Çıktı |
| --- | --- |
| Türkçe | 12.345 kelime |
| İngilizce | 12,345 words |

Binlik ayırıcı iki dilde **ters** — yanlış olanı başka bir sayı gibi
okunuyor. İngiliz okur "12.345"i on iki virgül üç dört beş sanar.

## Türkçe büyük/küçük harf

Türkçe'de `i`'nin büyüğü `I` değil `İ`, `I`'nın küçüğü `i` değil `ı`.
Sıradan `toLowerCase()` bunu bilmiyor ve **sessizce** yanlış çalışıyor.
Kalem'in kodunda çıplak `toLowerCase()` yazmak derlemeyi durduruyor;
locale'siz `Intl.NumberFormat()` ve argümansız `toLocaleString()` de.

İki arama bu kuralı **bilerek farklı** uyguluyor:

| | Slash menü araması | Bul-değiştir |
| --- | --- | --- |
| `IŞIK` ile `ışık` | eşleşiyor | eşleşiyor |
| `İYİ` ile `iyi` | eşleşiyor | eşleşiyor |
| `ılık` ile `ilik` | **eşleşiyor** | **eşleşmiyor** |
| `bas` ile `Başlık` | eşleşiyor | eşleşmiyor |

Farkın sebebi işleri:

- **Slash menüsü bir komut arıyor.** Klavyesinde `ı` ya da `ş` olmayan
  kullanıcı `/bas` yazıyor ve "Başlık"ı bulmalı. Gevşek eşleşme kolaylık.
- **Bul-değiştir metin değiştiriyor.** "ılık"ı "sıcak" yapan kullanıcının
  belgesindeki "ilik" kelimesi de değişirse bu **veri kaybı**. Burada
  gevşeklik hata.

### İçindekiler sıralanmıyor

İçindekiler paneli başlıkları **belge sırasında** gösteriyor, alfabetik
değil — okur bir sonraki bölümü görmek istiyor. Başlık metnine kasa
dönüşümü uygulanmıyor: "IŞIK" "IŞIK" olarak, "İŞİK" "İŞİK" olarak kalıyor.

## Sağdan sola yazı

`dir="rtl"` temel olarak destekleniyor:

```html
<div id="editor" dir="rtl" lang="ar"></div>
```

- **Blok tutamacı** satırın başına, yani sağa geçiyor; ona ayrılan boşluk da.
- **Alıntı çizgisi**, **liste girintisi**, **içindekiler girintisi** ve
  **tablo hücresi hizası** aynalanıyor.
- Yazma yönü ve imleç hareketi tarayıcının kendi işi; editör modeli
  bozmadan Markdown'a indiriyor.

Yön `dir` özniteliğinden değil **hesaplanmış stilden** okunuyor, yani
ataya konmuş bir `dir` ya da CSS `direction` da çalışıyor.

:::caution[Temel destek ne demek]
Aynalanmayan iki şey var ve ikisi de kasıtlı:

- **Tablo sütun hizası.** Markdown'da `:---` ve `---:` yazarın **açıkça**
  sol ve sağ dediği yer; yöne göre çevrilmiyor.
- **Karışık yönlü belge.** Aynı belgede hem soldan sağa hem sağdan sola
  paragraflar olabilir, ama yön editörün tamamı için veriliyor, blok
  başına değil.

Sağdan sola dillerde gerçek kullanıcılarla sınanmadı. Bir sorunla
karşılaşırsanız bildirin.
:::
