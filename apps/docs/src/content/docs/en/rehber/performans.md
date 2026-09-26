---
title: Large documents and performance
description: Measured numbers, per-keystroke cost and the serialization cache.
---

Short answer: **typing in a 10,000-block, 440,000-character document is
smooth.** A keystroke costs 13 ms — under one frame (16.7 ms). There's no
virtual scrolling, because measurement showed it isn't needed.

The long answer is below; all of it can be reproduced with `pnpm olcum`.

## Measured numbers

Chromium, `apps/demo/olcum.html`. The document is a repeating pattern of
headings, paragraphs, lists, quotes, ordered lists and code blocks — a
thousand identical paragraphs wouldn't be realistic. "Key p50" is the cost
of a keystroke to the library: the time between `beforeinput` and
`onChange`.

| Blocks | Characters | DOM elements | Open | Key p50 | Key p95 |
| --- | --- | --- | --- | --- | --- |
| 100 | 4,089 | 258 | 13 ms | 0.8 ms | 1.3 ms |
| 500 | 21,115 | 1,288 | 27 ms | 1.2 ms | 1.7 ms |
| 1,000 | 42,375 | 2,573 | 43 ms | 1.9 ms | 3.0 ms |
| 2,500 | 108,581 | 6,427 | 94 ms | 3.7 ms | 5.9 ms |
| 5,000 | 218,974 | 12,858 | 213 ms | 7.3 ms | 9.0 ms |
| 10,000 | 439,689 | 25,716 | 322 ms | 13.0 ms | 15.7 ms |

Opening happens once and the user waits for it; the per-keystroke cost is
paid on every letter, so that's the number that matters.

## Where the cost comes from

A keystroke changes a single block, but `onChange` provides the **whole**
document as Markdown. So on every letter the document was being rewritten,
and the cost grew in direct proportion to document size: 27.5 ms at 5,000
blocks, 55.5 ms at 10,000.

The fix wasn't virtual scrolling — that reduces DOM nodes, and wouldn't
have reduced this cost at all. The fix was a **per-block cache**.

## The serialization cache

Kalem's model is persistent: an edit replaces only the touched block with a
new object, and the other blocks stay **the same object**. Object identity
is therefore a perfect cache key.

The editor uses it on its own; you don't need to do anything. But if you
call `serialize` often yourself (for example to feed your own viewer), the
same gain is available to you:

```ts
import { createSerializeCache, serialize } from "@kalem/core";

const cache = createSerializeCache();

// On each call, only the changed blocks are rewritten.
const markdown = serialize(doc, { cache });
```

The cache sits on a `WeakMap`: blocks that drop out of the document are
cleaned up on their own, so you don't need to empty it by hand. Using the
same cache for different documents is safe too.

:::caution[Don't mutate the document in place]
The cache relies on AST nodes **not being mutated**. If you write into the
document you receive as `onChange`'s second argument, the cache produces
stale output — silently, without an error.

That's why it's off by default. If you need to make edits, use functions
that return a new document, like `replaceAt` / `removeAt`.
:::

## Why there's no virtual scrolling

At 10,000 blocks there are 25,716 DOM elements on screen, and the browser
builds them in 322 ms. Virtual scrolling would lower that number, but in
return problems like

- carrying the selection across virtualized boundaries,
- find and replace working on blocks that aren't on screen,
- the table of contents panel and printing seeing the whole document,
- the browser's own Ctrl+F not working

would all become our job. As long as measurement says it isn't needed, we
don't add it.

## Measuring it yourself

```bash
pnpm olcum                   # default sizes, prints a table
pnpm olcum 100 1000 5000     # your own sizes
```

Because they depend on the machine and its current load, these numbers
aren't part of the `pnpm verify` gate. The gate's tests
(`e2e/performans.spec.ts`) measure a keystroke against a ruler taken **at
the same moment on the same page**: the time to serialize the whole document
once, without the cache. Load inflates both, so the ratio stays stable. With
the cache a keystroke costs about 0.7 of that ruler; without it, at least
1.5 — the gate's threshold is 1.0: *a keystroke must be cheaper than
rewriting the document.*

## Memory

`editor.destroy()` removes every listener it added, and a torn-down editor
is released to the garbage collector; both are pinned down by browser tests.
Setting up and tearing down the editor on the same element over and over —
which is what happens when the theme or the toolbar mode changes — doesn't
grow the DOM.
