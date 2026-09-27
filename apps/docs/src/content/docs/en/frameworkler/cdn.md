---
title: CDN (script tag)
description: No build step, no bundler, no JavaScript written by you.
---

This is the whole page:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/tokens.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/viewer.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/editor.css">

<kalem-editor label="Document">
    # Hello

    Start writing.
</kalem-editor>

<script src="https://cdn.jsdelivr.net/npm/@kalem-editor/wc/dist/kalem-editor.iife.js"></script>
```

No build step, no bundler, no import map — **and no JavaScript written by
you**. Since the custom element is declarative, there's nothing left to
write.

## Why a separate build

`@kalem-editor/wc`'s ESM output leaves `@kalem-editor/core` and `@kalem-editor/editor`
**external**; that's right for an app that uses a bundler, or the same code
would be bundled twice. But a CDN user has no bundler, and a bare
`import "@kalem-editor/editor"` line can't be resolved in the browser.

`kalem-editor.iife.js` includes everything: **28.1 kB** (gzip), one request,
not even `type="module"` needed.

## The element registers itself

In the module entries, registration is an explicit call
(`defineKalemEditor()`), because an app with two versions on the same page
mustn't crash at startup. Someone dropping in a script tag expects the
opposite.

There's no conflict: the call is **repeatable** — if the name is already
registered it's silently skipped, so adding the script to the page twice
doesn't throw.

The imperative API is also available on `window.Kalem`:

```html
<script>
  // A second registration under a different tag name
  Kalem.defineKalemEditor('document-editor');
</script>
```

## Form integration — without JavaScript

```html
<form action="/save" method="post">
  <kalem-editor name="content" required label="Content"></kalem-editor>
  <button type="submit">Submit</button>
</form>
```

`ElementInternals` attaches the field to the form. The browser does the
submission and blocks it while `required` is empty — without a single line
written by you in between.

## Pinning the version

In production, pin the version:

```html
<script src="https://cdn.jsdelivr.net/npm/@kalem-editor/wc@1.0.0/dist/kalem-editor.iife.js"></script>
```

jsDelivr and unpkg serve the file from its path in the tarball, without
looking at the `exports` map.

## If you want a toolbar

The IIFE build carries the editor and the core, not `@kalem-editor/ui`. For the
Word-like UI, either use a bundler ([Vanilla](/en/frameworkler/vanilla/)) or
load it as a module:

```html
<script type="module">
  import { mountUi } from 'https://cdn.jsdelivr.net/npm/@kalem-editor/ui/+esm';

  const el = document.querySelector('kalem-editor');
  el.addEventListener('kalem-ready', (e) => mountUi(e.detail.editor));
</script>
```

## Working example

[`examples/cdn-vanilla`](https://github.com/yusufkocak1/kalem/tree/main/examples/cdn-vanilla)
— tested in CI with seven browser tests; one of them counts the `<script>`
tags on the page.

The element's full surface: [Web Components](/en/frameworkler/web-components/).
