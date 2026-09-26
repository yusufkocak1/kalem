---
title: Markdown uyumu
description: Hangi sözdizimi destekleniyor ve yazım tercihiniz neden korunuyor.
---

Kalem'in doğru kaynağı **Markdown metninin kendisi**. Bu bir slogan değil,
test edilen bir garanti:

```ts
import { parse, serialize } from '@kalem/core';

serialize(parse(md)) === md; // test korpusunda byte-birebir
```

Gidiş-dönüş 18 gerçek belgelik bir korpusta byte-birebir doğrulanıyor,
652 CommonMark örneğinde ve on binlerce rastgele girdide idempotans için
sınanıyor ve her CI koşusunda yeniden ölçülüyor. Birkaç nadir kalıp hâlâ
normalleşiyor; [Bilinen kısıtlar](/bilinen-kisitlar/) sayfasında listeli.

## Yazım tercihiniz korunuyor

Çoğu editör Markdown'ı kendi "kanonik" biçimine normalize ediyor: `*`
ile yazdığınız liste `-` olarak, `1)` ayracı `1.` olarak geri geliyor.
Kalem bunu yapmıyor — tercih AST'de saklanıyor.

| Yazdığınız | Saklanan |
|---|---|
| `- ` · `* ` · `+ ` | Liste işareti |
| `1.` · `1)` | Sıralı liste ayracı |
| `1. 2. 3.` · `1. 1. 1.` | Numaralandırma biçimi |
| `1.  metin` · `-   metin` | İşaretten sonraki boşluk |
| dört ya da iki boşluklu iç liste | İşaretten önceki girinti |
| `**kalın**` · `__kalın__` | Vurgu işaretleyicisi |
| `# Başlık` · alt çizgiyle yazılan başlık | ATX mi setext mi |
| uzun başlığın altında kısa `---` | Setext çizgisinin uzunluğu |
| `## Başlık ##` | Kapanış diyezleri |
| ` ``` ` · `~~~` · girintili | Kod bloğu biçimi ve çit uzunluğu |
| `[m](u)` · `<url>` · çıplak URL | Bağlantı biçimi |
| `---` · `***` · `___` | Yatay çizginin ham hâli |
| `> alıntı` ardından `>`sız satır | Alıntıda tembel devam |
| satır sonu boşluğu, baştaki ve sondaki boş satırlar | Boşluk |

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

Tablolar ayrıştırılıyor, gösteriliyor ve **hücre metni düzenlenebiliyor.**
Markdown'a satır satır geri yazılıyor: dokunulmayan satır ham hâliyle
(`TableSyntax.raw`) kalıyor, düzenlenen satır yeniden üretiliyor. Yeni
satır eski satırın biçimini koruyor — kenar boruları ve hücre genişlikleri
aynı; yeni metin eski genişliğe sığıyorsa boşlukla dolduruluyor, sığmıyorsa
yalnızca o hücre uzuyor.

Bütün tabloyu yeniden hizalamak bilinçli olarak yapılmıyor: tek kelime için
elle hizalanmış bir tablonun her satırını değiştirmek, dokunulmamış
satırları değiştirmek olurdu.

:::note[v1.1]
Satır ve sütun ekleme/silme ile hizalama değiştirme `@kalem/plugin-table`
ile geliyor (Karar #5).
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
