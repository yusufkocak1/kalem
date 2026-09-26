---
title: "Web Components: <kalem-editor>"
description: The path that needs no framework — the browser's own component model.
---

Writing one package per framework never ends. `@kalem/wc` packages the
editor into the browser's own component model: **Svelte, Angular, Astro,
Rails, Django and plain HTML — the same tag everywhere.**

```bash
npm i @kalem/wc @kalem/themes
```

Its own size is 1.97 kB (editor not included).

```ts
import { defineKalemEditor } from '@kalem/wc';
defineKalemEditor();
```

```html
<kalem-editor label="Document" name="content">
    # Hello

    Start writing.
</kalem-editor>
```

There's also a one-line setup: `import '@kalem/wc/define';`

:::note[Why registration isn't automatic]
`customElements.define` writes to a global namespace, and registering the
same name twice **throws**. A library that registered itself as soon as it
was imported would crash, at startup, an app that has two versions on the
same page (micro-frontends, two dependencies pulling different versions).

The call is **repeatable**: if the name is already registered it returns
`false` instead of throwing.
:::

## The initial text is inside the element

You don't have to squeeze multi-line Markdown into an attribute. The page's
indentation is stripped — otherwise Markdown would treat it as a **code
block**:

```html
<kalem-editor>
    ## Heading

    * list
</kalem-editor>
```

A `<script type="text/markdown">` child is read the same way: the browser
doesn't run a type it doesn't know, but includes the text in `textContent`,
so the raw Markdown doesn't show on screen before the element upgrades.

## Attributes

| Attribute | What |
|---|---|
| `value` | The text. **Changing it later works too** (see below) |
| `readonly` | Read-only |
| `required` | Form validation: an empty document is invalid |
| `required-message` | Validation message; if not given, based on the document language |
| `label` | Accessible name |
| `name` | Form field name |
| `disabled` | Disabled by the form |
| `shadow` | Shadow DOM (**off** by default) |

`lang` isn't on the list, and that's not an omission: the editable area is a
child of the element, `lang` is inherited down the DOM, and it already picks
the browser's spell-check dictionary.

:::note[The `value` attribute differs from `<input>`]
On the platform, the `value` attribute is only the **initial** value;
changing it after the user has typed does nothing. Here it does, because
frameworks often bind to custom elements through attributes, and a binding
that silently doesn't work is the worst outcome. The initial value that form
reset needs is separate: `defaultValue`.
:::

## Properties

`value`, `defaultValue`, `readOnly`, `required`, `label`,
`requiredMessage`, `name`, `plugins`, `styles` — all writable. Read-only:
`editor` (the instance itself), `editorElement`, `form`, `validity`,
`validationMessage`, `willValidate`.

Methods: `focus()`, `checkValidity()`, `reportValidity()`.

```ts
const el = document.querySelector('kalem-editor')!;
el.value = '# Another document';   // doesn't fire an event (platform rule)
el.editor?.toggleMark('strong');
```

## Events

| Event | When | Carries |
|---|---|---|
| `input` | On every change | `event.detail.value` and `event.target.value` |
| `change` | When focus leaves the editor, if the text changed | — |
| `kalem-ready` | When the editor is set up | `event.detail.editor` |

The `contenteditable`'s own `input` event is **stopped** inside the element,
and a `CustomEvent` carrying the text is fired instead. If it weren't
stopped, a listener would see two events per keystroke, and in one of them
`event.target` would be the inner block element — so `event.target.value`
would be `undefined`.

A programmatic `el.value = '…'` **doesn't fire an event**; the same rule as
the platform's form controls.

## Form integration

The element attaches to the form with `ElementInternals`: `name`,
`required`, reset, `disabled` and state restoration on browser back/forward
navigation — all the platform's own flow.

```html
<form>
  <kalem-editor name="summary" required label="Summary"></kalem-editor>
  <button type="submit">Submit</button>
</form>
```

`FormData` carries the text directly; no JavaScript in between.

## Shadow DOM — optional, off by default

A shadow root leaves styles outside: `@kalem/themes` is defined across the
page and **doesn't get into** the shadow. If it were on by default, the
editor would open unstyled on every setup and everyone would look for a
workaround.

The case where it should be on is real too — in a widget embedded in a
foreign page, that page's `p { margin: 0 }` rule breaks the document:

```html
<kalem-editor shadow label="Document"></kalem-editor>
```

```ts
el.styles = `
  p { margin: 0 0 0.6em; }
  h2 { font-size: 15px; }
`;
```

The shadow root is in `open` mode, so you can also provide a ready-made
stylesheet through `el.shadowRoot.adoptedStyleSheets`.

## Styling

Custom elements are `display: inline` by default.
`@kalem/themes/editor.css` fixes that:

```css
:where(kalem-editor) { display: block; }
```

This one line lives in that file because if the element wrote it as an
inline style itself, the page could never say `display: flex`.

## Moving the element

An element that changes place in the DOM is first detached and then
attached. Because teardown is delayed by one microtask,
`parent.append(el)` **keeps the content, the history and the caret**.

## In frameworks

- [Svelte](/en/frameworkler/svelte/)
- [Angular](/en/frameworkler/angular/)
- [CDN / plain HTML](/en/frameworkler/cdn/)
