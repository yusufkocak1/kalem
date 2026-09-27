---
title: Autosave
description: Debounced saving, a status indicator and crash recovery.
---

`@kalem-editor/plugin-autosave` does three jobs at once: saving when typing stops,
reporting the status, and recovering the text locally when the server can't
be reached.

```bash
npm i @kalem-editor/plugin-autosave
```

```ts
import { autosavePlugin, createIndicator, enAutosaveLabels } from '@kalem-editor/plugin-autosave';
import '@kalem-editor/themes/plugin-autosave.css';

const indicator = createIndicator(document.getElementById('status')!, {
  prefix: 'kalem-',
  labels: enAutosaveLabels,
});

const autosave = autosavePlugin({
  delay: 1500,
  storageKey: `kalem:draft:${documentId}`,
  async save(markdown, signal) {
    const response = await fetch(`/api/documents/${documentId}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/markdown' },
      body: markdown,
      signal,
    });
    if (!response.ok) throw new Error(`Could not save (${response.status})`);
  },
  onStateChange: (state) => indicator.render(state),
});

editor.addPlugin(autosave);
```

## States

| State | When | English text |
|---|---|---|
| `idle` | Nothing to save | — |
| `dirty` | There are changes, waiting to save | Unsaved changes |
| `saving` | `save` is running | Saving… |
| `saved` | Succeeded | Saved |
| `error` | `save` threw | Could not save |

The indicator carries `role="status"`, not `aria-live`: status changes stay
readable without interrupting what the user is doing.

## Don't swallow the error

If the `save` hook throws, the state becomes `error`. That's the **intended**
behavior:

```ts
save: async (markdown) => {
  if (!writeToLocalStore(markdown)) {
    throw new Error('Could not write to the local store');
  }
},
```

In a notes app, a silently swallowed save error is the worst thing you can
do — the user keeps typing and has no idea nothing is being saved.

## Crash recovery

When `storageKey` is given, the plugin also writes every change to
`localStorage`. If the page crashes or the tab is closed, the text is still
there.

```ts
const recovered = autosave.recovered();
if (recovered !== null && recovered !== editor.getValue()) {
  if (confirm('An unsaved draft was found. Restore it?')) {
    editor.setValue(recovered);
  }
  autosave.clearRecovered();
}
```

The plugin **doesn't apply** the recovery record on its own: silently
restoring text the user hasn't seen could hide the version they actually
wanted. The app decides what to do.

:::caution[The key must be specific to the document]
Several documents can be open on the same origin. A shared key brings one
note's draft into another. If no key is given, local recovery stays **off**
— generating a random key would carry that risk.
:::

## Saving immediately

When the user presses "Save", or when leaving the page:

```ts
document.getElementById('save')!.addEventListener('click', () => autosave.saveNow());

window.addEventListener('beforeunload', (e) => {
  if (autosave.state() === 'dirty' || autosave.state() === 'saving') {
    e.preventDefault();
  }
});
```

## One save in flight

Only one save runs at a time. If a new change arrives while a save is in
progress, it's saved **once more** as soon as that one finishes — a
sequential, predictable flow instead of overlapping requests.
