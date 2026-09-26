---
title: Controlled component
description: Keeping the text in your own state without losing the caret.
---

Controlled mode means the text lives **in your app's state**. Its classic
trap is here too: the user types → `onChange` → `setState` → `value`
changes → it's written into the editor → **the caret jumps to the start**.

## How the loop is broken

The text the editor **itself emitted** last is remembered; if the incoming
value equals it, nothing happens. So only a change that really comes from
outside reaches the editor.

The React and Vue wrappers do this internally:

```tsx
const [text, setText] = useState('# Hello');
<KalemEditor value={text} onChange={setText} lang="en" label="Document" />
```

```vue
<KalemEditor v-model="text" lang="en" label="Document" />
```

In the custom element, the loop is broken in the setter itself
(`el.value = x` does nothing if the incoming text is current), so
declarative binding is safe in Svelte and Angular too:

```svelte
<kalem-editor value={text} oninput={(e) => (text = e.detail.value)}></kalem-editor>
```

## In vanilla

If you don't use a wrapper, write the same pattern yourself:

```ts
let emitted: string | null = null;

const editor = new Editor(el, {
  value: state.text,
  onChange: (markdown) => {
    emitted = markdown;
    updateState({ text: markdown });
  },
});

function stateChanged(next: string) {
  if (next === emitted) return;   // the editor's own text — leave it alone
  emitted = next;
  editor.setValue(next);
}
```

:::caution[`setValue` isn't cheap]
It means "open a different document": IDs are reassigned, every block is
rebuilt and **history is reset**. Don't call it while the user is typing.
:::

## When not to be controlled

Most uses don't need it. If you don't need the text on every keystroke,
uncontrolled mode is both faster and less code:

```tsx
<KalemEditor defaultValue={md} onChange={(m) => writeDraft(m)} />
```

For sibling components that want to read the text but **not own it**, there's
`useKalemValue()`: a word counter, a preview, an "unsaved" badge.

## Switching documents

When the user switches to another document, **re-mounting the component** is
usually more correct than `setValue`:

```tsx
<KalemEditor key={doc.id} defaultValue={doc.text} onChange={…} />
```

`setValue` resets history anyway, so it wouldn't gain anything; re-mounting
also ties autosave's recovery key to the document. The full pattern is in
the [Kalem Notlar](https://github.com/yusufkocak1/kalem/tree/main/apps/notlar)
app.
