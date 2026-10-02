---
title: Getting started
description: Add Kalem to your project in five lines.
---

:::caution[Not on npm yet]
The library is written and works; the first release will be **v1.0**. The
API below is taken from the code in the repository.
:::

## Which package?

Kalem isn't a single package. Install only what you need — you don't
download what you don't use.

| What you want to do | Package | Size (min+gzip) |
|---|---|---|
| **Display** Markdown (read-only) | `@kalem-editor/viewer` | 2.9 kB |
| **Parse** Markdown (on the server, in scripts) | `@kalem-editor/core` | 13.3 kB |
| **Edit**, with your own UI | `@kalem-editor/editor` | 29.3 kB |
| The full **Word-like** experience | `@kalem-editor/editor` + `@kalem-editor/ui` | 38.0 kB |

The framework wrappers add a few hundred bytes on top:
`@kalem-editor/react` 907 B, `@kalem-editor/vue` 686 B, `@kalem-editor/wc` 1.99 kB.

```bash
# The full Word-like experience
npm i @kalem-editor/editor @kalem-editor/ui @kalem-editor/themes
```

## Your first editor in five lines

```ts
import { Editor } from '@kalem-editor/editor';
import { mountUi } from '@kalem-editor/ui';

import '@kalem-editor/themes/tokens.css';
import '@kalem-editor/themes/viewer.css';
import '@kalem-editor/themes/editor.css';
import '@kalem-editor/themes/ui.css';

const editor = new Editor(document.getElementById('app')!, {
  value: '# Hello\n\nStart writing, or press `/` for commands.',
  lang: 'en',
  label: 'Document',
  onChange: (markdown) => console.log(markdown),
});

mountUi(editor);
```

That's it. `mountUi` sets up the bubble toolbar, the fixed toolbar, the slash
menu, the block handle and the link popover.

:::note[`lang` isn't decoration]
The browser picks the spell-check dictionary, hyphenation and quote style
from this attribute. Checking a Turkish document with an English dictionary
underlines every word in red. Kalem uses the same value for search and case
folding — details on the [Markdown compatibility](/en/rehber/markdown-uyumu/)
page.
:::

## Core concepts

### The value is always Markdown text

`editor.getValue()` returns a `string`, not a JSON tree. Kalem's output can
be committed to git, opened in other tools, and handed straight to a
language model.

What's more, a line you didn't touch stays the same **byte-for-byte**:

```ts
import { parse, serialize } from '@kalem-editor/core';

const md = '* a list written with asterisks\n';
serialize(parse(md)) === md; // true — it doesn't come back as `-`
```

This comes from the editor keeping the author's writing choices (list
marker, delimiter, heading style) in the model. Details:
[Markdown compatibility](/en/rehber/markdown-uyumu/).

### Every block is its own element

Paragraph, heading, list item — each lives in its own `contenteditable`
element. Users can move a block by dragging its handle;
`Ctrl+Shift+↑/↓` does the same from the keyboard.

The cost and the payoff of this are on the [Architecture](/en/mimari/) page.

### The UI is a separate package

`@kalem-editor/editor` works on its own but **draws no UI** — it's fully usable
from the keyboard. The Word-like experience comes with `mountUi`. An app
with its own design system can write its own UI and use only the engine.

## Your own UI

Without calling `mountUi`, using the editor's imperative API:

```ts
const editor = new Editor(el, { value: '# Hello' });

document.getElementById('bold')!.addEventListener('click', () => {
  editor.toggleMark('strong');
});

editor.on('selectionchange', () => {
  boldButton.setAttribute('aria-pressed', String(editor.isMarkActive('strong')));
});
```

:::tip
Call `preventDefault()` on the button's `mousedown`; otherwise the click
drops the selection and there's no text left to format.
:::

## Next

- [Viewer guide](/en/rehber/viewer/) — if you only want to display
- [Editor guide](/en/rehber/editor/) — every option, the API and shortcuts
- [Plugins](/en/rehber/eklentiler/) — code highlighting, find and replace, autosave
- Your framework: [React](/en/frameworkler/react/) · [Vue](/en/frameworkler/vue/) ·
  [Svelte](/en/frameworkler/svelte/) · [Angular](/en/frameworkler/angular/) ·
  [Next.js](/en/frameworkler/nextjs/) · [Nuxt](/en/frameworkler/nuxt/) ·
  [CDN](/en/frameworkler/cdn/)
