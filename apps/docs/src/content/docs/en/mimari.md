---
title: Architecture
description: How Kalem works and why it's designed this way.
---

This page summarizes Kalem's internal design for curious users and potential
contributors. The full analysis document is in the repository (in Turkish).

## Five principles

1. **Markdown doesn't leak to the user.** In the default mode the user never
   sees `##` or `**`. Source mode is an opt-in feature.
2. **Lossless round-trip.** A line the user didn't touch doesn't change, down
   to the byte.
3. **You don't download what you don't use.** Someone who wants the viewer
   doesn't download editor code.
4. **The core knows no framework.** No React, no Vue, no virtual DOM.
5. **Secure by default.** Rendering from the AST = no injection surface.

## Package graph

```
core  ←  viewer  ←  editor  ←  ui  ←  { react, vue, wc }
                        ↖ plugin-*
```

Dependencies point one way and there are no cycles. `core` depends on
nothing. This ordering **structurally** guarantees that a user who only
wants the viewer never downloads editor code.

## A block-based editor engine

Kalem isn't built on top of an engine like ProseMirror or Lexical. It uses
its own engine, and the reason is the size target.

The key design decision: **every block is its own small `contenteditable`
element.**

- **Within a block**, selection, caret, IME (Chinese/Japanese/Korean input)
  and autocorrect → the browser handles them. The hardest part of
  contenteditable never reaches us.
- **Across blocks**, selection, drag and drop, insertion and deletion → our
  deterministic JS logic.

This also makes drag-and-drop block reordering nearly free — in architectures
with a single big contenteditable it's a separate, expensive piece of work.

## Document model

The AST is **shape-compatible with `mdast`**, but has no dependency on
`unified`. The practical benefit: if you want, you can connect plugins from
the remark/rehype ecosystem to Kalem on your side, but Kalem doesn't depend on
them.

The crucial distinction: **the source of truth is always the Markdown text**,
not the AST. Tools like Editor.js that treat JSON as the truth convert to
Markdown lossily. In Kalem the AST is only the in-memory representation of
Markdown.

## Round-trip fidelity

Besides position information, the parser stores the **syntax choice** on each
node: was the bullet `-` or `*`, was the heading ATX or setext, was the code
block opened with ``` or `~~~`, how was the nested list indented. The
serializer uses those choices.

That's why an off-the-shelf parser (marked, markdown-it) couldn't be used —
none of them provide this information.

## Plugin architecture

Plugins are objects with four fields: `name`, `setup`, `keymap`,
`inputRules`. The context they receive (`PluginContext`) is narrow, on
purpose — the document, the caret, `applyEdit`, the root element, the
read-only state and event subscription.

**There's no render hook.** Such a hook would expose the editor's
caret-preserving patch logic to plugins, and every plugin would produce its
own caret bug. None of the seven official plugins needed one; what was
needed in practice was "one call per change", and `ctx.on('change', …)`
provides that.

There's one conflict rule: **registration order**. Plugins see a key before
the core, and among plugins the one registered first wins. There are no
priority numbers, no phase system, no concept of a "high-priority plugin".

## Measured promises

These promises are guarded automatically in CI; each one is a test, not an
intention:

- **Size gate** — `size-limit` fails a build that goes over budget.
- **Size claims gate** — every size written in the docs and the README is
  checked against the measurement.
- **Purity gate** — are the core packages' `dependencies` empty, is there any
  trace of `react`/`vue` in the production bundle, does the `core` bundle
  touch `document`/`window` (SSR safety).
- **Locale gate** — a locale-less `toLowerCase()` / `toUpperCase()` call
  fails the build. In Turkish, `I` and `ı` fold silently wrong; nothing
  crashes, you just get the wrong answer.
- **Docs gate** — every name imported in a docs code example really is
  exported by that package.

A promise that isn't measured erodes over time. These gates have existed
since the project's first day, and they have their own self-tests
(`pnpm guard:selftest`).

## Today's measurements

| Package | min+gzip |
|---|---|
| `@kalem-editor/core` | 12.8 kB |
| `@kalem-editor/viewer` | 2.7 kB |
| `@kalem-editor/editor` (core included) | 27.5 kB |
| `@kalem-editor/editor` + `@kalem-editor/ui` | 36.2 kB |
| `@kalem-editor/wc` — the single `<script>` build | 28.1 kB |
| Wrappers (react / vue / wc) | 907 B / 686 B / 1.99 kB |

Verification: over 1,400 unit tests, over 1,200 browser tests (Chromium ·
Firefox · WebKit, plus iPhone and Pixel emulation) and the example apps
built and tested in CI.

## Deliberately out of scope

- Page layout and page breaks — not Markdown concepts
- Text wrapping around images, multiple columns, footnote layout
- Editing raw HTML inside the WYSIWYG view (it's preserved and shown, not edited)
