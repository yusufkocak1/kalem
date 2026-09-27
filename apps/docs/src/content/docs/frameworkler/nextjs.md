---
title: Next.js
description: App Router, sunucu/istemci sınırı ve "use client".
---

```bash
npm i @kalem-editor/react @kalem-editor/editor @kalem-editor/themes
```

Next.js yapılandırmasında Kalem'e ait **tek satır yok**: ne
`transpilePackages`, ne `dynamic(… { ssr: false })`.

## Sunucu/istemci sınırı

`app/page.tsx` bir **sunucu** bileşeni kalabiliyor:

```tsx
// app/page.tsx  — sunucu bileşeni
import { Duzenleyici } from './duzenleyici';

export default function Sayfa() {
  const belge = '# Merhaba\n\nSunucudan gelen metin.';
  return (
    <main>
      <h1>Belge</h1>
      <Duzenleyici baslangic={belge} />
    </main>
  );
}
```

```tsx
// app/duzenleyici.tsx  — istemci bileşeni
'use client';

import { KalemEditor } from '@kalem-editor/react';
import { useState } from 'react';

export function Duzenleyici({ baslangic }: { baslangic: string }) {
  const [metin, setMetin] = useState(baslangic);
  return <KalemEditor value={metin} onChange={setMetin} lang="tr" label="Belge" />;
}
```

## `"use client"` paketin içinde

`@kalem-editor/react` derleme çıktısında kendi `"use client"` yönergesini
taşıyor. Bu, gömen uygulamanın her sayfada hatırlaması gereken bir şeyi
ortadan kaldırıyor.

:::note[Bir kez sessizce bozulmuştu]
Yönerge kaynakta duruyordu ama paketleyici (rolldown) modülleri
birleştirirken onu atıyordu. Sonuç: bir sunucu bileşeni `<KalemEditor>`
import ettiğinde "useState yalnızca istemci bileşenlerinde çalışır"
hatası. Artık bant (banner) olarak yeniden yazılıyor ve örnek uygulama
bunu derleme çıktısından doğruluyor.
:::

## `useKalemValue` sunucuda patlamıyor

Kanca `useSyncExternalStore` üzerine kurulu ve React bu kancada
`getServerSnapshot` zorunlu tutuyor. Sarmalayıcı onu veriyor (başlangıç
metni), yani `'use client'` bir bileşen sunucuda **prerender** edilirken
hata çıkmıyor.

## Stil

```tsx
// app/layout.tsx
import '@kalem-editor/themes/tokens.css';
import '@kalem-editor/themes/viewer.css';
import '@kalem-editor/themes/editor.css';
import '@kalem-editor/themes/ui.css';
```

## Sunucuda Markdown → HTML

Editörü hiç yüklemeden, sunucu bileşeninde:

```tsx
import { parse } from '@kalem-editor/core';
import { renderToString } from '@kalem-editor/viewer';

export default function Yazi({ md }: { md: string }) {
  return <article className="kalem-doc kalem-theme"
                  dangerouslySetInnerHTML={{ __html: renderToString(parse(md)) }} />;
}
```

`renderToString` kendi kaçışını yapıyor ve URL beyaz listesinden geçiyor;
ham HTML varsayılan olarak kaçırılıyor. Ayrıntı ve `html: "allow"`
senaryosu: [Güvenlik](/rehber/guvenlik/).

Tam tarif: [Sunucuda Markdown](/tarifler/sunucuda-markdown/).

## Çalışan örnek

[`examples/nextjs`](https://github.com/yusufkocak1/kalem/tree/main/examples/nextjs)
— Next 16 App Router, CI'da üretim derlemesi yapılıp dört tarayıcı testiyle
sınanıyor.
