---
title: React
description: React 17+ ve Next.js App Router ile kullanım.
---

```bash
npm i @kalem/editor @kalem/ui @kalem/react
```

`@kalem/react` React'i `peerDependency` olarak alır ve kendisi ~1.5 kB'dır.
React'i kendi projeniz sağlar; Kalem kendi kopyasını getirmez.

## Kontrolsüz (önerilen)

```tsx
import { KalemEditor } from '@kalem/react';
import { toolbar, slashMenu, dragHandle } from '@kalem/ui';
import '@kalem/themes/default.css';

export function Yazi() {
  return (
    <KalemEditor
      defaultValue="# Merhaba"
      plugins={[toolbar(), slashMenu(), dragHandle()]}
      onChange={(md) => console.log(md)}
    />
  );
}
```

## Kontrollü

```tsx
const [md, setMd] = useState('# Merhaba');

<KalemEditor value={md} onChange={setMd} />
```

:::caution
Kontrollü modda her tuş vuruşunda üst bileşen yeniden render olur. Uzun
belgelerde kontrolsüz modu tercih edin ve değeri `onChange` ile bir ref'te
tutun.
:::

## Imperatif erişim

```tsx
import { useRef } from 'react';
import { KalemEditor, type KalemHandle } from '@kalem/react';

export function Duzenle() {
  const ref = useRef<KalemHandle>(null);

  return (
    <>
      <button onClick={() => ref.current?.exec('toggleMark', { mark: 'strong' })}>
        Kalın
      </button>
      <button onClick={() => navigator.clipboard.writeText(ref.current!.getValue())}>
        Markdown'ı kopyala
      </button>
      <KalemEditor ref={ref} defaultValue="# Merhaba" />
    </>
  );
}
```

## Next.js App Router

Editör tarayıcı API'lerine ihtiyaç duyar, bu yüzden istemci bileşenidir:

```tsx
'use client';
import { KalemEditor } from '@kalem/react';
```

Salt okunur içerik ise **sunucuda** render edilebilir — `@kalem/viewer`
tamamen DOM'suz çalışır:

```tsx
// sunucu bileşeni — 'use client' yok
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export default function Post({ markdown }: { markdown: string }) {
  return (
    <article
      className="kalem"
      dangerouslySetInnerHTML={{ __html: renderToString(parse(markdown)) }}
    />
  );
}
```

## Strict Mode ve temizlik

Sarmalayıcı `useEffect` temizliğinde `editor.destroy()` çağırır; React 18/19
Strict Mode'un çift-mount davranışıyla uyumludur.
