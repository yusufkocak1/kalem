---
title: Markdown uyumu
description: Hangi sözdizimi destekleniyor ve yazım tercihiniz neden korunuyor.
---

Kalem'in doğru kaynağı **Markdown metninin kendisi**. Bu bir slogan değil,
test edilen bir garanti:

```ts
import { parse, serialize } from '@kalem/core';

serialize(parse(md)) === md; // dokunulmamış belgede her zaman
```

Gidiş-dönüş 17 gerçek belgede byte-birebir doğrulanıyor ve her CI
koşusunda yeniden ölçülüyor.

## Yazım tercihiniz korunuyor

Çoğu editör Markdown'ı kendi "kanonik" biçimine normalize ediyor: `*`
ile yazdığınız liste `-` olarak, `1)` ayracı `1.` olarak geri geliyor.
Kalem bunu yapmıyor — tercih AST'de saklanıyor.

| Yazdığınız | Saklanan |
|---|---|
| `- ` · `* ` · `+ ` | Liste işareti |
| `1.` · `1)` | Sıralı liste ayracı |
| `1. 2. 3.` · `1. 1. 1.` | Numaralandırma biçimi |
| `**kalın**` · `__kalın__` | Vurgu işaretleyicisi |
| `# Başlık` · alt çizgiyle yazılan başlık | ATX mi setext mi |
| `## Başlık ##` | Kapanış diyezleri |
| ` ``` ` · `~~~` · girintili | Kod bloğu biçimi ve çit uzunluğu |
| `[m](u)` · `<url>` · çıplak URL | Bağlantı biçimi |
| `---` · `***` · `___` | Yatay çizginin ham hâli |

Sonuç pratikte şu: bir ekip Markdown dosyalarını git'te tutuyorsa,
Kalem'le açılan bir belgenin diff'i **yalnızca gerçekten değişen
satırları** gösteriyor.

## Desteklenen sözdizimi

CommonMark'ın tamamı, artı GFM'in şu parçaları:

**Bloklar** — paragraf, ATX ve setext başlık, çitli ve girintili kod
bloğu, alıntı, sırasız/sıralı liste, görev listesi (`- [x]`), tablo,
yatay çizgi, ham HTML bloğu, bağlantı tanımı (`[ad]: url`),
frontmatter (YAML ve TOML).

**Satır içi** — kalın, italik, satır içi kod, üstü çizili (`~~`),
bağlantı, autolink (`<url>`), çıplak URL, görsel, başvurulu bağlantı ve
görsel (`[m][ad]`), satır sonu (iki boşluk ve ters bölü), ham HTML.

### Desteklenmeyenler

- **Dipnot** (`[^1]`) — CommonMark'ta ve GFM'in çekirdeğinde yok.
- **Tanım listesi** (`<dl>`) — Markdown standardında yok.
- **Matematik** (`$...$`) — ayrı bir eklentinin işi.

Bunlar ham metin olarak korunuyor; yani bir belgede varsa
**kaybolmuyorlar**, yalnızca biçimlendirilmiyorlar.

## Tablolar

Tablolar ayrıştırılıyor ve gösteriliyor ama Markdown'a **ham hâlleriyle**
geri yazılıyor (`TableSyntax.raw`). Sebep hizalama: bir hücrenin metnini
değiştirmek bütün sütun genişliklerini yeniden hesaplamayı gerektiriyor ve
sonuç, kullanıcının elle hizaladığı tabloyu bozuyor.

:::caution[Bilinen kısıt]
Tablo hücreleri şu an düzenlenebilir çiziliyor ama yazılan metin çıktıya
**girmiyor**. Tablo düzenleme v1.0 öncesinde ya tamamlanacak ya da hücreler
salt okunur hâle gelecek. Takip:
[iş listesi, açık işler](https://github.com/yusufkocak1/kalem/blob/main/docs/01-is-listesi.md).
:::

## Locale duyarlı davranış

Belgenin `lang`i tek kaynak ve her karşılaştırma onu kullanıyor.

```ts
new Editor(el, { value: md, lang: 'tr' });
```

Türkçe'de `i/İ` ve `ı/I` çiftleri İngilizce'den farklı katlanıyor:

```ts
'IŞIK'.toLowerCase()            // "işik" — noktasız ı, noktalı i oldu
'IŞIK'.toLocaleLowerCase('tr')  // "ışık" ✓
```

Hata **patlamıyor**, sessizce yanlış cevap veriyor: `ışık` arayan kullanıcı
`IŞIK` yazan satırı bulamıyor ve sebebini anlamıyor.

Bu yüzden depoda bir **lint kuralı** var: bölgesiz `toLowerCase()` /
`toUpperCase()` çağrısı build'i kırıyor. Kaçınmak isteyen satırın
gerekçesini yazmak zorunda (`// kalem-locale-ok: …`).

Etkilediği yerler: slash menü araması, bul-değiştir, içindekiler
sıralaması ve kelime sayımı (`Intl.Segmenter`).

`lang` verilmezse kapsayıcının ya da atalarının `lang`i kullanılıyor —
yani `<html lang="tr">` yazan bir sayfada ayrıca vermeniz gerekmiyor.

## Ham HTML

Markdown ham HTML'e izin veriyor; Kalem onu **varsayılan olarak kaçırıyor**
(`html: "escape"`). Politika ayarlanabilir:

| Değer | Ne oluyor |
|---|---|
| `"escape"` (varsayılan) | HTML metin olarak görünüyor |
| `"strip"` | Tamamen atılıyor |
| `"allow"` | Çağıranın kancasına veriliyor |

Ayrıntı ve gerekçe: [Güvenlik](/rehber/guvenlik/).

## Serileştirme seçenekleri

```ts
import { serialize } from '@kalem/core';

serialize(doc, { /* SerializeOptions */ });
```

| Seçenek | Varsayılan |
|---|---|
| `bulletMarker` | `-` |
| `emphasisMarker` | `*` |
| `codeFence` | `` ` `` |
| `orderedDelimiter` | `.` |
| `thematicBreak` | `---` |
| `lineEnding` | LF (kökün kendi tercihi varsa o kazanıyor) |

Bu seçenekler yalnızca tercihin **bulunmadığı** düğümler için geçerli —
yani kullanıcının yazdığı belgeyi yeniden biçimlendirmiyorlar, sıfırdan
ürettiğiniz AST'nin nasıl yazılacağını belirliyorlar.
