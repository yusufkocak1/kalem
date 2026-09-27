# Katkı Rehberi

*[English](CONTRIBUTING.md) · Türkçe*

## Kurulum

```bash
pnpm install
pnpm verify     # lint + tip + test + build + kapılar + boyut + publint
```

Node ≥ 20 (geliştirme için 22 önerilir, `.nvmrc`), pnpm 10.

## Depo yapısı

| Yol | Ne | Yayımlanır mı |
|---|---|---|
| `packages/*` | Kütüphanenin kendisi | **Evet** — npm'e |
| `apps/demo` | Mimari doğrulama prototipi | Hayır |
| `apps/docs` | Astro Starlight doküman sitesi | Hayır |
| `docs/` | Analiz ve yol haritası | Hayır |
| `scripts/` | Koruyucu kapılar ve yardımcılar | Hayır |

`apps/*` altındaki her şey `private: true`. Astro, sharp gibi ağır araçlar
yalnızca burada yaşar; **kullanıcının `node_modules`'ına asla girmezler.**

## Pazarlıksız kurallar

Bunlar projenin var oluş sebebi. CI bunları otomatik zorlar, tartışmaya açık değildir.

### 1. Çekirdek paketlerde 3rd-party bağımlılık yok

`packages/{core,viewer,editor,ui}` yalnızca birbirlerine bağımlı olabilir.
Bir yardımcı kütüphaneye ihtiyacın varsa: kodu içeri al, ya da opsiyonel bir
eklenti paketine taşı.

`pnpm guard:purity` bunu denetler.

### 2. Framework sızıntısı yok

Üretim bundle'ında `react` / `vue` / `preact` / `svelte` izi olamaz.
Kullanıcının Vue projesine React girmemesi bu kütüphanenin temel vaadi.

Framework bağı yalnızca `@kalem-editor/react`, `@kalem-editor/vue` sarmalayıcılarında,
`peerDependencies` olarak bulunur.

### 3. `@kalem-editor/core` DOM'a dokunmaz

Core sunucuda (SSR, Node, worker) çalışabilmeli. `document`, `window`,
`navigator`, `localStorage` core'da yasak — tip düzeyinde de engelli
(`packages/core/tsconfig.json` içinde `lib`, DOM içermez).

### 4. Locale duyarlılığı ⭐

Çıplak `toLowerCase()`, `toUpperCase()`, tek argümanlı `localeCompare()` **yasak.**

```js
"Işık".toLowerCase()              // → "işık"  ✗  Türkçe'de yanlış
"Işık".toLocaleLowerCase("tr")    // → "ışık"  ✓
"iyi".toUpperCase()               // → "IYI"   ✗
"iyi".toLocaleUpperCase("tr")     // → "İYİ"   ✓
```

Bu çağrılar **patlamaz, sessizce yanlış sonuç verir** — İngilizce yazılmış
testler asla yakalamaz. Bu yüzden derleme zamanında engellenirler.

Gerçekten locale'den bağımsız bir karşılaştırma gerekiyorsa (protokol adı,
HTML etiketi, dosya uzantısı) satıra gerekçesini yaz:

```js
const proto = url.toLowerCase(); // kalem-locale-ok: URL şeması ASCII
```

`pnpm guard:locale` bunu denetler.

### 5. Boyut bütçesi

| Paket | Bütçe (min+gzip) |
|---|---|
| `@kalem-editor/core` | 14 kB |
| `@kalem-editor/viewer` | 14 kB |
| `@kalem-editor/editor` (core dahil) | 38 kB |
| `@kalem-editor/editor` + `@kalem-editor/ui` | 58 kB |

`pnpm size` bunu denetler. Bütçe aşımı build'i kırar — bütçeyi yükseltmek
bir karardır, PR'da gerekçelendirilmelidir.

Belgelerde yazan boyutlar (README, doküman sitesi, duyuru metinleri)
`pnpm guard:sizes` ile ölçüme karşı denetlenir. Paket büyüdüyse
`node scripts/guard-sizes.mjs --fix` sayıları biçimini koruyarak günceller.

### 6. Dil: kod Türkçe, geliştiriciye görünen İngilizce

Kaynak kodun yorumları, değişken adları, commit mesajları ve `docs/` Türkçe.
Ama **geliştiricinin konsoluna düşen her şey İngilizce**: fırlatılan hata
mesajları (`throw new Error(...)`), `must()` etiketleri ve konsol uyarıları.
Kütüphane uluslararası yayımlanıyor; Türkçe bilmeyen geliştirici hatayı
okuyabilmeli.

Kullanıcıya görünen arayüz metni ise bunların hiçbiri değil: o her zaman
sözlükten gelir (`labels.ts`), belgenin diline göre.

## Koruyucu kapılar bozulursa

```bash
pnpm guard:selftest
```

Kapıların hâlâ ihlalleri yakaladığını doğrular. Bu test kırmızıysa kapılar
artık hiçbir şeyi korumuyor demektir — önce onu düzelt.

## Changeset

Davranış değiştiren her PR bir changeset içermeli:

```bash
pnpm changeset
```

## Kod stili

Biome. `pnpm format` her şeyi düzeltir. Tartışma yok, araç karar verir.
