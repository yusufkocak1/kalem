---
title: CDN (script etiketi)
description: Derleme adımı olmadan, tek script etiketiyle.
---

Build aracı kullanmıyorsanız veya bir CMS şablonuna gömüyorsanız IIFE build'i
kullanın.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@kalem/themes/default.css">
<script src="https://cdn.jsdelivr.net/npm/@kalem/editor/dist/kalem.iife.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kalem/ui/dist/kalem-ui.iife.js"></script>

<div id="app"></div>

<script>
  var editor = new Kalem.Editor(document.getElementById('app'), {
    value: '# Merhaba\n\nBuraya yazın.',
    plugins: [KalemUI.toolbar(), KalemUI.slashMenu(), KalemUI.dragHandle()],
    onChange: function (md) { document.getElementById('cikti').textContent = md; }
  });
</script>
```

:::caution[Sürüm sabitleyin]
Üretimde sürümsüz CDN yolu kullanmayın. Sabit sürüm belirtin:
`https://cdn.jsdelivr.net/npm/@kalem/editor@1.0.0/dist/kalem.iife.js`
:::

## ES modülü olarak

Modern tarayıcılarda derleme adımı olmadan ESM de kullanabilirsiniz:

```html
<script type="module">
  import { Editor } from 'https://cdn.jsdelivr.net/npm/@kalem/editor/+esm';
  new Editor(document.getElementById('app'), { value: '# Merhaba' });
</script>
```

## Diğer framework'ler

Svelte, Angular, Solid, Qwik, Astro ve Alpine için ayrı sarmalayıcı yoktur —
custom element kullanın:

```bash
npm i @kalem/wc
```

```html
<script type="module">import '@kalem/wc';</script>

<kalem-editor value="# Merhaba"></kalem-editor>

<script type="module">
  document.querySelector('kalem-editor')
    .addEventListener('change', (e) => console.log(e.detail.markdown));
</script>
```

Vue'da custom element kullanacaksanız derleyiciye tanıtın:

```ts
// vite.config.ts
vue({ template: { compilerOptions: { isCustomElement: (t) => t.startsWith('kalem-') } } })
```
