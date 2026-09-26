---
title: Erişilebilirlik
description: Klavye, ekran okuyucu, odak yönetimi ve bilinen kısıtlar.
---

Word deneyimini hedefleyen bir editörün klavye ve ekran okuyucu desteği
"sonradan eklenecek özellik" olamaz: sürükle-bırak tek yol olduğunda
kullanıcıların bir bölümü bloğu hiç taşıyamaz.

## Otomatik denetim

Her CI koşusunda **axe-core** ile WCAG 2.1 A/AA denetimi yapılıyor —
tek bir ekranda değil, sekiz durumda:

- açılış ekranı
- balon araç çubuğu açıkken
- slash menüsü açıkken
- blok menüsü açıkken
- bağlantı popover'ı açıkken
- salt okunur modda
- koyu temada
- yalın temada

Görüntüleyici için ayrıca iki denetim daha var (açık ve koyu tema).
İhlal = build kırmızı.

## Editörün kimliği

Kök eleman `role="textbox"` ve `aria-multiline="true"` taşıyor. Bir metin
kutusunun **adı olmak zorunda**; adsız bir kutu ekran okuyucuda "düzenle,
çok satırlı" diye duyuruluyor ve neyi düzenlediği hiç söylenmiyor.

```ts
new Editor(el, { value: md, label: 'Ürün açıklaması' });
```

Üç seçenekten biri seçilmek zorunda:

1. `label` seçeneğini vermek,
2. kök elemana kendiniz `aria-label` / `aria-labelledby` yazmak —
   görünür bir başlığa bağlamak en iyisi,
3. `mountUi` kullanmak; sözlüğünden bir ad koyuyor.

`@kalem/editor` başsız olduğu için içinde hiçbir kullanıcı metni yok ve
buraya varsayılan bir dize **yazılmıyor**: yazılsaydı Türkçe bir belgede
İngilizce duyurulurdu.

:::note
Zaten bir adı olan elemana dokunulmuyor. `aria-labelledby` ile görünür bir
`<h2>`ye bağladıysanız `mountUi` onu ezmiyor.
:::

Salt okunur mod `aria-readonly` ile duyuruluyor.

## Klavyeyle her şey

Fareyle yapılabilen her şeyin klavye karşılığı var.

| İş | Klavye |
|---|---|
| Biçimlendirme | `Ctrl+B` · `Ctrl+I` · `Ctrl+E` · `Ctrl+Shift+X` |
| Bağlantı | `Ctrl+K` |
| Başlık / paragraf | `Ctrl+Alt+1…6` · `Ctrl+Alt+0` |
| Liste | `Ctrl+Shift+8` · `Ctrl+Shift+7` |
| Liste seviyesi | `Tab` · `Shift+Tab` |
| **Bloğu taşımak** | `Ctrl+Shift+↑ / ↓` |
| Blok menüsü | Tutamağa sekmeyle gelip `Enter` |
| Slash menüsü | `/` sonra `↑ ↓ Enter` |

Blok taşıma özellikle önemli: sürükle-bırak tek yol olsaydı, işaretleme
aygıtı kullanamayan biri belgenin sırasını hiç değiştiremezdi.

## Odak yönetimi

- **Araç çubukları tek sekme durağı.** Çubuğun içinde `←` `→` ile
  geziliyor (roving tabindex). On beş düğmeli bir çubuk on beş sekme
  durağı olsaydı, klavyeyle yazıya dönmek işkence olurdu.
- **Menü kapanınca odak geri veriliyor.** Slash menüsü, blok menüsü ve
  bağlantı popover'ı kapandığında imleç bıraktığı yere dönüyor.
- **Odak halkası blokta**, kapsayıcıda değil: hangi blokta olduğunuz
  görünüyor.

## Duyurular

`mountUi` bir **canlı bölge** (`aria-live`) kuruyor ve ekranda görünmeyen
sonuçları duyuruyor: blok taşındı, blok silindi, biçim uygulandı, kaç
eşleşme bulundu.

```ts
const ui = mountUi(editor);
ui.liveRegion.announce('Belge kaydedildi');
```

Sessizce gerçekleşen bir işlem, ekran okuyucu kullanıcısı için hiç
gerçekleşmemiş demek.

## Simgeler ve adlar

Her düğmenin erişilebilir adı, her dekoratif simgenin `aria-hidden`ı var —
bunu ayrı bir test sabitliyor. Simge ile ad birlikte okunsaydı her düğme
iki kez duyurulurdu.

## Görev listesi

`- [x]` onay kutuları gerçek `<input type="checkbox">`; erişilebilir adları
öğenin metninden geliyor.

## Renk ve kontrast

Tema paleti WCAG AA kontrast oranlarını karşılıyor ve axe her temada bunu
ölçüyor. `prefers-reduced-motion` altında geçişler kapanıyor.

## Bilinen kısıtlar

:::caution
- **Ekran okuyucularla elle test tamamlanmadı.** Otomatik denetim (axe)
  yapısal hataları yakalıyor ama NVDA ve VoiceOver ile gerçek bir okuma
  denemesinin yerini tutmuyor. v1.0 öncesinde yapılacak.
- **Mobil** "çalışır ama optimize değil": belge yazılabiliyor, dokunmatik
  seçim tutamaçları tarayıcının kendi davranışına bırakılmış durumda.
:::
