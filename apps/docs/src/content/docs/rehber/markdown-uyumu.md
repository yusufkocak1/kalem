---
title: Markdown uyumu
description: Hangi sözdizimi destekleniyor ve gidiş-dönüş nasıl garanti ediliyor.
---

## Desteklenen sözdizimi

**CommonMark çekirdeği** — paragraf, ATX ve setext başlık, fenced ve girintili kod,
alıntı, sıralı/sırasız liste (iç içe dahil), yatay çizgi, bağlantı, referanslı
bağlantı, görsel, autolink, vurgu, kod span, kaçış karakterleri, sert satır sonu.

**GFM** — üstü çizili (`~~`), görev listesi (`- [ ]`), otomatik bağlantı,
tablo *(v1'de ayrıştırılır ve korunur; düzenleme arayüzü v1.1)*.

**Ekstra** — YAML/TOML frontmatter opak olarak korunur. Kalem onu ayrıştırmaz,
sadece bozmadan geri yazar. (Bu, bir YAML parser bağımlılığından kaçınmak için
bilinçli bir tercihtir.)

## Gidiş-dönüş garantisi

Kalem'in en önemli teknik vaadi:

```ts
serialize(parse(md)) === md
```

Bunu mümkün kılan şey, ayrıştırıcının **sözdizimi tercihlerini** saklamasıdır.
Belgenizde madde işareti olarak `*` kullandıysanız Kalem `*` üretir, `-` değil.
Başlıklarınız setext ise setext kalır. Kod bloklarınız `~~~` ile açılmışsa öyle
kalır.

### Bu neden bu kadar önemli?

Kalem'in çıkardığı dosya git'e commit edilir. Kullanıcının dokunmadığı bir
satırın değişmesi, diff'i gürültüyle doldurur ve değişikliği incelenemez hâle
getirir. Bir editör bu testi geçemiyorsa ciddi projelerde kullanılamaz.

### Yeni içerik için varsayılanlar

Belgede örneği olmayan yeni düğümler için tercihleri siz belirlersiniz:

```ts
new Editor(el, {
  markdown: {
    bulletMarker: '-',    // '-' | '*' | '+'
    emphasisMarker: '_',  // '_' | '*'
    codeFence: '```',     // '```' | '~~~'
    headingStyle: 'atx',  // 'atx' | 'setext'
  },
});
```

## Uyum oranı

CommonMark ve GFM spec test paketleri CI'da her commit'te çalıştırılır ve güncel
geçiş oranı sürüm notlarında yayımlanır.

**%100 uyum bir v1 hedefi değildir.** Hedef, ölçülen ve şeffaf biçimde
raporlanan bir orandır. Bunun yerine ağırlık, gerçek dünya dosyalarında
gidiş-dönüş sadakatine verilmiştir: test korpusumuz CommonMark spec örneklerinin
yanı sıra popüler depo README'lerini ve gerçek not koleksiyonlarını içerir.

## Uç durumlara ihtiyacınız varsa

Spec-mükemmel bir ayrıştırıcı gerekiyorsa adaptörü takabilirsiniz:

```ts
import { micromarkParser } from '@kalem/parser-micromark';

new Editor(el, { parser: micromarkParser() });
```

Bu, boyut karşılığında tam uyum sağlar. Ayrıştırıcı bir arayüz arkasında
soyutlandığı için çekirdeğin geri kalanı değişmeden çalışır.
