# F1-01 — AST Kararları ve Taslaktan Sapmalar

> Tarih: 2026-09-08 · Durum: uygulandı, `pnpm verify` yeşil
> İlgili: [00-analiz.md §5.2](./00-analiz.md) · [01-is-listesi.md](./01-is-listesi.md)

Analiz §5.2 bir **taslak** veriyordu. Uygulamaya geçince taslağın üç yerde
gerçek mdast şemasıyla çeliştiği ortaya çıktı. Üçünde de mdast'ı seçtim —
çünkü taslağın kendi gerekçesi zaten "mdast uyumluluğu"ydu. Sapmalar aşağıda;
biri yanlış geldiyse geri almak kolay, henüz bu tiplere bağlı kod yok.

---

## Sapma 1 — `image` blok değil, satır içi

**Taslak:** `image`'ı `Block` birliğinde listeliyordu.
**Uygulama:** `Inline` birliğine alındı.

mdast'ta görsel satır içi bir düğümdür; tek başına duran bir görsel aslında
*içinde görsel olan bir paragraftır*. Blok yapmak `![x](y.png)` ile
`metin ![x](y.png) metin` arasında iki ayrı düğüm tipi gerektirirdi ve remark
eklentileri ağacımızı okuyamazdı.

Editörde "görsel bloğu" hissi vermek yine mümkün — `@kalem/ui` tek çocuğu
görsel olan paragrafı özel render eder. Bu bir **sunum** kararıdır, veri
modeli kararı değil.

---

## Sapma 2 — `tight` yerine `spread`

**Taslak:** `list: { tight: boolean }`
**Uygulama:** `list: { spread: boolean }` — tam tersi anlam.

mdast'ın terimi `spread`: `true` ise gevşek liste (maddeler arası boş satır,
içerik `<p>` ile sarılır). `tight === !spread`. İsim uydurmak, tek başına
uyumluluğu kıracak bir tercihti.

Bu sapmanın gözden kaçması kolay bir tuzağı var: `spread: false` ile
`tight: false` **zıt** şeyler. Serileştiriciyi (F1-07) yazarken buna dikkat.

---

## Sapma 3 — Satır içi HTML ayrı bir tip değil

**Taslak:** dolaylı olarak tek bir blok `html` düğümü öngörüyordu.
**İlk denemem:** ayrı bir `inlineHtml` tipi uydurmuştum.
**Uygulama:** mdast gibi tek `html` tipi, iki gruba birden ait.

mdast ham HTML için blok/satır içi ayrımı yapmaz — `<br>` bir cümlenin
ortasında da, tek başına da yazılabilir ve ikisi de `type: "html"`tir.

Bunun künye kaydına bir bedeli oldu: `NodeSpec.group` tekil bir değer
olamadı, `groups: readonly NodeGroup[]` oldu. Kayıttaki tek çok-gruplu tip
`html`; bir test bunu koruyor ki ilerde başka bir tip sessizce çok-gruplu
hale gelmesin.

Pratik sonucu: `isBlock(htmlDugumu)` ve `isInline(htmlDugumu)` **ikisi de**
`true` döner.

---

## Taslakta olmayıp eklenenler

| Ekleme | Neden |
|---|---|
| `root` | Belgenin kökü; taslak atlamıştı |
| `listItem`, `tableRow`, `tableCell` | Taslak `ListItem`'a atıf yapıyor ama tanımlamıyordu |
| `definition`, `linkReference`, `imageReference` | F1-04 "referanslı link" istiyor; tanımsız temsil edilemezdi |
| `yaml`, `toml` | F1-06 frontmatter'ı opak string olarak korumayı gerektiriyor |
| `Structural` birliği | `blockquote.children` bir `tableRow` kabul etmemeli |
| `syntax` alanları | Aşağıda |

Kapsam dışı bırakılan: **dipnotlar** (`footnoteDefinition` / `footnoteReference`).
GFM'in parçası ama iş listesindeki F1-05 kapsamında sayılmamış. v1.1'de eklenirse
künyeye iki satır ve birliğe iki tip demek — kırıcı değişiklik değil.

---

## `syntax` — projenin ayırt edici alanı

Kendi ayrıştırıcımızı yazma gerekçemiz buydu (analiz §5.3): marked ve
markdown-it kullanıcının **yazım tercihini** vermez, biz vermek zorundayız.

```ts
heading.syntax   { style: "atx" | "setext", closed?, underline? }
code.syntax      { style: "fenced" | "indented", fence?, fenceLength? }
list.syntax      { marker?, delimiter?, numbering? }
emphasis.syntax  { marker: "*" | "_" }
link.syntax      { style: "inline" | "autolink" | "literal", titleDelimiter? }
```

Üç tasarım kararı:

**1. `data` değil, `syntax`.** mdast eklenti verisi için `data` alanını
ayırıyor — ama remark eklentileri de oraya yazıyor (`hName`, `hProperties`).
Çakışmamak için kendi alanımızı açtım. Fazladan alanlar mdast'a atanabilirliği
bozmuyor.

**2. Hepsi isteğe bağlı.** Elle kurulan bir düğümde `syntax` bulunmaz;
serileştirici o zaman yapılandırılmış varsayılana düşer. Ayrıştırıcıdan gelen
düğümlerde dolu olur ve kullanıcının yazdığı gibi geri yazılır.

**3. İki yerde modelleme yerine ham metin.** `thematicBreak.syntax.raw` ve
`table.syntax.raw`. Gerekçeleri farklı:

- Yatay çizgi: `---`, `***`, `* * *`, `- - - - -` hepsi geçerli. Karakter +
  sayı + boşluk deseni modellemek, ham metni saklamaktan hem uzun hem daha
  hatalı olurdu.
- Tablo: v1'de düzenleme arayüzü yok (Karar #5) ama dosya bozulmamalı. Hücre
  dolgusu ve ayraç satırı tek tek modellenmeden, tablo hem gerçek bir ağaç
  olarak (viewer render edebilsin) hem ham metin olarak (byte düzeyinde geri
  yazılabilsin) tutuluyor. Düzenleme geldiğinde (v1.1) `raw` yerini gerçek
  modele bırakır.

**Boş satırlar için ayrı alan yok.** Bloklar arası boşluk `position`
offsetlerinden hesaplanabilir. Ayrı bir `spacingBefore` alanı, düzenleme
sonrası hemen bayatlayacak ikinci bir doğruluk kaynağı olurdu.

---

## `id` isteğe bağlı — ayrıştırıcı doldurmuyor

Analiz "her düğümde `id`" diyordu. Zorunlu yapmadım.

Ayrıştırıcı her düğüme kimlik üretseydi, orta boy bir belgede binlerce
gereksiz string tahsisi olurdu. Kimliğe **ihtiyaç duyan** editör; sürükle-bırak
ve DOM eşlemesi için sorumlu olduğu bloklara kendisi atayacak (F2-05).

`id?: NodeId` olarak duruyor, serileştirici görmezden geliyor.

---

## API dili: İngilizce

Dışa açılan bütün isimler İngilizce (`isBlock`, `SPECS`, `NodeSpec`),
yorumlar ve dokümanlar Türkçe.

Paket npm'e yayımlanacak ve BlockNote / Milkdown ile aynı rafta duracak;
Türkçe API adları benimsemeyi doğrudan düşürürdü. Faz 0'daki kapı script'leri
(`guard-locale.mjs` içindeki `bulgular`, `kural`) iç araç olduğu için Türkçe
kaldı — onlar yayımlanmıyor.

---

## Kabul kriteri: "sıfır runtime kodu"

`ast.ts` yalnızca tip içeriyor. Bunu bir test koruyor:

```ts
import * as ast from "./ast.js";
expect(Object.keys(ast)).toHaveLength(0);
```

Biri dosyaya bir `const` eklerse modül boş olmaktan çıkar ve test kırılır.
Çalışan kod `spec.ts` ve `guards.ts`'te — iş listesi zaten `isBlock` /
`isInline` istiyordu ve onlar tanım gereği runtime.

## mdast uyumluluğu nasıl korunuyor

`@types/mdast` bir bağımlılık olurdu. Bunun yerine mdast arayüzlerinin ilgili
kısmı `ast.test.ts` içinde **elle** yazıldı ve düğümlerimizin onlara
atanabildiği doğrulanıyor. Test kırılırsa anlamı net: *remark eklentisi
ağacımızı okuyamaz.*

mdast'ın isteğe bağlı bıraktığı alanlar, ayrıştırıcımız her zaman değer
ürettiği yerlerde daraltıldı (`ordered?: boolean | null` → `ordered: boolean`).
Daraltma tek yönlü uyumu bozmuyor: bizim ağacımız mdast bekleyen bir eklentiye
verilebilir. Tersi gerekmiyor, çünkü dışarıdan mdast ağacı kabul etmiyoruz.

---

## Sırada

**F1-02 · AST yardımcıları** — `walk`, `visit`, `find`, `replace`, `remove`,
`insertAt`, `clone`, `pathToNode`, `nodeAtPath`.

Künye kaydı bunun için hazır: `isParent` ve `ContentModel` sayesinde her düğüm
tipi için ayrı `switch` yazmak gerekmeyecek.
