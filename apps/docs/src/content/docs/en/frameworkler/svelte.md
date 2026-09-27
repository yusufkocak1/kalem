---
title: Svelte
description: No wrapper — <kalem-editor> is an ordinary DOM element.
---

**There's no Kalem package for Svelte, and there doesn't need to be.**
`<kalem-editor>` is a Custom Element; Svelte treats it like any ordinary DOM
element.

```bash
npm i @kalem-editor/wc @kalem-editor/themes
```

```svelte
<script lang="ts">
  import '@kalem-editor/wc/define';

  let text = $state('# Hello');
  let readOnly = $state(false);
  let el = $state<(HTMLElement & { value: string }) | null>(null);

  function onInput(event: Event) {
    text = (event as CustomEvent<{ value: string }>).detail.value;
  }
</script>

<kalem-editor
  bind:this={el}
  class="editor"
  label="Document"
  value={text}
  readOnly={readOnly}
  oninput={onInput}
></kalem-editor>

<p>{text.length} characters</p>
```

## Does Svelte write a property or an attribute?

On custom elements, Svelte writes **the property if there is one**
(`el.value = …`). So multi-line Markdown doesn't have to be squeezed into an
attribute, and camelCase names like `readOnly` work too.

## The infinite loop breaks itself

The element's `value` setter does nothing if the incoming text equals the
current text. The user types → event → `text` → the binding writes the same
text back → the setter quietly stops. The document isn't reloaded and the
caret stays where it is.

The React and Vue wrappers do the same thing; the only difference is that
there it happens inside the hook.

## Form integration

Thanks to `ElementInternals`, the editor is an ordinary form field — Svelte
doesn't even notice:

```svelte
<form onsubmit={(e) => {
  e.preventDefault();
  submitted = String(new FormData(e.currentTarget).get('summary') ?? '');
}}>
  <kalem-editor name="summary" required label="Summary"></kalem-editor>
  <button type="submit">Submit</button>
</form>
```

When `required` is empty, the browser blocks submission; `onsubmit` never
runs.

## Imperative access

```svelte
<button onclick={() => el?.focus()}>Focus the editor</button>
```

`el.editor` gives you the editor itself — to add plugins, check history or
call `mountUi`.

## Styling

```ts
import '@kalem-editor/themes/tokens.css';
import '@kalem-editor/themes/viewer.css';
import '@kalem-editor/themes/editor.css';
import '@kalem-editor/themes/ui.css';
```

Svelte's component-scoped CSS (the `<style>` block) doesn't reach **inside**
the editor: Svelte didn't create those nodes, so they don't get the
`svelte-xxxx` class. `@kalem-editor/themes` provides the document typography; write
the shell (border, padding) with `:global()` or in a global stylesheet.

## Working example

[`examples/svelte`](https://github.com/yusufkocak1/kalem/tree/main/examples/svelte)
— Vite + Svelte 5, built in CI and tested with seven browser tests.

The element's full surface: [Web Components](/en/frameworkler/web-components/).
