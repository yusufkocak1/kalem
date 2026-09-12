# Örnek uygulamalar

Her biri **çalışan, kopyalanabilir** bir uygulama: kendi `package.json`'ı,
kendi derlemesi, Kalem'e özel hiçbir derleme hilesi yok. Hepsi CI'da
derleniyor ve tarayıcıda sınanıyor (`pnpm e2e:examples`).

| Örnek | Paket | Öne çıkan |
|---|---|---|
| [`react-vite`](react-vite/) | `@kalem/react` | Kontrollü/kontrolsüz kip, `useKalem`, `useKalemValue`, Strict Mode |
| [`nextjs`](nextjs/) | `@kalem/react` | App Router; paket kendi `"use client"` yönergesini taşıyor |
| [`vue-vite`](vue-vite/) | `@kalem/vue` | `v-model`, `provide`/`inject` |
| [`nuxt`](nuxt/) | `@kalem/vue` | SSR — **`<ClientOnly>` gerekmiyor**, belge sunucuda çiziliyor |
| [`svelte`](svelte/) | `@kalem/wc` | Sarmalayıcı yok; özel eleman özellik/olay köprüsü |
| [`angular`](angular/) | `@kalem/wc` | Sarmalayıcı yok; `CUSTOM_ELEMENTS_SCHEMA`, zonesiz |
| [`cdn-vanilla`](cdn-vanilla/) | `@kalem/wc` | **Tek `<script>`**, derleme yok, yazılmış JavaScript yok |

## Çalıştırmak

Örnekler paketlerin **yayımlanacak çıktısını** tüketiyor; kaynağa takma ad
verilmiyor. Bu yüzden önce paketler derleniyor:

```bash
pnpm install
pnpm build                     # paketler
pnpm --filter example-svelte dev
```

Hepsini derlemek ve sınamak:

```bash
pnpm build:examples
pnpm e2e:examples              # derlemeyi kendisi de çalıştırıyor
```

## Neden yedi tane

Üçü sarmalayıcıları sınıyor (`@kalem/react`, `@kalem/vue`), dördü
sarmalayıcı **olmadan** çalıştığını. Bir kütüphanenin "framework-bağımsız"
sözü, ancak bağımsızlığın ölçüldüğü yerde bir şey ifade ediyor.
