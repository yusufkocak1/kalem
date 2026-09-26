---
title: Vanilla / TypeScript
description: Setup without a framework — the library in its natural form.
---

Kalem's core knows no framework. The code below is all there is to
`@kalem/editor`; the wrappers add only lifecycle on top of it.

```ts
import { Editor } from '@kalem/editor';
import { mountUi } from '@kalem/ui';

import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
import '@kalem/themes/editor.css';
import '@kalem/themes/ui.css';

const el = document.getElementById('app')!;

const editor = new Editor(el, {
  value: '# Hello\n\nStart writing.',
  lang: 'en',
  label: 'Document',
  onChange: (markdown) => localStorage.setItem('draft', markdown),
});

const ui = mountUi(editor, { toolbar: 'both' });
```

When tearing down, **the UI first**:

```ts
ui.destroy();
editor.destroy();
```

The order matters: `ui.destroy()` removes the shortcut plugin it registered
with the editor; called after the editor was destroyed, it would touch a
registration that no longer exists.

## Your own toolbar

Without calling `mountUi`, with the imperative API:

```ts
const bold = document.getElementById('bold')!;

// `mousedown` is prevented: if the click drops the selection, there's no
// text left to format.
bold.addEventListener('mousedown', (e) => e.preventDefault());
bold.addEventListener('click', () => editor.toggleMark('strong'));

editor.on('selectionchange', () => {
  bold.setAttribute('aria-pressed', String(editor.isMarkActive('strong')));
});
```

When formatting is applied the selection stays the same, so
`selectionchange` doesn't fire; refresh the button state on the `change`
event as well.

## Read-only display

If there's no chance of editing, don't set up the editor at all:

```ts
import { parse } from '@kalem/core';
import { renderToDOM } from '@kalem/viewer';

renderToDOM(parse(markdown), document.getElementById('app')!);
```

2.7 kB, no editing code. Details: [Viewer](/en/rehber/viewer/).

## Module system

The packages publish both ESM and CJS, and their `exports` maps are verified
with `are-the-types-wrong`.

```js
// ESM
import { Editor } from '@kalem/editor';

// CJS
const { Editor } = require('@kalem/editor');
```

The sub-entries are separate: `@kalem/core/commands` (editor commands) and
`@kalem/core/html` (the paste converter). A script that only processes
Markdown doesn't pay for their size.

## Without a build step

If you don't use a bundler, see the [CDN page](/en/frameworkler/cdn/): there's
a self-contained build that works with a single `<script>` tag.
