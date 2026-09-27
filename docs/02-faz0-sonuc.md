# Faz 0 — Sonuç Raporu

> Tarih: 2026-09-08 · Durum: **tamamlandı, `pnpm verify` yeşil**
> İlgili: [00-analiz.md](./00-analiz.md) · [01-is-listesi.md](./01-is-listesi.md)

Faz 0'ın amacı kod yazmak değil, **yanlış yapmayı zorlaştıran bir iskelet**
kurmaktı. Bu doküman ne kuruldu, hangi kararlar alındı ve neyin gerçekten
doğrulandığını kaydeder.

---

## 1. Doğrulanan çıkış kriteri

```
pnpm verify
  → lint (Biome + locale kapısı)   ✓
  → typecheck (tsc --build)        ✓
  → test (Vitest)                  ✓  1/1
  → build (tsdown × 4 paket)       ✓  ESM + CJS + .d.ts + .d.cts
  → guard:purity                   ✓  4 paket temiz
  → size                           ✓  4 bütçe altında
  → publint                        ✓  0 uyarı

pnpm attw          ✓  node10 / node16-CJS / node16-ESM / bundler — hepsi yeşil
pnpm guard:selftest ✓  10/10 — kapılar ihlalleri gerçekten yakalıyor
pnpm e2e            ✓  2/2 (chromium)
pnpm test:cov       ✓  core eşiği (%90) uygulanıyor ve ısırıyor
```

Bunların hiçbiri "yazıldı, muhtemelen çalışır" değil — hepsi bu makinede
koşturuldu.

---

## 2. Kurulan yapı

```
kalem/
├── packages/                 ← YAYIMLANIR (npm)
│   ├── core/                 @kalem-editor/core     0 bağımlılık, DOM'suz
│   ├── viewer/               @kalem-editor/viewer   → core
│   ├── editor/               @kalem-editor/editor   → core
│   └── ui/                   @kalem-editor/ui       → core, editor
├── apps/                     ← YAYIMLANMAZ (private: true)
│   ├── demo/                 mimari doğrulama prototipi
│   └── docs/                 Astro Starlight doküman sitesi
├── docs/                     analiz, yol haritası, bu rapor
├── scripts/                  koruyucu kapılar + demo sunucusu
├── e2e/                      Playwright testleri
└── .github/workflows/ci.yml  3 iş: doğrulama · paket · tarayıcı
```

Paketlerin hepsi şu an **yer tutucu** — her biri tek satır export içeriyor.
Bu bilinçli: hattın uçtan uca çalıştığını kanıtlamak için yeterli, kütüphane
kodu Faz 1'de geliyor.

---

## 3. Alınan teknik kararlar

| Konu | Karar | Gerekçe |
|---|---|---|
| Paket yöneticisi | pnpm 10.18.2 + workspace `catalog:` | Sürüm tek yerde; paketler arası kayma imkânsız |
| TypeScript | **7.0.2** (Go portu) | Greenfield proje, tip denetimi belirgin ölçüde hızlı. `tsc --build` + project references sorunsuz çalıştı |
| Build | **tsdown 0.23** (rolldown) | tsup'tan hızlı, ESM+CJS+dts tek geçişte. TS7 API'si için "deneysel" uyarısı veriyor ama doğru çıktı üretiyor |
| Lint/format | Biome 2.5 | ESLint+Prettier yerine tek araç, tek bağımlılık |
| Test | Vitest 5 + Playwright 1.63 | — |
| Boyut | size-limit 13 (esbuild preset) | — |

### TypeScript 7 seçimi — bilinen bedel

tsdown her build'de şu uyarıyı veriyor:

```
WARN TypeScript 7.0 does not yet have a stable API and is experimental.
```

Çıktı doğru (attw dört çözümleme modunda da yeşil), ama bu bir bağımlılık
riski. **Geri dönüş yolu açık:** `pnpm-workspace.yaml` içindeki catalog'da
`typescript: ^7.0.2` satırını `^5.9.0` yapmak yeterli — başka hiçbir yer
değişmez. Faz 1'de dts üretiminde sorun çıkarsa maliyet bir satır.

`apps/docs` zaten TypeScript 5.9'da tutuluyor (Astro'nun peer aralığı henüz
7'yi kapsamıyor). pnpm izole `node_modules` sayesinde ikisi yan yana yaşıyor.

### tsc çıktısı `dist/`'e karışmıyor

`composite: true` gerektiği için `tsc --build` emit yapar. Bu çıktı
`.tsbuild/` altına alındı; `dist/` yalnızca tsdown'a ait. Böylece saflık
kapısı ve size-limit **her zaman gerçek yayın çıktısını** denetler, tsc'nin
ara ürününü değil.

---

## 4. Koruyucu kapılar

Analiz iki kapı öngörüyordu; **üç** kuruldu.

### Kapı 1 — Saflık (`pnpm guard:purity`)

`packages/{core,viewer,editor,ui}` için denetler:

- `dependencies` yalnızca `@kalem-editor/*` içerebilir — 3rd-party yasak
- `peerDependencies` boş olmalı
- Üretim bundle'ında `react` / `react-dom` / `preact` / `vue` / `svelte` /
  `solid-js` import'u olamaz
- **`core` bundle'ı** `document` / `window` / `navigator` / `localStorage` /
  `sessionStorage` / `HTMLElement` kullanamaz (SSR güvenliği)
- Yayın hijyeni: `sideEffects: false`, `exports` haritası, `license: MIT`

**Çift savunma:** `packages/core/tsconfig.json` içinde `lib`, DOM tiplerini
*içermiyor*. Yani core'da `document` yazmak derleme zamanında da hata verir.
Runtime kapısı, tip sisteminden kaçan durumlar (dinamik erişim, `globalThis`)
için ikinci hat.

### Kapı 2 — Boyut (`pnpm size`)

| Hedef | Bütçe | Şu an |
|---|---|---|
| `@kalem-editor/core` | 12 kB | 115 B |
| `@kalem-editor/viewer` | 14 kB | 117 B |
| `@kalem-editor/editor` (core dahil) | 38 kB | 116 B |
| `@kalem-editor/editor` + `@kalem-editor/ui` | 58 kB | 115 B |

Bütçeler analiz §5.6'daki tablodan. Şu anki değerler yer tutucu kodun boyutu —
anlamlı değil, ama **hat çalışıyor**. Faz 1'den itibaren her PR'da gerçek
rakam görünecek.

### Kapı 3 — Locale (`pnpm guard:locale`) ⭐

Analizdeki iki kapıya ek olarak kuruldu. Yasakladıkları:

| Yasak | Yerine | Türkçe'de ne olur |
|---|---|---|
| `.toLowerCase()` | `.toLocaleLowerCase(lang)` | `"Işık"` → `"işık"` ✗ |
| `.toUpperCase()` | `.toLocaleUpperCase(lang)` | `"iyi"` → `"IYI"` ✗ |
| `.localeCompare(x)` | `.localeCompare(x, lang)` | Sıralama yanlış |
| `new Intl.Collator()` | `new Intl.Collator(lang)` | Sıralama yanlış |

Script yorumları ve string literal'lerini maskeleyerek tarar — yani
`// eskiden .toLowerCase() vardı` yanlış alarm üretmez. Kaçış:
`// kalem-locale-ok: <sebep>`.

**Neden ayrı bir kapı hak etti:** bu çağrılar Türkçe'de patlamaz, *sessizce
yanlış sonuç verir*. İngilizce yazılmış bir test asla yakalamaz. Tek güvenilir
savunma derleme zamanı.

Playwright de varsayılan olarak `locale: "tr-TR"` altında koşuyor; CI ise
`LANG=tr_TR.UTF-8` ile. Yani locale'e duyarlı hatalar için Türkçe **varsayılan
test ortamı**, sonradan eklenen bir kontrol değil.

### Kapıların öz-testi (`pnpm guard:selftest`)

> "Kasıtlı olarak React import eden bir dal CI'ı kırıyor" — F0-07 kabul kriteri

Bunu iddia etmek yetmez. `guard-selftest.mjs` geçici bir sahte workspace kurup
içine kasıtlı ihlaller koyuyor ve kapıların gerçekten kırmızıya döndüğünü
doğruluyor:

```
SAFLIK KAPISI ÖZ-TESTİ
  ✓ temiz workspace geçiyor
  ✓ react bağımlılığı beyan eden dal KIRILIYOR
  ✓ bundle'da react import'u olan dal KIRILIYOR
  ✓ core'da document kullanan dal KIRILIYOR
  ✓ core'a peerDependency ekleyen dal KIRILIYOR

LOCALE KAPISI ÖZ-TESTİ
  ✓ locale duyarlı kod geçiyor
  ✓ çıplak toLowerCase KIRILIYOR
  ✓ tek argümanlı localeCompare KIRILIYOR
  ✓ kalem-locale-ok kaçışı çalışıyor
  ✓ yorum ve string içi eşleşme sayılmıyor

10 geçti, 0 başarısız
```

Bir regex kayması ya da yol değişikliği kapıyı sessizce etkisizleştirirse
burada yakalanır. Kapının kendisi de test edilmezse, kapı değildir.

---

## 5. Yol boyunca çözülen iki sorun

**Python `http.server` charset yollamıyordu.** Türkçe karakterler bozuluyordu
(`Editör` → `EditÃ¶r`). Yerine `scripts/serve-demo.mjs` yazıldı — sıfır
bağımlılık, `charset=utf-8` açıkça set ediliyor. Playwright'ın duman testi
artık bunu regresyon olarak koruyor: sayfa başlığı ve gövdedeki Türkçe metin
doğrulanıyor.

**publint `engines.node` istedi.** Dört pakete `>=18` eklendi — `@kalem-editor/core`
sunucuda da çalışacağı için bu alan gerçekten anlamlı, susturma değil.

---

## 6. Faz 0'ın kapsamadıkları

Dürüst olmak gerekirse:

- **Sarmalayıcı paketler yok.** `@kalem-editor/react`, `@kalem-editor/vue`, `@kalem-editor/wc`
  Faz 5'te geliyor. Saflık kapısı bunları henüz denetlemiyor çünkü henüz
  yoklar — kapının `CEKIRDEK` listesi o zaman genişletilmeli.
- **Boyut rakamları anlamsız.** Yer tutucu kod ölçülüyor. Bütçelerin gerçekten
  tutup tutmadığı Faz 1–3'te belli olacak; özellikle `editor + ui` 58 kB
  hedefi iddialı.
- **CI hiç koşmadı.** `.github/workflows/ci.yml` yazıldı ama repo henüz bir
  GitHub uzağına bağlı değil. Adımların hepsi yerelde tek tek doğrulandı;
  yine de ilk push'ta YAML düzeyinde sürpriz çıkabilir.
- **`apps/docs` build edilmedi.** Astro sitesi kuruldu ama `pnpm docs:build`
  hiç çalıştırılmadı.
- **Değişiklik günlüğü boş.** Changesets kuruldu, ilk changeset Faz 1'in ilk
  PR'ında yazılacak.

---

## 7. Sırada ne var

**F1.5 spike'ı Faz 1'den önce koşulmalı.** İş listesindeki sıra F1 → F1.5 ama
prototip zaten elde; `F1.5-02`'deki riskli senaryo matrisini (Safari, iOS,
Android, IME, çapraz blok seçim) doldurmak bir öğle sonrası alır ve **beş
haftalık F1 yatırımından önce** mimari kararı doğrular ya da yalanlar.

Aksi hâlde doğrudan **F1-01 · AST tip tanımları** ile başlanır.
