---
title: Görsel yükleme
description: Sürükle-bırak, yapıştırma ve kendi depolama servisiniz.
---

`@kalem-editor/plugin-image-upload` sürükle-bırakı, yapıştırmayı ve dosya
seçiciyi hallediyor; **ağ hakkında hiçbir şey bilmiyor**. Hangi servis,
hangi kimlik doğrulama, hangi yeniden deneme — hepsi sizin.

```bash
npm i @kalem-editor/plugin-image-upload
```

```ts
import { imageUploadPlugin } from '@kalem-editor/plugin-image-upload';
import '@kalem-editor/themes/plugin-image.css';

editor.addPlugin(
  imageUploadPlugin({
    accept: ['image/'],
    maxSize: 5 * 1024 * 1024,

    async upload({ file, onProgress, signal }) {
      const form = new FormData();
      form.append('dosya', file);

      const yanit = await fetch('/api/gorsel', { method: 'POST', body: form, signal });
      if (!yanit.ok) throw new Error('Yükleme başarısız');

      onProgress(1);
      const { url, alt } = await yanit.json();
      return { url, alt };
    },

    onError(hata, dosya, sebep) {
      // sebep: "type" | "size" | "upload"
      uyar(`${dosya.name}: ${hata.message}`);
    },
  }),
);
```

`upload` ya bir URL dizesi ya da `{ url, alt }` döndürüyor.

## İlerleme

`onProgress(0…1)` çağırdıkça belgedeki geçici görselin üstünde ilerleme
görünüyor. `fetch` ilerleme bildirmediği için gerçek yüzdeyi istiyorsanız
`XMLHttpRequest` gerekiyor:

```ts
async upload({ file, onProgress, signal }) {
  return new Promise((çöz, ret) => {
    const istek = new XMLHttpRequest();
    istek.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    istek.addEventListener('load', () => çöz(JSON.parse(istek.responseText).url));
    istek.addEventListener('error', () => ret(new Error('Ağ hatası')));
    signal.addEventListener('abort', () => istek.abort());
    istek.open('POST', '/api/gorsel');
    istek.send(file);
  });
}
```

## İptal

Kullanıcı yükleme sürerken görseli silerse `signal` iptal ediliyor.
İsteğinize geçirmeyi unutmayın — yoksa sunucu, belgede olmayan bir dosyayı
saklamaya devam eder.

## Geçici adres

Yükleme sürerken belgeye bir **geçici adres** giriyor ve tamamlanınca
kalıcısıyla değiştiriliyor. Yani kullanıcı beklerken yazmaya devam
edebiliyor ve imleci kaymıyor.

Yükleme başarısız olursa geçici görsel belgeden çıkarılıyor; yarım kalmış
bir `![](blob:…)` bırakılmıyor.

## Kabul kuralları

| Seçenek | Varsayılan | Not |
|---|---|---|
| `accept` | `["image/"]` | **Önek** karşılaştırması, tam eşleşme değil |
| `maxSize` | sınırsız | Bayt |

Önek karşılaştırması bilerek: `image/` bütün görsel türlerini kapsıyor ve
yarın çıkacak bir biçim için listeyi güncellemek gerekmiyor.

Reddedilen dosya `onError`a `"type"` ya da `"size"` sebebiyle geliyor.

## `data:` görselleri

Küçük görselleri gömmek isterseniz beyaz liste sınırlı: `image/png`,
`image/jpeg`, `image/gif`, `image/webp`, `image/avif`.

`data:image/svg+xml` **kasten dışarıda** — SVG içinde script çalışıyor.
Ayrıntı: [Güvenlik](/rehber/guvenlik/).

## Alternatif metin

Eklenti görsele tıklandığında bir alt metin düzenleyicisi açıyor
(`createAltEditor`). Alternatif metin erişilebilirlik için zorunlu
sayılmıyor ama boş bırakıldığında ekran okuyucu dosya adını okuyor —
`IMG_20240115_112233.jpg` kimseye bir şey anlatmıyor.

## Yeniden boyutlandırma

Eklenti görseli **kendisi boyutlandırmıyor**; Markdown'da genişlik
söz dizimi yok ve HTML'e kaçmak belgeyi taşınamaz hâle getirirdi.
İhtiyacınız varsa `onResize` kancasıyla kendi çözümünüzü bağlayın.
