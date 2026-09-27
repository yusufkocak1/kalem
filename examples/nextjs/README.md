# `@kalem-editor/react` — Next.js App Router

```bash
pnpm --filter example-nextjs dev
```

Buradaki mesele **sunucu/istemci sınırı**:

- `app/page.tsx` bir **sunucu** bileşeni — belgenin metni sunucuda duruyor.
- `app/duzenleyici.tsx` istemci bileşeni; editörü o kuruyor.

`next.config` içinde Kalem'e ait tek satır yok: ne `transpilePackages`, ne
`dynamic(… { ssr: false })`. Paket kendi `"use client"` yönergesini
derleme çıktısında taşıdığı için bir sunucu bileşeni onu doğrudan import
edebiliyor.

`useKalemValue()` sunucuda da çağrılabiliyor: `getServerSnapshot`
başlangıç metnini döndürüyor, yani SSR render'ı patlamıyor.
