# @kalem-editor/plugin-autosave

Kalem plugin: debounced autosave with status indicator and crash recovery.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/plugin-autosave
```

```ts
import { autosavePlugin } from '@kalem-editor/plugin-autosave';
import '@kalem-editor/themes/plugin-autosave.css';

editor.addPlugin(
  autosavePlugin({
    delay: 1500,
    storageKey: `kalem:draft:${documentId}`,
    save: async (markdown, signal) => {
      await fetch('/api/save', { method: 'POST', body: markdown, signal });
    },
  }),
);
```

Debounced saving, a status indicator (`idle`, `dirty`, `saving`, `saved`, `error`) and local crash recovery.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
