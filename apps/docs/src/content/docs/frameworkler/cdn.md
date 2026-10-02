---
title: CDN (script etiketi)
description: Derleme adımı, paketleyici ve yazılmış JavaScript olmadan.
---

Sayfanın tamamı bu:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/tokens.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/viewer.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/editor.css">

<kalem-editor label="Belge">
    # Merhaba

    Yazmaya başlayın.
</kalem-editor>

<script src="https://cdn.jsdelivr.net/npm/@kalem-editor/wc/dist/kalem-editor.iife.js"></script>
```

Derleme adımı yok, paketleyici yok, import haritası yok — **yazılmış
JavaScript de yok**. Özel eleman bildirimsel olduğu için yazacak bir şey
kalmıyor.

## Neden ayrı bir derleme

`@kalem-editor/wc`in ESM çıktısı `@kalem-editor/core` ve `@kalem-editor/editor`i **dışarıda**
bırakıyor; paketleyici kullanan uygulamada doğrusu bu, yoksa aynı kod iki
kez paketlenirdi. Ama CDN kullanıcısının paketleyicisi yok ve çıplak bir
`import "@kalem-editor/editor"` satırı tarayıcıda çözülmez.

`kalem-editor.iife.js` hepsini içine alıyor: **29,9 kB** (gzip), tek
istek, `type="module"` bile gerekmiyor.

## Eleman kendiliğinden kaydoluyor

Modül girişlerinde kayıt açık bir çağrı (`defineKalemEditor()`), çünkü
aynı sayfada iki sürümü bulunan bir uygulamayı açılışta patlatmamak
gerekiyor. Script etiketi düşen kişinin beklentisi ise tersine.

Çelişki yok: çağrı **tekrarlanabilir** — ad zaten kayıtlıysa sessizce
geçiliyor, yani script sayfaya iki kez eklenirse hata vermiyor.

`window.Kalem` üzerinden imperatif API de duruyor:

```html
<script>
  // Farklı bir etiket adıyla ikinci bir kayıt
  Kalem.defineKalemEditor('belge-editoru');
</script>
```

## Form entegrasyonu — JavaScript'siz

```html
<form action="/kaydet" method="post">
  <kalem-editor name="icerik" required label="İçerik"></kalem-editor>
  <button type="submit">Gönder</button>
</form>
```

`ElementInternals` alanı forma bağlıyor. Gönderimi tarayıcı yapıyor,
`required` boşken engelliyor — arada sizin yazdığınız bir satır yok.

## Sürüm sabitleme

Üretimde sürümü sabitleyin:

```html
<script src="https://cdn.jsdelivr.net/npm/@kalem-editor/wc@1.0.0/dist/kalem-editor.iife.js"></script>
```

jsDelivr ve unpkg dosyayı `exports` haritasına bakmadan, tarball'daki
yolundan servis ediyor.

## Araç çubuğu istiyorsanız

IIFE derlemesi editörü ve çekirdeği taşıyor, `@kalem-editor/ui`yi değil. Word
benzeri arayüz için ya bir paketleyici kullanın
([Vanilla](/frameworkler/vanilla/)) ya da modül olarak yükleyin:

```html
<script type="module">
  import { mountUi } from 'https://cdn.jsdelivr.net/npm/@kalem-editor/ui/+esm';

  const el = document.querySelector('kalem-editor');
  el.addEventListener('kalem-ready', (e) => mountUi(e.detail.editor));
</script>
```

## Çalışan örnek

[`examples/cdn-vanilla`](https://github.com/yusufkocak1/kalem/tree/main/examples/cdn-vanilla)
— CI'da yedi tarayıcı testiyle sınanıyor; biri sayfadaki `<script>`
etiketlerini sayıyor.

Elemanın tüm yüzeyi: [Web Components](/frameworkler/web-components/).
