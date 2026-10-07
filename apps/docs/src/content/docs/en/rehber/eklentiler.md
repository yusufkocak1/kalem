---
title: Plugins
description: Seven official plugins, and writing your own.
---

Plugins are separate packages attached to `@kalem-editor/editor`. None of them
ships by default — you don't download what you don't use.

```ts
import { codeHighlightPlugin } from '@kalem-editor/plugin-code-highlight';

const editor = new Editor(el, {
  value: md,
  plugins: [codeHighlightPlugin()],
});

// or later
editor.addPlugin(codeHighlightPlugin());
editor.removePlugin('code-highlight');
```

:::note[Built-ins]
If `plugins` isn't given, the editor installs two built-in plugins: input
rules and task lists. **Passing an empty array turns them off** — proof that
the core features really can be removed as plugins.

When you pass `plugins`, the built-ins don't come along; if you want both,
call `defaultPlugins()` and put it at the start of your own list.
:::

## Official plugins

| Package | What it does | Size (gzip) |
|---|---|---|
| `@kalem-editor/plugin-code-highlight` | Code block highlighting, 8 languages | 3.7 kB |
| `@kalem-editor/plugin-find-replace` | Ctrl+F / Ctrl+H | 5.4 kB |
| `@kalem-editor/plugin-image-upload` | Drag-and-drop / paste image upload | 2.9 kB |
| `@kalem-editor/plugin-outline` | Table of contents panel | 1.9 kB |
| `@kalem-editor/plugin-word-count` | Word count and reading time | 1.4 kB |
| `@kalem-editor/plugin-source-mode` | Raw Markdown source (Ctrl+Shift+M) | 1.0 kB |
| `@kalem-editor/plugin-autosave` | Debounced saving + status indicator | 657 B |

Each has its own CSS file: `@kalem-editor/themes/plugin-code.css`,
`plugin-find.css`, `plugin-image.css`, `plugin-outline.css`,
`plugin-word-count.css`, `plugin-source.css`, `plugin-autosave.css`.

### Code highlighting

```ts
import { codeHighlightPlugin } from '@kalem-editor/plugin-code-highlight';

codeHighlightPlugin({
  maxLength: 20_000,
  onError: (error, lang) => console.warn(lang, error),
});
```

Built-in languages: `javascript`, `typescript`, `json`, `html`, `css`,
`markdown`, `python`, `shell`, `sql`. Each is **a separate chunk**, loaded
with `import()` only when the document contains a code block in that
language — a single language pack is 599 B. If the document has no code,
**zero bytes** are downloaded, and a browser test verifies this (by counting
network requests).

The plugin never touches the model: highlighting lives only in the DOM, so
the Markdown output doesn't change.

You can bring your own highlighter — there are ready-made adapters for Prism
and Shiki:

```ts
import { codeHighlightPlugin, prismTokens } from '@kalem-editor/plugin-code-highlight';
import Prism from 'prismjs';

codeHighlightPlugin({
  highlight: (code, lang) => {
    const grammar = Prism.languages[lang];
    return grammar ? prismTokens(Prism.tokenize(code, grammar)) : null;
  },
});
```

### Find and replace

```ts
import { findReplacePlugin } from '@kalem-editor/plugin-find-replace';

const search = findReplacePlugin({ limit: 5000 });
search.open('replace');  // from your own button
```

Case folding follows **the document's language**: in a `lang="tr"`
document, searching for `ışık` finds `IŞIK` and doesn't find `İŞİK`. Accents
aren't folded — searching for `şık` doesn't match `sik`.

Table cells are searched and replaced too; rows other than the changed one,
and the column alignment, stay as they are. An inline image counts as a
single placeholder character in search: `ab` isn't found in `a![](x.png)b`,
because there's an image between them on screen.

The panel's **search mode** has the same three options as Notepad++:

- **Normal** — the text is searched as typed (default).
- **Extended** — `\n`, `\t`, `\xHH`, `\uHHHH` escapes are decoded; a line
  break inside a paragraph is found with `\n`, and `\n` in the
  replacement inserts one.
- **Regular expression** — a JavaScript pattern; the replacement can use
  `$1`, `$&`, `$<name>`. `^` and `$` match at the start and end of each
  paragraph. Case folding here is language-independent (the `i` flag):
  `ı` doesn't match `I`; write `[ıI]` if you need it.

With **Wrap around** off, next/previous stops at the end (start) of the
document.

### Image upload

```ts
import { imageUploadPlugin } from '@kalem-editor/plugin-image-upload';

imageUploadPlugin({
  maxSize: 5 * 1024 * 1024,
  async upload({ file, onProgress, signal }) {
    const response = await fetch('/api/upload', { method: 'POST', body: file, signal });
    onProgress(1);
    return (await response.json()).url;
  },
  onError: (error) => alert(error.message),
});
```

The only thing the plugin knows about the network is the `upload` hook:
which service, which authentication, which retry policy — all up to the app.
Full recipe: [Image upload](/en/tarifler/gorsel-yukleme/).

### Table of contents

```ts
import { outlinePlugin } from '@kalem-editor/plugin-outline';

outlinePlugin({
  container: document.getElementById('toc'),
  scrollOffset: 80,
  onActiveChange: (item, index) => { … },
});
```

If `container` isn't given, no UI is drawn; the heading list can still be
read with `items()` and `activeIndex()`. The library doesn't claim a corner
of the screen on its own — the app knows where it belongs.

### Word count

```ts
import { wordCountPlugin } from '@kalem-editor/plugin-word-count';

wordCountPlugin({
  container: document.getElementById('status'),
  onChange: ({ words, characters, minutes }) => { … },
});
```

Counting uses `Intl.Segmenter`, so it follows the document's language.
Markdown markers aren't counted: `**bold**` is one word, not seven.

### Source mode

```ts
import { sourceModePlugin } from '@kalem-editor/plugin-source-mode';

const source = sourceModePlugin({
  shortcut: true,                       // Ctrl/Cmd+Shift+M
  onModeChange: (inSource) => { … },
});
source.toggle();
```

The source side is an ordinary `<textarea>`. On exit the text is written
back into the document, and a lossless round-trip is pinned down by tests.

### Autosave

```ts
import { autosavePlugin, createIndicator, enAutosaveLabels } from '@kalem-editor/plugin-autosave';

const indicator = createIndicator(document.getElementById('status')!, {
  prefix: 'kalem-',
  labels: enAutosaveLabels,
});

autosavePlugin({
  delay: 1500,
  storageKey: `kalem:draft:${documentId}`,
  save: async (markdown, signal) => {
    await fetch('/api/save', { method: 'POST', body: markdown, signal });
  },
  onStateChange: (state) => indicator.render(state),
});
```

States: `idle`, `dirty`, `saving`, `saved`, `error`. If the `save` hook
throws, the state becomes `error` — it isn't swallowed silently.

`storageKey` must be **specific to the document**. If it isn't given, local
recovery is off: generating a random key would risk bringing another
document's draft into this one.

Full recipe: [Autosave](/en/tarifler/otomatik-kaydet/).

## Writing your own plugin

A plugin is an object with four fields:

```ts
import type { Plugin } from '@kalem-editor/editor';

export function myPlugin(): Plugin {
  return {
    name: 'my-plugin',

    setup(ctx) {
      const unsubscribe = ctx.on('change', (value) => console.log(value.length));
      return () => unsubscribe();       // teardown cleanup
    },

    keymap(event, ctx) {
      if (!event.ctrlKey || event.key !== 'j') return false;
      // …
      return true;                      // the event was consumed
    },

    inputRules: [
      (doc, caret) => null,             // an EditResult if it produced a change
    ],
  };
}
```

`PluginContext` is narrow, on purpose:

| Member | What it gives you |
|---|---|
| `getDocument()` | The current document (immutable `Root`) |
| `getCaret()` | The caret's model position; `null` if the selection spans more than one holder |
| `applyEdit(result)` | Applies an edit and records it in history |
| `element` | The editor's root element |
| `isReadOnly()` | Read-only mode |
| `on(event, handler)` | Same as `Editor.on`; returns an unsubscribe function |
| `getLang()` | The resolved document language — for your plugin's own strings |

### Conflict rule: registration order

Plugins see a key **before** the core, and among plugins the one registered
first wins. That's the only rule; there are no priority numbers, no phase
system, no concept of a "high-priority plugin".

### Why there's no render hook

Plugins decorate the DOM directly (through `element`) and touch the model
with `applyEdit`; there's no hook "called for every node" in between. Such a
hook would expose the editor's caret-preserving patch logic to plugins, and
every plugin would produce its own caret bug.

None of the seven plugins needed one. What was needed in practice was "one
call per change", and `ctx.on('change', …)` provides that.
