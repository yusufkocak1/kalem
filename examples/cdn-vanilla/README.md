# `@kalem/wc` — tek `<script>`, derleme yok

```bash
pnpm build && pnpm --filter example-cdn-vanilla dev
```

Bu örnekte **derleme adımı, paketleyici, import haritası ve yazılmış
JavaScript yok**. Sayfanın tamamı budur:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/tokens.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/viewer.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/editor.css">

<kalem-editor label="Belge">
    # Merhaba
</kalem-editor>

<script src="https://cdn.jsdelivr.net/npm/@kalem/wc/dist/kalem-editor.iife.js"></script>
```

Script IIFE: editörün ve çekirdeğin tamamı içinde (26,7 kB gzip) ve eleman
kendiliğinden kaydoluyor. Modül girişlerinde kayıt açık bir çağrı, çünkü
aynı sayfada iki sürüm bulunan bir uygulamayı patlatmamak gerekiyor;
burada beklenti tersine — ama çağrı yine tekrarlanabilir, script iki kez
eklenirse hata vermiyor.

Başlangıç metni elemanın **içinden** okunuyor. Ortak girinti sökülüyor,
yoksa sayfasını düzgün biçimlendiren herkesin belgesi Markdown'da kod
bloğuna dönerdi.

Formdaki editörün `name`'i var ve Gönder'e basınca metin adres çubuğunda
görünüyor — arada JavaScript yok, `ElementInternals` var.

> Paketler henüz npm'de olmadığı için `kur.mjs` aynı dosyaları derlenmiş
> paket çıktısından `dist/`e kopyalıyor. Sınanan şey npm'e gidecek olanın
> aynısı; değişen tek şey adres.
