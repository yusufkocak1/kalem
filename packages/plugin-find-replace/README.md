# @kalem-editor/plugin-find-replace

Kalem plugin: locale-aware find and replace.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/plugin-find-replace
```

```ts
import { findReplacePlugin } from '@kalem-editor/plugin-find-replace';
import '@kalem-editor/themes/plugin-find.css';

editor.addPlugin(
  findReplacePlugin(),
);
```

Ctrl+F / Ctrl+H with case folding in the document's language (Turkish dotted and dotless i included). Searches table cells too.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
