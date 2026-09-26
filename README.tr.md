# Kalem

*[English](README.md) · Türkçe*

> Word kadar kolay, Markdown kadar taşınabilir. Herhangi bir framework ile — ya da framework olmadan.

Framework-bağımsız, küçük ve modüler bir **WYSIWYG Markdown editör kütüphanesi**.
Yazılım bilmeyen kullanıcıların Word rahatlığında doküman yazabilmesi, geliştiricilerin
ise projelerine 0 bağımlılıkla gömebilmesi için tasarlanıyor.

**Durum:** v1.0 yayın hazırlığında. Çekirdek, görüntüleyici, editör, Word
benzeri arayüz, yedi eklenti ve üç sarmalayıcı (`@kalem/react`,
`@kalem/vue`, `@kalem/wc`) çalışıyor; doküman sitesi, playground ve duyuru
materyalleri hazır. Henüz npm'de değil. Görev görev durum:
[iş listesi](docs/01-is-listesi.md).

![Başlık yazmak, balon araç çubuğuyla kalın yapmak, slash menüsünden liste eklemek ve blok sürüklemek — sağdaki Markdown her tuşta güncelleniyor](docs/duyuru/demo.gif)

---

## Bu depoda şu an ne var

| Yol | Ne |
|---|---|
| [docs/00-analiz.md](docs/00-analiz.md) | Teknik analiz ve mimari karar dokümanı — rakip analizi, 10 mimari karar, risk matrisi |
| [docs/01-is-listesi.md](docs/01-is-listesi.md) | Faz faz, görev görev v1.0 yol haritası (7 faz, ~60 görev) |
| [packages/core/](packages/core/) | **Çalışan** Markdown ayrıştırıcı + serileştirici. 0 bağımlılık, DOM'suz. |
| [packages/viewer/](packages/viewer/) | **Çalışan** `renderToDOM` + `renderToString`. `innerHTML` hiç kullanılmıyor. |
| [packages/editor/](packages/editor/) | **Çalışan** blok motoru: seçim, klavye, biçimlendirme, geri alma, giriş kuralları, pano, eklentiler |
| [packages/ui/](packages/ui/) | **Çalışan** Word deneyimi: balon araç çubuğu, slash menü, blok tutamağı, bağlantı balonu |
| [packages/plugin-*/](packages/) | Yedi eklenti: görsel yükleme, kod vurgulama, ara-değiştir, içindekiler, kelime sayacı, kaynak kipi, otomatik kaydetme |
| [packages/react/](packages/react/) · [vue/](packages/vue/) · [wc/](packages/wc/) | Sarmalayıcılar — ve `<kalem-editor>` özel elemanı (sarmalayıcı gerektirmeyen yol) |
| [packages/themes/](packages/themes/) | Saf CSS: görüntüleyici tipografisi ve editör katmanı |
| [examples/](examples/) | Yedi çalışan uygulama: React, Next.js, Vue, Nuxt, Svelte, Angular, düz HTML — hepsi CI'da derleniyor |
| [apps/notlar/](apps/notlar/) | **Kalem Notlar** — kütüphanenin kendi kullanım denemesi (dogfooding): yerel not defteri, altı eklenti bir arada |
| [apps/playground/](apps/playground/) | **Playground** — ürünün vitrini: Word deneyimi, canlı Markdown çıktısı, Word'den yapıştırma, bin bloklu belge |
| [apps/demo/](apps/demo/) | Beş canlı sayfa (aşağıda) + Faz 0 mimari prototipi |
| [apps/docs/](apps/docs/) | Astro Starlight dokümantasyon sitesi — anlattığı her API'nin gerçekten var olduğunu `guard:docs` sınıyor |
| [docs/02-faz0-sonuc.md](docs/02-faz0-sonuc.md) | Faz 0 sonuç raporu — ne kuruldu, ne doğrulandı, ne kapsanmadı |

Birim testleri, üç motorda (Chromium · Firefox · WebKit) ve iki mobil
benzetimde tarayıcı testleri, yedi örnek uygulamanın derleme testleri —
hepsi CI'da ve Türkçe yerel ayar altında koşuyor.

## Kararlar

| Konu | Karar |
|---|---|
| Editör motoru | Kendi **blok-tabanlı** motorumuz — her blok ayrı `contenteditable`. 0 runtime bağımlılığı. |
| Doğru kaynak | **Markdown metni**, JSON değil. `serialize(parse(md)) === md` |
| Framework | Vanilla çekirdek + ayrı sarmalayıcı paketler (`peerDependency`). Vue projesine React sızmaz. |
| Boyut bütçesi | `core` 14 kB · `viewer` 14 kB · `editor+ui` 58 kB (min+gzip), CI'da zorlanır. Bugünkü ölçüler [doküman sitesinde](apps/docs/src/content/docs/mimari.md). |
| Tablo | v1 dışı — parser korur, düzenleme UI'ı v1.1 |
| Mobil | v1'de "çalışır ama optimize değil" |
| Yayın | Sessiz geliştirme, tek duyuru ile v1.0 |
| Lisans | MIT |

## Paketler

```
@kalem/core      AST, parser, serializer          — 0 bağımlılık, DOM'suz
@kalem/viewer    render (DOM + SSR string)        — salt okunur
@kalem/editor    blok motoru, seçim, geçmiş       — başsız
@kalem/ui        balon araç çubuğu, slash, drag   — Word deneyimi
@kalem/react     @kalem/vue     @kalem/wc         — sarmalayıcılar
@kalem/plugin-*  görsel, kod vurgulama, ara-değiştir, içindekiler,
                 kelime sayacı, kaynak kipi, otomatik kaydetme
@kalem/themes    saf CSS: açık, koyu, yalın
```

## Geliştirme

```bash
pnpm install
pnpm verify      # lint + tip + test + build + kapılar + boyut + publint
```

Node ≥ 20 (önerilen 22, `.nvmrc`), pnpm 10.

### Koruyucu kapılar

| Komut | Ne korur |
|---|---|
| `pnpm guard:purity` | Çekirdekte 3rd-party bağımlılık ve framework sızıntısı yok; `core` DOM'a dokunmuyor |
| `pnpm guard:locale` | Çıplak `toLowerCase` / `toUpperCase` / tek argümanlı `localeCompare` yok |
| `pnpm size` | Boyut bütçeleri — aşım = build kırmızı |
| `pnpm guard:sizes` | Belgelerde yazan her boyut bugünkü ölçümle aynı mı |
| `pnpm guard:selftest` | **Kapıların kendisi hâlâ ihlalleri yakalıyor mu** |

Ayrıntı: [CONTRIBUTING.tr.md](CONTRIBUTING.tr.md)

## Denemek

```bash
pnpm build && pnpm demo     # http://localhost:5173
```

| Sayfa | Ne gösterir |
|---|---|
| `/editor.html` | **`@kalem/editor`** — blok motoru: her blok kendi `contenteditable` elemanı, yazdıkça sağda gerçek Markdown çıktısı. |
| `/viewer.html` | **`@kalem/viewer`** — aynı AST'nin `renderToDOM` ve `renderToString` çıktıları yan yana, byte-birebir eşitlik ölçümüyle. Ham HTML politikası canlı değiştirilebilir. |
| `/core.html` | **`@kalem/core`** — Markdown → AST → Markdown, canlı gidiş-dönüş ve idempotans ölçümü. |
| `/wc.html` | **`@kalem/wc`** — `<kalem-editor>` özel elemanı: ışık DOM, gölge DOM ve `ElementInternals` ile form entegrasyonu yan yana. |
| `/olcum.html` | **Performans ölçüm tezgâhı** — `pnpm olcum` buradan sürüyor: boyut boyut tuş gecikmesi, kuruluş süresi ve sızıntı döngüsü. |
| `/` | Mimari doğrulama prototipi (`execCommand` ile; kütüphaneyi kullanmıyor) |

İlk ikisi gerçek derlenmiş bundle'ı yükler — npm'e gidecek kodun aynısı.

Aynı Wi-Fi'daki telefondan da açılır — mobil davranışı denemek için
(F1.5-02 matrisi) sunucu `0.0.0.0`'ı dinliyor.

`/` sayfası Faz 0'da yazılmış, kütüphaneyi kullanmayan bir prototip.
Ürünün vitrini [`apps/playground`](apps/playground/):

```bash
pnpm build && pnpm --filter kalem-playground dev
```

## Doküman sitesini çalıştırmak

```bash
pnpm install
pnpm docs:dev        # http://localhost:4321
```

## Duyuru materyalleri

README GIF'i, demo videosu, sosyal önizleme görseli ve Show HN / dev.to
taslakları [`docs/duyuru/`](docs/duyuru/) altında; nasıl yeniden
üretildikleri oradaki README'de.

## Lisans

MIT
