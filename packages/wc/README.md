# @kalem-editor/wc

Kalem as a form-associated custom element — <kalem-editor>, no framework needed.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem-editor/wc @kalem-editor/themes
```

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/tokens.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/viewer.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem-editor/themes/css/editor.css">

<form method="post">
  <kalem-editor name="body" label="Post"># Hello</kalem-editor>
  <button>Save</button>
</form>

<script src="https://cdn.jsdelivr.net/npm/@kalem-editor/wc/dist/kalem-editor.iife.js"></script>
```

A form-associated custom element: the form submits Markdown like a `<textarea>`. Works in Svelte, Angular, Astro and plain HTML. With a bundler: `import '@kalem-editor/wc/define';`.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
