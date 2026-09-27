# @kalem-editor/ui

Word-like UI for Kalem — bubble toolbar, slash menu, drag handles.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/editor @kalem-editor/ui @kalem-editor/themes
```

```ts
import { Editor } from '@kalem-editor/editor';
import { mountUi } from '@kalem-editor/ui';
import '@kalem-editor/themes/tokens.css';
import '@kalem-editor/themes/viewer.css';
import '@kalem-editor/themes/editor.css';
import '@kalem-editor/themes/ui.css';

const editor = new Editor(document.getElementById('app')!, { value: '# Hello', lang: 'en' });
const ui = mountUi(editor, { toolbar: 'both' });

// Tear down the UI before the editor:
// ui.destroy(); editor.destroy();
```

Bubble toolbar, fixed toolbar, `/` slash menu, block handles with drag and drop, link popover — with English and Turkish strings built in.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
