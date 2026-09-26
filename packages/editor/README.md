# @kalem/editor

Headless block editor engine for Markdown — selection, history, commands.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/editor @kalem/themes
```

```ts
import { Editor } from '@kalem/editor';
import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
import '@kalem/themes/editor.css';

const editor = new Editor(document.getElementById('app')!, {
  value: '# Hello',
  lang: 'en',
  label: 'Document',
  onChange: (markdown) => console.log(markdown),
});
```

Headless: fully usable from the keyboard, draws no toolbar. For the Word-like UI, add [`@kalem/ui`](https://www.npmjs.com/package/@kalem/ui).

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
