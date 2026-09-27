# @kalem-editor/plugin-source-mode

Kalem plugin: toggle between WYSIWYG and raw Markdown source.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/plugin-source-mode
```

```ts
import { sourceModePlugin } from '@kalem-editor/plugin-source-mode';
import '@kalem-editor/themes/plugin-source.css';

editor.addPlugin(
  sourceModePlugin(),
);
```

Toggle between WYSIWYG and raw Markdown source with Ctrl/Cmd+Shift+M.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
