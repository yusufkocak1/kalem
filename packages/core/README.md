# @kalem/core

Markdown AST, parser and lossless serializer — no DOM, zero dependencies.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/core
```

```ts
import { parse, serialize } from '@kalem/core';

const md = '* a list written with asterisks\n';
const ast = parse(md);        // an mdast-shaped tree
serialize(ast) === md;        // true — the writing style is kept
```

No DOM, no dependencies — runs in the browser, Node, workers and at the edge.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
