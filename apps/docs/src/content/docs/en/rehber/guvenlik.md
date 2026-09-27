---
title: Security
description: The XSS surface, the URL allowlist and the raw HTML policy.
---

A Markdown editor is a program that prints user text to the screen. That
makes it a direct XSS target, and it's why a few of Kalem's rules are
**non-negotiable**.

## `innerHTML` is never used

Neither the viewer nor the editor parses user content as HTML. Every node is
built with `createElement` / `createTextNode`; `renderToString` does its own
escaping.

Since a single `innerHTML` line would bring back the whole surface, this
isn't a matter of style, it's a boundary that's actively maintained.

## URL allowlist

Link and image addresses go through an **allowlist**:

```ts
import { ALLOWED_PROTOCOLS, isSafeUrl, sanitizeUrl } from '@kalem-editor/core';

ALLOWED_PROTOCOLS; // ["http:", "https:", "mailto:", "tel:", "ftp:"]

isSafeUrl('javascript:alert(1)');  // false
sanitizeUrl('javascript:alert(1)'); // "#"
```

An allowlist, not a denylist: instead of counting how many ways there are to
spell `javascript:` (`java\tscript:`, `JaVaScRiPt:`, zero-width characters),
everything outside the known safe schemes is rejected.

An unsafe URL is **neutralized, not deleted** (it becomes `#`): the link text
stays in place, so the user doesn't see part of their content silently
disappear.

### `data:` in images

For images a few `data:` MIME types are also allowed: `image/png`,
`image/jpeg`, `image/gif`, `image/webp`, `image/avif`.

`data:image/svg+xml` is **deliberately excluded**: scripts run inside SVG,
and that's dangerous in some contexts even through `<img>`.

## Raw HTML policy

Markdown allows raw HTML. By default Kalem escapes it:

```ts
renderToString(ast, { html: 'escape' }); // default
```

| Policy | Behavior | When |
|---|---|---|
| `"escape"` | The HTML is shown as text | Default; safe |
| `"strip"` | It's removed entirely | When HTML should never show up |
| `"allow"` | It's handed to the caller's hook | Content you trust |

When you choose `"allow"`, the work becomes yours — the library doesn't
parse HTML:

```ts
import DOMPurify from 'dompurify';

renderToDOM(ast, el, {
  html: 'allow',
  sanitizeHtml: (html) => DOMPurify.sanitize(html),
  renderRawHtml: (html) => {
    const template = document.createElement('template');
    template.innerHTML = html;   // sanitized HTML — your responsibility
    return template.content;
  },
});
```

If you don't provide the hook, raw HTML is printed **as text**: visible and
harmless was preferred over silently disappearing.

## Pasting

HTML pasted from Word and Google Docs is processed not with the browser's
`DOMParser` but with Kalem's own converter (`@kalem-editor/core/html`), and the
result is turned into **an AST**. So pasted content goes through the same
allowlist and the same escaping rules; a paste carrying `<script>` or
`onerror=` can't get into the document.

## The core runs on the server

`@kalem-editor/core` and `@kalem-editor/viewer` don't touch the DOM. A **gate**
(`pnpm guard:purity`) verifies this: `document`, `window`, `navigator`,
`localStorage` or `HTMLElement` appearing in the core bundle breaks CI.

The practical result: when you turn Markdown into HTML on the server, you
don't need to install a browser emulation (jsdom) — and user content is
processed without ever touching the quirks of a DOM implementation.

## Reporting

If you find a security vulnerability, please follow the
[security policy](https://github.com/yusufkocak1/kalem/security) instead of
opening an issue.
