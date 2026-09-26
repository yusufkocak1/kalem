# @kalem/plugin-outline

Kalem plugin: table of contents with active heading tracking.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/plugin-outline
```

```ts
import { outlinePlugin } from '@kalem/plugin-outline';
import '@kalem/themes/plugin-outline.css';

editor.addPlugin(
  outlinePlugin({ container: document.getElementById('toc') }),
);
```

A table of contents that tracks the active heading.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
