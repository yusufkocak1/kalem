# @kalem/plugin-code-highlight

Kalem plugin: code block highlighting with lazily loaded language packs.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/plugin-code-highlight
```

```ts
import { codeHighlightPlugin } from '@kalem/plugin-code-highlight';
import '@kalem/themes/plugin-code.css';

editor.addPlugin(
  codeHighlightPlugin(),
);
```

Highlights code blocks. Eight language packs, each loaded on demand — a document without code downloads zero bytes. Prism and Shiki adapters included.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
