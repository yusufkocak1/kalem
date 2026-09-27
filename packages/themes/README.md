# @kalem-editor/themes

Typography and theme tokens for Kalem — plain CSS, no build step.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/themes
```

```ts
import '@kalem-editor/themes/tokens.css';   // color, type and spacing tokens
import '@kalem-editor/themes/viewer.css';   // document typography
import '@kalem-editor/themes/editor.css';   // editing layer
import '@kalem-editor/themes/ui.css';       // toolbars and menus
```

Plain CSS with custom properties, scoped to Kalem's own elements. Dark mode follows `prefers-color-scheme` and `[data-theme]`; `minimal.css` removes shadows and rounding.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
