# Kalem

> Word kadar kolay, Markdown kadar taşınabilir. Herhangi bir framework ile — ya da framework olmadan.

Framework-bağımsız, küçük ve modüler bir **WYSIWYG Markdown editör kütüphanesi**.
Yazılım bilmeyen kullanıcıların Word rahatlığında doküman yazabilmesi, geliştiricilerin
ise projelerine 0 bağımlılıkla gömebilmesi için tasarlanıyor.

**Durum: Faz 0 tamamlandı — iskelet ve koruyucu kapılar ayakta, kütüphane kodu Faz 1'de.**
Henüz npm'de değil.

---

## Bu depoda şu an ne var

| Yol | Ne |
|---|---|
| [docs/00-analiz.md](docs/00-analiz.md) | Teknik analiz ve mimari karar dokümanı — rakip analizi, 10 mimari karar, risk matrisi |
| [docs/01-is-listesi.md](docs/01-is-listesi.md) | Faz faz, görev görev v1.0 yol haritası (7 faz, ~60 görev) |
| [apps/demo/index.html](apps/demo/index.html) | Çalışan mimari doğrulama prototipi — [canlı](https://claude.ai/code/artifact/12236fdb-f13a-4c35-aafa-c073672dce8e) |
| [apps/docs/](apps/docs/) | Astro Starlight dokümantasyon sitesi (planlanan API'yi dokümante eder) |
| [docs/02-faz0-sonuc.md](docs/02-faz0-sonuc.md) | Faz 0 sonuç raporu — ne kuruldu, ne doğrulandı, ne kapsanmadı |
| [packages/](packages/) | Dört paket iskeleti — build/tip/test/boyut hattı uçtan uca çalışıyor |

`packages/*` içindeki dosyalar şu an **yer tutucu**: her paket tek satır export
içeriyor. Hattın çalıştığını kanıtlamaya yeter; gerçek kod Faz 1'de gelir.

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
| `pnpm size` | Boyut bütçeleri (12 / 14 / 38 / 58 kB) |
| `pnpm guard:selftest` | **Kapıların kendisi hâlâ ihlalleri yakalıyor mu** |

Ayrıntı: [CONTRIBUTING.md](CONTRIBUTING.md)

## Prototipi denemek

```bash
pnpm build && pnpm demo     # http://localhost:5173
```

| Sayfa | Ne gösterir |
|---|---|
| `/viewer.html` | **`@kalem/viewer`** — aynı AST'nin `renderToDOM` ve `renderToString` çıktıları yan yana, byte-birebir eşitlik ölçümüyle. Ham HTML politikası canlı değiştirilebilir. |
| `/core.html` | **`@kalem/core`** — Markdown → AST → Markdown, canlı gidiş-dönüş ve idempotans ölçümü. |
| `/` | Mimari doğrulama prototipi (`execCommand` ile; kütüphaneyi kullanmıyor) |

İlk ikisi gerçek derlenmiş bundle'ı yükler — npm'e gidecek kodun aynısı.

Aynı Wi-Fi'daki telefondan da açılır — mobil davranışı denemek için
(F1.5-02 matrisi) sunucu `0.0.0.0`'ı dinliyor.

Deneyin: bir bloğu `⠿` tutamacından sürükleyin · metin seçip balon araç çubuğunu
görün · boş satırda `/` yazın · `## ` yazıp başlığa dönüşmesini izleyin ·
**"Word'den yapıştır"** butonuyla kirli Word HTML'inin temizlenişini görün.

## Doküman sitesini çalıştırmak

```bash
pnpm install
pnpm docs:dev        # http://localhost:4321
```

## Sonraki adım

[İş listesindeki](docs/01-is-listesi.md) **F1.5 spike'ı** — prototip üzerinde
riskli senaryo matrisi (Safari, iOS, Android, IME, çapraz blok seçim), ardından
**Faz 1** ile `@kalem/core`: AST, ayrıştırıcı, serileştirici.

## Lisans

MIT
