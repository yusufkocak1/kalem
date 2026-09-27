# @kalem-editor/plugin-outline

Kalem plugin: table of contents with active heading tracking.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/plugin-outline
```

```ts
import { outlinePlugin } from '@kalem-editor/plugin-outline';
import '@kalem-editor/themes/plugin-outline.css';

editor.addPlugin(
  outlinePlugin({ container: document.getElementById('toc') }),
);
```

A table of contents that tracks the active heading.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
