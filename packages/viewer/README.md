# @kalem/viewer

Render a Markdown AST to the DOM or to an HTML string (SSR) — read-only viewer.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/core @kalem/viewer
```

```ts
import { parse } from '@kalem/core';
import { renderToDOM, renderToString } from '@kalem/viewer';

const ast = parse('# Hello\n\nSome **Markdown**.');
renderToDOM(ast, document.getElementById('app')!);  // in the browser
const html = renderToString(ast);                    // on the server
```

`innerHTML` is never used. Raw HTML in Markdown is escaped by default, and links go through a protocol allowlist.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
