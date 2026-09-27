# @kalem-editor/plugin-word-count

Kalem plugin: word count, character count and reading time.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/plugin-word-count
```

```ts
import { wordCountPlugin } from '@kalem-editor/plugin-word-count';
import '@kalem-editor/themes/plugin-word-count.css';

editor.addPlugin(
  wordCountPlugin({ container: document.getElementById('status') }),
);
```

Words, characters and reading time, counted with `Intl.Segmenter` in the document's language. Markdown markers aren't counted.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
