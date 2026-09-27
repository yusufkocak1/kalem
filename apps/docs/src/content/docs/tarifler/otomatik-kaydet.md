---
title: Otomatik kaydetme
description: Gecikmeli kaydetme, durum göstergesi ve çökme kurtarması.
---

`@kalem-editor/plugin-autosave` üç işi birden yapıyor: yazma durunca kaydetmek,
durumu bildirmek ve sunucuya ulaşılamadığında metni yerel olarak
kurtarmak.

```bash
npm i @kalem-editor/plugin-autosave
```

```ts
import { autosavePlugin, createIndicator, trAutosaveLabels } from '@kalem-editor/plugin-autosave';
import '@kalem-editor/themes/plugin-autosave.css';

const gosterge = createIndicator(document.getElementById('durum')!, {
  prefix: 'kalem-',
  labels: trAutosaveLabels,
});

const kayit = autosavePlugin({
  delay: 1500,
  storageKey: `kalem:taslak:${belgeId}`,
  async save(markdown, signal) {
    const yanit = await fetch(`/api/belge/${belgeId}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/markdown' },
      body: markdown,
      signal,
    });
    if (!yanit.ok) throw new Error(`Kaydedilemedi (${yanit.status})`);
  },
  onStateChange: (durum) => gosterge.render(durum),
});

editor.addPlugin(kayit);
```

## Durumlar

| Durum | Ne zaman | Türkçe metin |
|---|---|---|
| `idle` | Kaydedilecek bir şey yok | — |
| `dirty` | Değişiklik var, kaydetme bekliyor | Kaydedilmemiş değişiklik |
| `saving` | `save` çalışıyor | Kaydediliyor… |
| `saved` | Başarılı | Kaydedildi |
| `error` | `save` fırlattı | Kaydedilemedi |

Gösterge `role="status"` taşıyor, `aria-live` değil: durum değişimi
kullanıcının işini bölmeden okunabilir kalıyor.

## Hatayı yutmayın

`save` kancası fırlatırsa durum `error` oluyor. Bu **istenen** davranış:

```ts
save: async (markdown) => {
  if (!yerelDepoyaYaz(markdown)) {
    throw new Error('Yerel depoya yazılamadı');
  }
},
```

Bir not uygulamasında sessizce yutulan kayıt hatası, yapılabilecek en kötü
şey — kullanıcı yazmaya devam ediyor ve hiçbir şeyin gitmediğini
bilmiyor.

## Çökme kurtarması

`storageKey` verildiğinde eklenti her değişikliği `localStorage`a da
yazıyor. Sayfa çökerse ya da sekme kapanırsa metin orada duruyor.

```ts
const kurtarilan = kayit.recovered();
if (kurtarilan !== null && kurtarilan !== editor.getValue()) {
  if (confirm('Kaydedilmemiş bir taslak bulundu. Geri yüklensin mi?')) {
    editor.setValue(kurtarilan);
  }
  kayit.clearRecovered();
}
```

Eklenti kurtarma kaydını **kendiliğinden uygulamıyor**: kullanıcının
görmediği bir metni sessizce geri yüklemek, gerçekten istediği sürümü
gizleyebilirdi. Ne yapılacağına uygulama karar veriyor.

:::caution[Anahtar belgeye özgü olmalı]
Aynı kaynakta birden çok belge açılabiliyor. Ortak bir anahtar, bir notun
taslağını başka bir nota getirir. Anahtar verilmezse yerel kurtarma
**kapalı** kalıyor — rastgele bir anahtar üretmek bu riski taşırdı.
:::

## Hemen kaydetmek

Kullanıcı "Kaydet"e bastığında ya da sayfadan ayrılırken:

```ts
document.getElementById('kaydet')!.addEventListener('click', () => kayit.saveNow());

window.addEventListener('beforeunload', (e) => {
  if (kayit.state() === 'dirty' || kayit.state() === 'saving') {
    e.preventDefault();
  }
});
```

## Tek uçuş kuralı

Aynı anda yalnızca bir kaydetme çalışıyor. Kaydetme sürerken yeni bir
değişiklik gelirse, o biter bitmez **bir kez daha** kaydediliyor — üst
üste binen istekler yerine sıralı ve öngörülebilir bir akış.
