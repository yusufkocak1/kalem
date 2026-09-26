# @kalem/wc

Kalem as a form-associated custom element — <kalem-editor>, no framework needed.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/wc @kalem/themes
```

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/tokens.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/viewer.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/css/editor.css">

<form method="post">
  <kalem-editor name="body" label="Post"># Hello</kalem-editor>
  <button>Save</button>
</form>

<script src="https://cdn.jsdelivr.net/npm/@kalem/wc/dist/kalem-editor.iife.js"></script>
```

A form-associated custom element: the form submits Markdown like a `<textarea>`. Works in Svelte, Angular, Astro and plain HTML. With a bundler: `import '@kalem/wc/define';`.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
