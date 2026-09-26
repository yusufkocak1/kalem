---
title: React
description: <KalemEditor />, useKalem and useKalemValue.
---

```bash
npm i @kalem/react @kalem/editor @kalem/themes
```

`react` is a **peer dependency** (`>=17`); the package doesn't bring its own
copy. Its own size is 903 B.

## Uncontrolled (most uses)

The text lives in the editor; React stays out of it:

```tsx
import { KalemEditor } from '@kalem/react';

<KalemEditor
  defaultValue="# Hello"
  lang="en"
  label="Document"
  onChange={(markdown) => save(markdown)}
/>
```

## Controlled

The text lives in the parent component:

```tsx
const [text, setText] = useState('# Hello');

<KalemEditor value={text} onChange={setText} lang="en" label="Document" />
```

The classic trap of controlled mode is an infinite loop: the user types →
`onChange` → `setState` → `value` changes → it's written into the editor →
**the caret jumps to the start**. The wrapper remembers the text the editor
itself emitted, and does nothing if the incoming `value` equals it. So only a
change that really comes from outside reaches the editor.

## Props

| Prop | Type | Note |
|---|---|---|
| `value` | `string` | Controlled text |
| `defaultValue` | `string` | Uncontrolled initial text |
| `onChange` | `(value: string, doc: Root) => void` | |
| `onReady` | `(editor: Editor) => void` | Imperative access |
| `readOnly` | `boolean` | |
| `lang` · `label` · `plugins` | | Read **at mount time** |
| `className` · `style` · `id` | | Passed to the box |
| `children` | `ReactNode` | Rendered **next to** the editor |

:::note[Why some are read at mount time]
Setup resets the caret, the selection and history. If `lang`, `plugins` or
`label` changed later, a new editor would be needed; the user losing their
place is worse than a prop being applied late. The two things that can
change — `value` and `readOnly` — are updated through the editor's own API.

Callbacks are the exception: they're kept in a ref, so an inline
`onChange={() => …}` doesn't rebuild the editor.
:::

## Hooks

For components that are **children** of `<KalemEditor>`:

```tsx
import { KalemEditor, useKalem, useKalemValue } from '@kalem/react';

function Status() {
  const editor = useKalem();          // Editor | null
  const text = useKalemValue();       // string, re-renders as it changes

  return (
    <p>
      {text.length} characters
      <button onClick={() => editor?.focus()}>Focus</button>
    </p>
  );
}

<KalemEditor defaultValue={md} lang="en" label="Document">
  <Status />
</KalemEditor>
```

`useKalemValue` is built on `useSyncExternalStore`: tearing in concurrent
rendering (two components in the same tree seeing different text) and
updates missed before subscribing — both are covered.

:::tip[`children` aren't placed inside the editor]
The inside of the editable area is drawn from the model; any node React put
there would be removed on the first render. Slot content goes **next to**
the box.
:::

## Strict Mode

React's development mode sets up, tears down and sets up every effect again.
The wrapper gets through this with a single editor, and a browser test pins
it down — you don't need to turn off `<StrictMode>`.

## Next.js App Router

The package carries its own `"use client"` directive in its build output, so
a server component can import `<KalemEditor>` directly — no
`transpilePackages` or `dynamic(… { ssr: false })` needed.

Details: [Next.js](/en/frameworkler/nextjs/).

## Plugins

`plugins` is read at mount time; to add one later, use `onReady`:

```tsx
<KalemEditor
  defaultValue={md}
  onReady={(editor) => editor.addPlugin(codeHighlightPlugin())}
/>
```

Plugins that want a panel (table of contents, word count) need a container
that React renders. For the full pattern, see the
[Kalem Notlar](https://github.com/yusufkocak1/kalem/blob/main/apps/notlar/src/Arayuz.tsx)
app.

## The Word-like UI

`<KalemEditor>` sets up the engine; the toolbars come from `@kalem/ui`,
mounted through `onReady` — and torn down **before** the editor:

```tsx
import { KalemEditor } from '@kalem/react';
import { mountUi, type Ui } from '@kalem/ui';

const uiRef = useRef<Ui | null>(null);
useEffect(() => () => uiRef.current?.destroy(), []);

<KalemEditor
  defaultValue={md}
  lang="en"
  label="Document"
  onReady={(editor) => { uiRef.current = mountUi(editor); }}
/>
```
