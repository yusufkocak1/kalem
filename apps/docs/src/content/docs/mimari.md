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

## Eklenti mimarisi

Eklentiler dört alanlı nesneler: `name`, `setup`, `keymap`, `inputRules`.
Aldıkları bağlam (`PluginContext`) dar ve bilerek öyle — belge, imleç,
`applyEdit`, kök eleman, salt okunur durumu ve olay aboneliği.

**Render kancası yok.** Böyle bir kanca, editörün imleç koruyan yama
mantığını eklentilere açardı ve her eklenti kendi imleç hatasını
üretirdi. Yedi resmî eklentinin hiçbirinde ihtiyaç duyulmadı; pratikte
gereken şey "değişiklik başına tek çağrı"ydı ve onu `ctx.on('change', …)`
veriyor.

Çakışma kuralı tek: **kayıt sırası**. Eklentiler çekirdekten önce tuşu
görür, aralarında önce kaydedilen kazanır. Öncelik sayısı, faz sistemi ya
da "yüksek öncelikli eklenti" kavramı yoktur.

## Ölçülen vaatler

Üç vaat CI'da otomatik olarak korunur; üçü de birer testtir, niyet değil:

- **Boyut kapısı** — `size-limit` bütçeyi aşan build'i kırar.
- **Saflık kapısı** — çekirdek paketlerin `dependencies` alanı boş mu, üretim
  bundle'ında `react`/`vue` izi var mı, `core` bundle'ı `document`/`window`'a
  dokunuyor mu (SSR güvenliği).
- **Locale kapısı** — bölgesiz `toLowerCase()` / `toUpperCase()` çağrısı
  build'i kırar. Türkçe'de `I` ve `ı` sessizce yanlış katlanır; hata
  patlamaz, yalnızca yanlış cevap verir.

Bir vaat ölçülmüyorsa zamanla erir. Bu kapılar projenin ilk gününden
itibaren vardır ve kendi öz-testleri de var (`pnpm guard:selftest`).

## Bugünkü ölçüler

| Paket | min+gzip |
|---|---|
| `@kalem/core` | 11,5 kB |
| `@kalem/viewer` | 2,7 kB |
| `@kalem/editor` (çekirdek dâhil) | 26,1 kB |
| `@kalem/editor` + `@kalem/ui` | 34,6 kB |
| `@kalem/wc` — tek `<script>` derlemesi | 26,7 kB |
| Sarmalayıcılar (react / vue / wc) | 903 B / 682 B / 1,98 kB |

Doğrulama: 1284 birim testi, 1104 tarayıcı testi (Chromium · Firefox ·
WebKit) ve 58 örnek/uygulama testi.

## Bilinçli kapsam dışı

- Sayfa düzeni ve sayfa kırılımı — Markdown'ın kavramı değil
- Metin sarmalı, çok sütun, dipnot düzeni
- WYSIWYG içinde ham HTML düzenleme (korunur ve gösterilir, düzenlenmez)
