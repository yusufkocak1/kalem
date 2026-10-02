---
title: Markdown → HTML on the server
description: No browser emulation — in Node, in workers and at the edge.
---

`@kalem-editor/core` and `@kalem-editor/viewer` don't touch the DOM. You don't need to
install jsdom to turn Markdown into HTML on the server.

```ts
import { parse } from '@kalem-editor/core';
import { renderToString } from '@kalem-editor/viewer';

export function markdownToHtml(md: string): string {
  return renderToString(parse(md));
}
```

16.2 kB in total (min+gzip), and no third-party dependencies.

## A gate guards this

`pnpm guard:purity` checks whether `document`, `window`, `navigator`,
`localStorage` or `HTMLElement` appears in the core bundle. If it does, CI
goes red. So "runs on the server" isn't a promise, it's a measured property.

## The output is identical to the client's

`renderToString` and `renderToDOM` produce the same plan; a test pins down
that their outputs are **byte-for-byte** identical in all three browser
engines. When you hydrate the HTML you generated on the server, there's no
mismatch — the Nuxt example is built exactly on this.

## Container and styles

```html
<article class="kalem-doc kalem-theme">
  <!-- renderToString output -->
</article>
```

```html
<link rel="stylesheet" href="/@kalem-editor/themes/tokens.css">
<link rel="stylesheet" href="/@kalem-editor/themes/viewer.css">
```

`editor.css` and `ui.css` aren't needed: there's no point making readers
download editing styles they won't use.

## Security

With the default settings the output is safe:

- Raw HTML is **escaped** (`html: "escape"`).
- Link and image addresses go through the allowlist; `javascript:` is
  neutralized.
- `innerHTML` is never used; the escaping is in the library itself.

If you want to allow raw HTML in content you trust, the work becomes yours:

```ts
renderToString(ast, {
  html: 'allow',
  sanitizeHtml: (html) => DOMPurify.sanitize(html),
});
```

Details: [Security](/en/rehber/guvenlik/).

## Examples

### Express

```ts
app.get('/posts/:id', async (req, res) => {
  const md = await readPost(req.params.id);
  res.send(`<article class="kalem-doc kalem-theme">${renderToString(parse(md))}</article>`);
});
```

### Astro

```astro
---
import { parse } from '@kalem-editor/core';
import { renderToString } from '@kalem-editor/viewer';

const html = renderToString(parse(Astro.props.markdown));
---
<article class="kalem-doc kalem-theme" set:html={html} />
```

### Cloudflare Workers / edge

The packages are pure ES modules and use no Node APIs:

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    const md = await request.text();
    return new Response(renderToString(parse(md)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
```

## Parsing only

If you want to work with the AST without producing HTML — extracting
headings, checking links, migrating content:

```ts
import { parse, visit } from '@kalem-editor/core';

const headings: string[] = [];
visit(parse(md), (node) => {
  if (node.type === 'heading') headings.push(textOf(node));
});
```

`@kalem-editor/core` on its own is 13.3 kB and doesn't need `@kalem-editor/viewer`.
