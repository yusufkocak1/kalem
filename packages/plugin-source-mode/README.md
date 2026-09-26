# @kalem/plugin-source-mode

Kalem plugin: toggle between WYSIWYG and raw Markdown source.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/plugin-source-mode
```

```ts
import { sourceModePlugin } from '@kalem/plugin-source-mode';
import '@kalem/themes/plugin-source.css';

editor.addPlugin(
  sourceModePlugin(),
);
```

Toggle between WYSIWYG and raw Markdown source with Ctrl/Cmd+Shift+M.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
