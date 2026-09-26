---
title: Next.js
description: The App Router, the server/client boundary and "use client".
---

```bash
npm i @kalem/react @kalem/editor @kalem/themes
```

There's **not a single line** for Kalem in the Next.js configuration: no
`transpilePackages`, no `dynamic(… { ssr: false })`.

## The server/client boundary

`app/page.tsx` can stay a **server** component:

```tsx
// app/page.tsx  — server component
import { DocumentEditor } from './document-editor';

export default function Page() {
  const doc = '# Hello\n\nText from the server.';
  return (
    <main>
      <h1>Document</h1>
      <DocumentEditor initial={doc} />
    </main>
  );
}
```

```tsx
// app/document-editor.tsx  — client component
'use client';

import { KalemEditor } from '@kalem/react';
import { useState } from 'react';

export function DocumentEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  return <KalemEditor value={text} onChange={setText} lang="en" label="Document" />;
}
```

## `"use client"` is inside the package

`@kalem/react` carries its own `"use client"` directive in its build output.
That removes something the host app would otherwise have to remember on
every page.

:::note[It broke silently once]
The directive was in the source, but the bundler (rolldown) dropped it while
concatenating modules. The result: when a server component imported
`<KalemEditor>`, the error "useState only works in client components".
It's now re-emitted as a banner, and the example app verifies it from the
build output.
:::

## `useKalemValue` doesn't crash on the server

The hook is built on `useSyncExternalStore`, and React requires
`getServerSnapshot` for this hook. The wrapper provides it (the initial
text), so a `'use client'` component doesn't error while being
**prerendered** on the server.

## Styling

```tsx
// app/layout.tsx
import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
import '@kalem/themes/editor.css';
import '@kalem/themes/ui.css';
```

## Markdown → HTML on the server

In a server component, without loading the editor at all:

```tsx
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export default function Post({ md }: { md: string }) {
  return <article className="kalem-doc kalem-theme"
                  dangerouslySetInnerHTML={{ __html: renderToString(parse(md)) }} />;
}
```

`renderToString` does its own escaping and goes through the URL allowlist;
raw HTML is escaped by default. Details and the `html: "allow"` scenario:
[Security](/en/rehber/guvenlik/).

Full recipe: [Markdown on the server](/en/tarifler/sunucuda-markdown/).

## Working example

[`examples/nextjs`](https://github.com/yusufkocak1/kalem/tree/main/examples/nextjs)
— Next 16 App Router, a production build in CI, tested with four browser
tests.
