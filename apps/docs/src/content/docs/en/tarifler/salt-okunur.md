---
title: Read-only mode
description: Locking the document, previews and permission checks.
---

## Locking the editor

```ts
editor.setReadOnly(true);
editor.isReadOnly(); // true
```

The content stays visible; editability is removed, `aria-readonly="true"` is
written on the root element and the `readonlychange` event fires.

```ts
editor.on('readonlychange', (readOnly) => {
  saveButton.disabled = readOnly;
});
```

The UI layer disables its buttons with this event — being notified instead
of polling the editor.

## Locked from the start

```ts
new Editor(el, { value: md, readOnly: true, label: 'Document (read-only)' });
```

## In frameworks

```tsx
<KalemEditor value={text} readOnly={!canEdit} />
```

```vue
<KalemEditor v-model="text" :read-only="!canEdit" />
```

```html
<kalem-editor readonly></kalem-editor>
```

The custom element also has `disabled`, which does the same job — a field
disabled by its form (`<fieldset disabled>` included) is locked
automatically. The editor has no separate "disabled" mode; read-only is
enough, and it's the right behavior: the content stays visible, it just
can't be edited.

## Not setting up the editor at all

If there's **no chance** of editing on the page, don't load the editor.
2.9 kB instead of 29 kB:

```ts
import { parse } from '@kalem-editor/core';
import { renderToDOM } from '@kalem-editor/viewer';

renderToDOM(parse(markdown), document.getElementById('app')!);
```

```ts
import '@kalem-editor/themes/tokens.css';
import '@kalem-editor/themes/viewer.css';
// editor.css and ui.css aren't needed
```

The rule is simple: **if there's any chance of editing**, starting the
editor in read-only mode is less work; **if there's none**, the viewer is
smaller.

## Side-by-side preview

Editing a document and showing it live at the same time:

```ts
import { renderToDOM } from '@kalem-editor/viewer';

const editor = new Editor(left, {
  value: md,
  onChange: (_markdown, doc) => renderToDOM(doc, right),
});
```

`onChange` also provides the AST as its second argument, so you don't need
to parse the text again.

## Where permission checks belong

Read-only mode is a **UI** convenience, not a security boundary. A user can
call `editor.setReadOnly(false)` from the console. Permission checks belong
on the server: your save endpoint must decide for itself who can change
what.
