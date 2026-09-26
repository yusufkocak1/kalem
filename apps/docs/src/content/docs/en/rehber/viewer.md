---
title: Viewer (read-only)
description: Render Markdown to the DOM or to an HTML string — without downloading editing code.
---

`@kalem/viewer` **displays** Markdown; it doesn't edit it. 2.7 kB (min+gzip)
and completely independent of the editing engine: for a blog, a comment
list or an email preview you don't need to download the editor's 27 kB.

There are two outputs, and they give **the same result**:

```ts
import { parse } from '@kalem/core';
import { renderToDOM, renderToString } from '@kalem/viewer';

const ast = parse('# Heading\n\nA **paragraph**.');

renderToDOM(ast, document.getElementById('app')!);   // in the browser
const html = renderToString(ast);                     // on the server
```

A test pins down that `renderToDOM` and `renderToString` produce
**byte-for-byte** identical output in all three browser engines. So there's
no hydration mismatch between the HTML you generate on the server and the
tree the client draws.

## `innerHTML` is never used

`renderToDOM` builds every node with `createElement` / `createTextNode`.
That's not a performance choice, it's a security decision: a single line
that parses user text as HTML brings the whole XSS surface back.
`renderToString` does its own escaping for the same reason.

Details: [Security](/en/rehber/guvenlik/).

## Options

```ts
renderToString(ast, {
  html: 'escape',        // raw HTML policy
  classPrefix: 'kalem-', // CSS class prefix
  frontmatter: false,    // whether to show the `---` block
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `html` | `"escape" \| "strip" \| "allow"` | `"escape"` | What to do with raw HTML inside Markdown |
| `sanitizeHtml` | `(html: string) => string` | — | Sanitizing hook when `html: "allow"` is chosen |
| `classPrefix` | `string` | `"kalem-"` | Prefix for generated classes |
| `frontmatter` | `boolean` | `false` | Whether to show YAML/TOML frontmatter |

`renderToDOM` adds two more:

| Option | Type | Default | Description |
|---|---|---|---|
| `containerClass` | `string \| false` | `"<prefix>doc"` | Class added to the container; `false` turns it off |
| `renderRawHtml` | `(html: string) => Node \| null` | — | Node-producing hook for `html: "allow"` |

:::caution[`html: "allow"` isn't enough on its own]
The library **doesn't parse** HTML. When you choose `allow`, turning raw
HTML into nodes is your job (`renderRawHtml`), and so is sanitizing it
(`sanitizeHtml`). If you don't provide the hook, raw HTML is printed **as
text**: visible and harmless was preferred over silently disappearing.
:::

## Why so few classes

The viewer doesn't use a "one class on every element" approach. A class is
added only where the tag itself doesn't say enough: the task list checkbox,
table cell alignment, the code block's language. The rest is plain semantic
HTML — `<h1>`, `<p>`, `<ul>`, `<blockquote>`.

The reasons are size and noise: a `<p>` carrying `class="kalem-paragraph"`
says nothing more than `<p>`, but it takes 24 bytes in every paragraph and
clashes with your own CSS.

## Styling

Typography lives in `@kalem/themes/viewer.css` and is scoped under
`.kalem-doc` — not a single rule leaks into the rest of the page.

```ts
import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
```

If you use `renderToString`, wrap the container yourself:

```html
<article class="kalem-doc kalem-theme">
  <!-- renderToString output -->
</article>
```

The `kalem-theme` class brings in the color tokens; details in
[Themes](/en/rehber/temalar/).

## On the server

`@kalem/core` and `@kalem/viewer` don't touch the DOM — they work the same
in Node, in workers and in edge runtimes. A purity gate
(`pnpm guard:purity`) verifies this in CI: `document`, `window` or
`navigator` appearing in the core bundle fails the build.

```ts
// On an Astro / Next.js / Express server
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export function markdownToHtml(md: string): string {
  return renderToString(parse(md));
}
```

Full recipe: [Markdown → HTML on the server](/en/tarifler/sunucuda-markdown/).

## When the viewer, when the editor?

Don't set up both on the same page. The editor can already switch to
read-only mode:

```ts
editor.setReadOnly(true);
```

The only reason to choose the viewer is **never downloading editing code**.
If there's any chance of editing on the page, starting the editor in
read-only mode is less work.
