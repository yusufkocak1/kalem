---
title: Mimari
description: Kalem nasıl çalışır ve neden bu şekilde tasarlandı.
---

Bu sayfa, Kalem'in iç tasarımını meraklı kullanıcılar ve olası katkıcılar için
özetler. Tam analiz dokümanı depodadır.

## Beş ilke

1. **Markdown kullanıcıya sızmaz.** Varsayılan modda kullanıcı hiçbir zaman `##`
   veya `**` görmez. Kaynak modu opt-in bir özelliktir.
2. **Kayıpsız gidiş-dönüş.** Kullanıcının dokunmadığı satır byte düzeyinde
   değişmez.
3. **Ödemediğin şeyi indirmezsin.** Viewer isteyen editör kodunu indirmez.
4. **Çekirdek hiçbir framework'ü bilmez.** Ne React, ne Vue, ne sanal DOM.
5. **Güvenlik varsayılan.** AST'den render = enjeksiyon yüzeyi yok.

## Paket grafiği

```
core  ←  viewer  ←  editor  ←  ui  ←  { react, vue, wc }
                        ↖ plugin-*
```

Bağımlılık yönü tek yönlüdür ve döngü yoktur. `core` hiçbir şeye bağlı değildir.
Bu sıralama, "sadece viewer isteyen" kullanıcının editör kodunu asla
indirmemesini **yapısal olarak** garanti eder.

## Blok-tabanlı editör motoru

Kalem, ProseMirror veya Lexical gibi bir motorun üzerine kurulmaz. Kendi
motorunu kullanır ve bunun sebebi boyut hedefidir.

Anahtar tasarım kararı: **her blok kendi küçük `contenteditable` elemanıdır.**

- **Blok içi** seçim, imleç, IME (Çince/Japonca/Korece giriş), otomatik düzeltme
  → tarayıcı halleder. contenteditable'ın en zor kısmı bize hiç gelmez.
- **Blok arası** seçim, sürükle-bırak, ekleme/silme → bizim deterministik JS
  mantığımız.

Bu, sürükle-bırak blok yeniden sıralamayı da neredeyse bedava getirir — tek
büyük contenteditable kullanan mimarilerde bu ayrı ve pahalı bir iştir.

## Doküman modeli

AST, `mdast` ile **şekil olarak uyumludur** ama `unified` bağımlılığı yoktur.
Bunun pratik faydası: isterseniz remark/rehype ekosistemindeki eklentileri kendi
tarafınızda Kalem'e bağlayabilirsiniz, ama Kalem onlara bağımlı değildir.

Kritik ayrım: **doğru kaynak her zaman Markdown metnidir**, AST değil. Editor.js
gibi JSON'u doğru kabul eden araçlar Markdown'a kayıplı dönüşüm yapar. Kalem'de
AST yalnızca Markdown'ın bellek içi temsilidir.

## Gidiş-dönüş sadakati

Ayrıştırıcı, her düğümde konum bilgisinin yanı sıra **sözdizimi tercihini** de
saklar: madde işareti `-` miydi `*` mıydı, başlık ATX miydi setext miydi, kod
bloğu ``` ile mi açılmıştı. Serileştirici bu tercihleri kullanır.

Bu yüzden hazır bir ayrıştırıcı (marked, markdown-it) kullanılamadı — hiçbiri bu
bilgiyi vermez.

## Ölçülen vaatler

İki vaat CI'da otomatik olarak korunur; ikisi de bir testtir, bir niyet değil:

- **Boyut kapısı** — `size-limit` bütçeyi aşan build'i kırar.
- **Saflık kapısı** — çekirdek paketlerin `dependencies` alanı boş mu, üretim
  bundle'ında `react`/`vue` izi var mı, `core` bundle'ı `document`/`window`'a
  dokunuyor mu (SSR güvenliği).

Bir vaat ölçülmüyorsa zamanla erir. Bu iki kapı, projenin ilk gününden itibaren
vardır.

## Bilinçli kapsam dışı

- Sayfa düzeni ve sayfa kırılımı — Markdown'ın kavramı değil
- Metin sarmalı, çok sütun, dipnot düzeni
- WYSIWYG içinde ham HTML düzenleme (korunur ve gösterilir, düzenlenmez)
