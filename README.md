# Kalem

**Easy as Word. Portable as Markdown.**

A WYSIWYG editor for people who don't know Markdown — that saves Markdown
your Git diffs can read. Framework-agnostic, zero runtime dependencies.

[![CI](https://github.com/yusufkocak1/kalem/actions/workflows/ci.yml/badge.svg)](https://github.com/yusufkocak1/kalem/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f4e4a)](LICENSE)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20dependencies-0-0f4e4a)

![Typing a heading, bolding text from the bubble toolbar, inserting a list from the slash menu, and dragging a block — the Markdown on the right updates on every keystroke](docs/duyuru/demo.gif)

> **Status:** v1.0 is in release preparation. The packages are not on npm
> yet; everything below describes the code in this repository.

## Why

AI tools, static site generators, wikis and READMEs all speak Markdown. The
people writing the content often don't. The usual answer is one of two
compromises:

- **Show them raw Markdown.** They won't use it.
- **Use a rich-text editor that stores JSON or HTML** and converts to
  Markdown on the way out. The conversion is lossy: a `*` list comes back
  as `-`, a `1)` list as `1.`, and every save rewrites lines nobody touched.
  Your diffs fill with noise.

Kalem keeps **Markdown as the source of truth**. The document model
remembers how each construct was written — `*` or `-` bullets, `1.` or `1)`
numbering, `*` or `_` emphasis, `#` or underlined headings, fence style — and
the serializer writes it back the same way:

```ts
serialize(parse(markdown)) === markdown
```

This holds byte-for-byte on the test corpus, and a line the user didn't edit
comes back as it went in. Git diffs show what the person actually changed.
It is not universal yet: a few patterns are still normalized — they're
listed [below](#what-it-doesnt-do-yet), and each one is treated as a bug.

## What you get

- **A Word-like editing experience** — bubble toolbar on selection, an
  optional fixed toolbar, a `/` slash menu, drag handles to reorder blocks,
  a link popover, paste from Word and Google Docs.
- **Markdown input rules** for those who know them — `# `, `* `, `> `,
  ` ``` `, `**bold**` convert as you type.
- **Framework-agnostic** — a vanilla TypeScript core, thin wrappers for
  React and Vue, and a `<kalem-editor>` custom element for everything else
  (Svelte, Angular, plain HTML).
- **Small and modular** — install only the layer you need.
- **Safe by default** — no `innerHTML`, raw HTML in Markdown is kept as
  text rather than executed, links go through a protocol allowlist.
- **Accessible** — keyboard reachable everything, `axe`-checked on every
  test run, live-region announcements for block moves.
- **Localized** — English and Turkish built in, locale-aware search and
  case folding (the Turkish dotted/dotless *i* works), RTL-ready styles.

## Packages

| You want to… | Package | min+gzip |
|---|---|---|
| **Display** Markdown (read-only) | `@kalem/viewer` | 2.7 kB |
| **Parse** Markdown (server, scripts) | `@kalem/core` | 11.7 kB |
| **Edit**, with your own UI | `@kalem/editor` | 26.3 kB |
| The full **Word-like** experience | `@kalem/editor` + `@kalem/ui` | 35.0 kB |
| Drop it in with one `<script>` tag | `@kalem/wc` (IIFE build) | 27.0 kB |

Sizes are measured by [`size-limit`](.size-limit.json) and enforced in CI —
a build that exceeds its budget fails. `@kalem/core` doesn't touch the DOM,
so it parses and serializes on the server too; `@kalem/viewer` renders to a
string for SSR.

Plugins: `plugin-image-upload`, `plugin-code-highlight` (eight languages,
loaded on demand), `plugin-find-replace`, `plugin-outline` (table of
contents), `plugin-word-count`, `plugin-source-mode` (toggle to raw
Markdown), `plugin-autosave`. Styling lives in `@kalem/themes` as plain CSS
with custom properties — light, dark and minimal themes included.

## Quick start

```bash
npm i @kalem/editor @kalem/ui @kalem/themes
```

### Vanilla

```ts
import { Editor } from "@kalem/editor";
import { mountUi } from "@kalem/ui";

import "@kalem/themes/tokens.css";
import "@kalem/themes/viewer.css";
import "@kalem/themes/editor.css";
import "@kalem/themes/ui.css";

const editor = new Editor(document.getElementById("app")!, {
  value: "# Hello",
  lang: "en",
  label: "Document",
  onChange: (markdown) => console.log(markdown),
});
mountUi(editor);
```

### React

```tsx
import { KalemEditor } from "@kalem/react";
import { mountUi } from "@kalem/ui";

<KalemEditor
  defaultValue="# Hello"
  lang="en"
  label="Document"
  onChange={(markdown) => console.log(markdown)}
  onReady={(editor) => mountUi(editor)}
/>;
```

### Vue

```vue
<script setup lang="ts">
import { KalemEditor } from "@kalem/vue";
import { mountUi } from "@kalem/ui";
import { ref } from "vue";

const text = ref("# Hello");
</script>

<template>
  <KalemEditor v-model="text" lang="en" label="Document" @ready="mountUi" />
</template>
```

### Plain HTML — no build step

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/tokens.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/viewer.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/editor.css">

<kalem-editor label="Document"># Hello</kalem-editor>

<script src="https://cdn.jsdelivr.net/npm/@kalem/wc/dist/kalem-editor.iife.js"></script>
```

`<kalem-editor>` is a form-associated custom element: put it inside a
`<form>` and its Markdown is submitted like a `<textarea>`'s value.

Working apps for React, Next.js, Vue, Nuxt, Svelte, Angular and plain HTML
live in [`examples/`](examples/) and are built and tested in CI.

## How it compares

| | Kalem | Tiptap | BlockNote | Editor.js |
|---|---|---|---|---|
| Stores Markdown natively | ✅ | ❌ HTML / JSON | ❌ JSON | ❌ JSON |
| Framework-agnostic | ✅ | ✅ | ❌ React only | ✅ |
| Runtime dependencies | **0** | ~10 packages | ~15 packages | a few |
| Editor + UI (min+gzip) | **35.0 kB** | ~90–120 kB | ~150 kB+ | ~30 kB + plugins |
| Drag-and-drop blocks | ✅ | Extension | ✅ | ✅ |
| Lossless Markdown round-trip | ✅ | Partial | ❌ | ❌ |

Kalem's number is measured on every CI run. The other columns are
approximate and were not measured independently — corrections welcome.

These are good editors, and they do things Kalem doesn't: Tiptap has
real-time collaboration and a large extension ecosystem, BlockNote has
Notion-style nested blocks. Pick Kalem when the file on disk has to be
Markdown that a human would have written.

## What it doesn't do (yet)

The [known limitations](apps/docs/src/content/docs/bilinen-kisitlar.md) page
(in Turkish, for now) is the most useful one to read before choosing Kalem.
In short:

- **Some Markdown is still normalized on the way through.** Lists numbered
  `1.` `1.` `1.` get renumbered; nested lists indented with four spaces are
  re-indented to two; trailing whitespace and leading blank lines are
  dropped; setext underlines are resized to the heading; lazy blockquote
  continuation lines gain a `> `; a trailing `_` in a word gets escaped.
  The output is equivalent Markdown, but not the same bytes.
- **Tables** are parsed and preserved byte-for-byte, but there is no table
  editing UI in v1 (planned for v1.1). Typing inside a table cell is
  currently a known bug: the text doesn't reach the output.
- **Mobile works but isn't optimized.** Typing, input rules and the slash
  menu work; drag-to-reorder has no touch equivalent yet, and on-screen
  keyboard autocorrect hasn't been measured.
- **No real-time collaboration.** The model is immutable and edits are pure
  functions, so a sync layer can be built on top — but Kalem doesn't ship
  one.
- **No page layout.** No page breaks, columns or footnote layout — those
  aren't Markdown concepts.

## Try it locally

```bash
pnpm install
pnpm build
pnpm --filter kalem-playground dev   # http://localhost:5173
```

The playground shows the Word-like UI, the live Markdown output, a round-trip
check on whatever you type, a "paste from Word" demo and a 1,000-block
document. Documents are shareable: the text is compressed into the URL's
hash, which never reaches a server.

## Development

```bash
pnpm install
pnpm verify   # lint + types + unit tests + build + guards + size + publint
pnpm e2e      # browser tests: Chromium, Firefox, WebKit
```

Node ≥ 20, pnpm 10. Browser tests run under a Turkish locale on purpose:
locale-sensitive bugs that pass in English tend to fail in Turkish.

**A note on language:** Kalem was built in Turkey. The public API, types, UI
strings and this README are in English; the source comments, commit
messages, design documents ([`docs/`](docs/)) and — for now — the
documentation site are in Turkish. Issues and pull
requests in English are very welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
and the [Turkish README](README.tr.md).

## License

[MIT](LICENSE)
