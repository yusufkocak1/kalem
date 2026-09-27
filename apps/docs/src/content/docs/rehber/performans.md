---
title: Büyük belgeler ve performans
description: Ölçülmüş sayılar, tuş başına maliyet ve serileştirme önbelleği.
---

Kısa cevap: **10.000 bloklu, 440 bin karakterlik bir belgede yazmak akıcı.**
Tuş başına maliyet 13 ms — bir karenin (16,7 ms) altında. Sanal kaydırma
yok, çünkü ölçüm gerektirmediğini gösterdi.

Uzun cevap aşağıda; hepsi `pnpm olcum` ile yeniden üretilebilir.

## Ölçülen sayılar

Chromium, `apps/demo/olcum.html`. Belge başlık, paragraf, liste, alıntı,
sıralı liste ve kod bloğundan oluşan tekrar eden bir desen — tek tip bin
paragraf gerçekçi olmazdı. "Tuş p50" bir tuş vuruşunun kütüphaneye
maliyeti: `beforeinput` ile `onChange` arasında geçen süre.

| Blok | Karakter | DOM elemanı | Açılış | Tuş p50 | Tuş p95 |
| --- | --- | --- | --- | --- | --- |
| 100 | 4.089 | 258 | 13 ms | 0,8 ms | 1,3 ms |
| 500 | 21.115 | 1.288 | 27 ms | 1,2 ms | 1,7 ms |
| 1.000 | 42.375 | 2.573 | 43 ms | 1,9 ms | 3,0 ms |
| 2.500 | 108.581 | 6.427 | 94 ms | 3,7 ms | 5,9 ms |
| 5.000 | 218.974 | 12.858 | 213 ms | 7,3 ms | 9,0 ms |
| 10.000 | 439.689 | 25.716 | 322 ms | 13,0 ms | 15,7 ms |

Açılış tek seferlik ve kullanıcı onu bekliyor; tuş başına maliyet ise her
harfte ödeniyor, o yüzden asıl sayı o.

## Maliyet nereden geliyor

Bir tuş vuruşu tek bir bloğu değiştiriyor, ama `onChange` belgenin
**tamamını** Markdown olarak veriyor. Yani her harfte belge yeniden
yazılıyordu ve maliyet belge boyutuyla doğru orantılı büyüyordu: 5.000
blokta 27,5 ms, 10.000'de 55,5 ms.

Çözüm sanal kaydırma değildi — o DOM düğümü azaltır, bu maliyeti hiç
azaltmazdı. Çözüm **blok başına önbellek** oldu.

## Serileştirme önbelleği

Kalem'in modeli kalıcı (persistent): bir düzenleme yalnızca dokunulan
bloğu yeni bir nesneyle değiştiriyor, geri kalan bloklar **aynı nesne**
olarak kalıyor. Nesne kimliği bu yüzden kusursuz bir önbellek anahtarı.

Editör bunu kendiliğinden kullanıyor; bir şey yapmanız gerekmiyor. Ama
`serialize`'ı kendiniz sık sık çağırıyorsanız (örneğin kendi
görüntüleyicinizi besliyorsanız) aynı kazanç size de açık:

```ts
import { createSerializeCache, serialize } from "@kalem-editor/core";

const cache = createSerializeCache();

// Her çağrıda yalnızca değişen bloklar yeniden yazılıyor.
const markdown = serialize(doc, { cache });
```

Önbellek bir `WeakMap` üstünde: belgeden düşen bloklar kendiliğinden
temizleniyor, elle boşaltmanız gerekmiyor. Aynı önbelleği farklı belgeler
için kullanmak da güvenli.

:::caution[Belgeyi yerinde değiştirmeyin]
Önbellek, AST düğümlerinin **değiştirilmediği** varsayımına dayanıyor.
`onChange`in ikinci argümanında aldığınız belgenin içine yazarsanız
önbellek bayat çıktı verir — sessizce, hata vermeden.

Varsayılan olarak kapalı olmasının sebebi bu. Düzenleme yapmanız
gerekiyorsa `replaceAt` / `removeAt` gibi yeni belge döndüren işlevleri
kullanın.
:::

## Neden sanal kaydırma yok

10.000 blokta ekranda 25.716 DOM elemanı var ve tarayıcı bunu 322 ms'de
kuruyor. Sanal kaydırma bu sayıyı düşürürdü ama karşılığında:

- seçimin sanallaştırılmış sınırlar arasında taşınması,
- bul-değiştir'in ekranda olmayan bloklarda çalışması,
- içindekiler panelinin ve yazdırmanın tüm belgeyi görmesi,
- tarayıcının kendi Ctrl+F'inin çalışmaması

gibi sorunların hepsi bizim işimiz olurdu. Ölçüm bunu gerektirmediğini
söylediği sürece eklemiyoruz.

## Kendiniz ölçmek

```bash
pnpm olcum                   # varsayılan boyutlar, tablo basar
pnpm olcum 100 1000 5000     # kendi boyutlarınız
```

Makineye ve o anki yüke bağlı olduğu için bu sayılar `pnpm verify`
kapısında değil. Kapıdaki testler (`e2e/performans.spec.ts`) bir tuşu,
**aynı sayfada aynı anda** alınan bir cetvelle karşılaştırıyor: belgenin
tamamını önbelleksiz bir kez serileştirmenin süresi. Yük ikisini birden
büyüttüğü için oran sabit kalıyor. Önbellekle bir tuş o cetvelin yaklaşık
0,7'si, önbelleksiz en az 1,5'i — kapının eşiği 1,0: *bir tuş belgeyi
yeniden yazmaktan ucuz olmalı.*

## Bellek

`editor.destroy()` eklediği tüm dinleyicileri geri alıyor ve sökülen
editör çöp toplayıcıya bırakılıyor; ikisi de tarayıcı testleriyle
sabitleniyor. Editörü aynı elemanın üstünde defalarca kurup sökmek — tema
ya da araç çubuğu kipi değiştiğinde olan şey — DOM'u büyütmüyor.
