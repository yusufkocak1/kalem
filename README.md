# Kalem

> Word kadar kolay, Markdown kadar taşınabilir. Herhangi bir framework ile — ya da framework olmadan.

Framework-bağımsız, küçük ve modüler bir **WYSIWYG Markdown editör kütüphanesi**.
Yazılım bilmeyen kullanıcıların Word rahatlığında doküman yazabilmesi, geliştiricilerin
ise projelerine 0 bağımlılıkla gömebilmesi için tasarlanıyor.

**Durum: 53 / 72 görev (%74).** Çekirdek, görüntüleyici, editör, arayüz ve
yedi eklenti tamam. Sarmalayıcılardan `@kalem/react`, `@kalem/vue` ve
`@kalem/wc` (`<kalem-editor>` özel elemanı) çalışıyor; altı örnek uygulama
CI'da derlenip sınanıyor. Sırada kalan örnekler ve dogfooding.
Henüz npm'de değil; ilk yayın v1.0 olacak.

---

## Bu depoda şu an ne var

| Yol | Ne |
|---|---|
| [docs/00-analiz.md](docs/00-analiz.md) | Teknik analiz ve mimari karar dokümanı — rakip analizi, 10 mimari karar, risk matrisi |
| [docs/01-is-listesi.md](docs/01-is-listesi.md) | Faz faz, görev görev v1.0 yol haritası (7 faz, ~60 görev) |
| [packages/core/](packages/core/) | **Çalışan** Markdown ayrıştırıcı + serileştirici. 0 bağımlılık, DOM'suz. |
| [packages/viewer/](packages/viewer/) | **Çalışan** `renderToDOM` + `renderToString`. `innerHTML` hiç kullanılmıyor. |
| [packages/editor/](packages/editor/) | **Çalışan** blok motoru: seçim, klavye, biçimlendirme, geri alma, giriş kuralları, pano, eklentiler |
| [packages/themes/](packages/themes/) | Saf CSS: görüntüleyici tipografisi ve editör katmanı |
| [apps/demo/](apps/demo/) | Üç canlı sayfa (aşağıda) + Faz 0 mimari prototipi |
| [apps/docs/](apps/docs/) | Astro Starlight dokümantasyon sitesi (planlanan API'yi dokümante eder) |
| [docs/02-faz0-sonuc.md](docs/02-faz0-sonuc.md) | Faz 0 sonuç raporu — ne kuruldu, ne doğrulandı, ne kapsanmadı |

**881 birim testi** + **369 tarayıcı testi** (Chromium · Firefox · WebKit).
`serialize(parse(md)) === md` gidiş-dönüş 17/17 byte-birebir;
`renderToDOM` ile `renderToString` çıktıları üç motorda byte-birebir aynı.

## Kararlar

| Konu | Karar |
|---|---|
| Editör motoru | Kendi **blok-tabanlı** motorumuz — her blok ayrı `contenteditable`. 0 runtime bağımlılığı. |
| Doğru kaynak | **Markdown metni**, JSON değil. `serialize(parse(md)) === md` |
| Framework | Vanilla çekirdek + ayrı sarmalayıcı paketler (`peerDependency`). Vue projesine React sızmaz. |
| Boyut | `core` 12 kB · `viewer` 14 kB · `editor+ui` 58 kB (min+gzip), CI'da zorlanır |
| Tablo | v1 dışı — parser korur, düzenleme UI'ı v1.1 |
| Mobil | v1'de "çalışır ama optimize değil" |
| Yayın | Sessiz geliştirme, tek duyuru ile v1.0 |
| Lisans | MIT |

## Planlanan paketler

```
@kalem/core      AST, parser, serializer          — 0 bağımlılık, DOM'suz
@kalem/viewer    render (DOM + SSR string)        — salt okunur
@kalem/editor    blok motoru, seçim, geçmiş       — başsız
@kalem/ui        balon araç çubuğu, slash, drag   — Word deneyimi
@kalem/react     @kalem/vue     @kalem/wc         — sarmalayıcılar
@kalem/plugin-*  görsel, kod, tablo, ara-değiştir, TOC, autosave
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
| `pnpm size` | Boyut bütçeleri — şu an `core` 11.51/12 · `viewer` 2.68/14 · `editor` 21.85/38 kB |
| `pnpm guard:selftest` | **Kapıların kendisi hâlâ ihlalleri yakalıyor mu** |

Ayrıntı: [CONTRIBUTING.md](CONTRIBUTING.md)

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
| `/` | Mimari doğrulama prototipi (`execCommand` ile; kütüphaneyi kullanmıyor) |

İlk ikisi gerçek derlenmiş bundle'ı yükler — npm'e gidecek kodun aynısı.

Aynı Wi-Fi'daki telefondan da açılır — mobil davranışı denemek için
(F1.5-02 matrisi) sunucu `0.0.0.0`'ı dinliyor.

`/` sayfası Faz 0'da yazılmış, kütüphaneyi kullanmayan bir prototip: sürükleme,
balon araç çubuğu, slash menü ve Word yapıştırma orada denenebilir. Bunların
kütüphane karşılığı Faz 3'te gelecek.

## Doküman sitesini çalıştırmak

```bash
pnpm install
pnpm docs:dev        # http://localhost:4321
```

## Sonraki adım

[İş listesindeki](docs/01-is-listesi.md) **Faz 3 — Word deneyimi**
(`@kalem/ui`): balon araç çubuğu, slash menü, blok sürükleme, yapıştırma
boru hattı. Ürünün kalbi.

## Lisans

MIT
