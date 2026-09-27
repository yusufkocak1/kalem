# @kalem-editor/react

React wrapper for Kalem — <KalemEditor /> and useKalem().

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/react @kalem-editor/editor @kalem-editor/ui @kalem-editor/themes
```

```ts
import { KalemEditor } from '@kalem-editor/react';
import { mountUi } from '@kalem-editor/ui';

<KalemEditor
  defaultValue="# Hello"
  lang="en"
  label="Document"
  onChange={(markdown) => console.log(markdown)}
  onReady={(editor) => mountUi(editor)}
/>;
```

Controlled (`value`) and uncontrolled (`defaultValue`) modes, `useKalem()` and `useKalemValue()` hooks, Strict Mode safe, `"use client"` included for the Next.js App Router. `react` is a peer dependency (>=17).

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
