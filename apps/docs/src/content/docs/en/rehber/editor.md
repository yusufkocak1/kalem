---
title: Editor
description: Options, API, events and keyboard shortcuts.
---

`@kalem-editor/editor` is a **headless** block editor engine: the model, DOM
mapping, selection, keyboard and history. It draws no UI — the toolbar, the
bubble menu and the slash menu live in the [`@kalem-editor/ui`](/en/rehber/temalar/)
package.

## Setup

```ts
import { Editor } from '@kalem-editor/editor';

const editor = new Editor(document.getElementById('app')!, {
  value: '# Heading\n\nParagraph.',
  lang: 'en',
  label: 'Document',
  onChange: (markdown, doc) => console.log(markdown, doc),
});
```

The first argument is the container element. The editor draws one
`contenteditable` element **inside** it for each block; the container itself
isn't editable.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | `""` | Initial Markdown text |
| `onChange` | `(value: string, doc: Root) => void` | — | Whenever the content changes |
| `onSelectionChange` | `(selection: EditorSelection) => void` | — | When the selection changes (across blocks too) |
| `readOnly` | `boolean` | `false` | Content visible, not editable |
| `lang` | `string` | from an ancestor, then `<html lang>`, then the browser | Document language — UI strings, case folding, number format. See [Language and direction](/en/rehber/dil-ve-yon/) |
| `label` | `string` | — | Accessible name (`aria-label`) |
| `classPrefix` | `string` | `"kalem-"` | CSS class prefix |
| `inputRules` | `boolean` | `true` | Typing `# ` makes a heading, `- ` a list |
| `parseMarkdownOnPaste` | `boolean` | `true` | Pasted plain text is parsed if it's Markdown |
| `plugins` | `readonly Plugin[]` | built-ins | **Passing an empty array turns the built-ins off** |

:::note[`onChange` isn't free]
The Markdown is regenerated on every call. If the hook **isn't** provided,
serialization doesn't run at all; if it is, it runs on every keystroke. If
you don't need the text on every keystroke, call `getValue()` when you need
it instead of subscribing to `change`.
:::

:::caution[Why `label` has no default]
`role="textbox"` must carry a name; a nameless text box is announced by a
screen reader as "edit, multi-line" without ever saying **what** is being
edited. Since this package is headless, it contains no user-facing text and
no default string is written here — if it were, a Turkish document would be
announced in English. You have to choose one of three: pass `label`, put
`aria-label`/`aria-labelledby` on the root element yourself, or use
`mountUi` (which sets a name from its dictionary).
:::

## API

### Content

```ts
editor.getValue();              // string — the current Markdown
editor.getDocument();           // Root — the immutable AST
editor.setValue(markdown);      // loads the document from scratch (resets history)
editor.getLang();               // string — the resolved document language
```

`setValue` means "open a different document": IDs are reassigned, every
block is rebuilt and history is reset. Don't call it while the user is
typing.

### Formatting

```ts
editor.toggleMark('strong');            // strong | emphasis | delete | inlineCode
editor.isMarkActive('emphasis');        // boolean
editor.setLink('https://example.com');  // turns the selected text into a link
editor.getActiveLink();                 // { url, title, from, to } | null
```

### Blocks

```ts
editor.getBlockType();                              // e.g. { type: 'heading', depth: 2 }
editor.setBlockType({ type: 'heading', depth: 2 });
editor.getBlockIds();                               // block IDs in order
editor.getBlockElement(id);                         // HTMLElement | undefined
editor.selectBlocks(anchorId, focusId);
```

### Selection and caret

```ts
editor.getSelection();   // { kind: 'text', blockId, collapsed } | { kind: 'block', … } | null
editor.getCaret();       // Caret | null
editor.getTextRange();   // { from, to } | null — character range within a block
editor.focus();
```

### History

```ts
editor.undo();     // boolean — whether something was undone
editor.redo();
editor.canUndo();
editor.canRedo();
```

### State and lifecycle

```ts
editor.setReadOnly(true);
editor.isReadOnly();
editor.getElement();      // the root element
editor.destroy();
```

`destroy()` **leaves** the DOM content in place; it doesn't delete it:
leaving an empty box where an editor was torn down would make users think
their content was lost. Editability is removed and a read-only document
remains.

### Events

```ts
const unsubscribe = editor.on('change', (value, doc) => { … });
editor.on('selectionchange', (selection) => { … });
editor.on('readonlychange', (readOnly) => { … });

unsubscribe(); // releases the subscription
```

There are three events: `"change"`, `"selectionchange"`, `"readonlychange"`.
`on` returns an **unsubscribe function**.

### Plugins

```ts
editor.addPlugin(codeHighlightPlugin());
editor.removePlugin('kalem-code-highlight');
editor.plugins; // registered plugin names, in registration order
```

Details: [Plugins](/en/rehber/eklentiler/).

## Keyboard shortcuts

### Formatting

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + B` | Bold |
| `Ctrl/Cmd + I` | Italic |
| `Ctrl/Cmd + E` | Inline code |
| `Ctrl/Cmd + Shift + X` | Strikethrough |
| `Ctrl/Cmd + K` | Link (with `@kalem-editor/ui`) |

`Ctrl+U` is **deliberately blocked and does nothing**: Markdown has no
underline; if it weren't blocked, the browser would produce `<u>` and that
would silently disappear on the next read. A key the user pressed vanishing
without a trace is worse than no reaction at all.

### Blocks

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Alt + 1…6` | Heading (level) |
| `Ctrl/Cmd + Alt + 0` | Paragraph |
| `Ctrl/Cmd + Shift + 8` | Bulleted list |
| `Ctrl/Cmd + Shift + 7` | Numbered list |
| `Tab` / `Shift + Tab` | Indent / outdent a list item |
| `Ctrl/Cmd + Shift + ↑ / ↓` | Move the block (with `@kalem-editor/ui`) |

The list shortcuts use the same keys as Word and GitHub.

### Editing

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` · `Ctrl + Y` | Redo |
| `Ctrl/Cmd + Shift + V` | Paste without formatting |
| `Enter` | Split the block |
| `Backspace` (at block start) | Merge with the previous block |
| `Delete` (at block end) | Merge with the next block |

Brought by plugins: `Ctrl+F` find, `Ctrl+H` replace,
`Ctrl+Shift+M` raw Markdown source.

## Input rules

Automatic conversion while typing is on by default:

| You type | What happens |
|---|---|
| `# ` … `###### ` | Heading |
| `- ` · `* ` · `+ ` | Bulleted list |
| `1. ` · `1) ` | Numbered list |
| `> ` | Quote |
| ` ``` ` | Code block |
| `---` | Horizontal rule |
| `**bold**` · `*italic*` · `` `code` `` | Inline formatting |

The conversion is written as **a separate history entry**: a single
`Ctrl+Z` cancels the rule and leaves the text exactly as typed. That's the
only sensible answer to "I typed `# ` but didn't want a heading".

Turn it off with `inputRules: false`.

## Pasting

Kalem tells three sources apart: Word/Google Docs HTML, plain Markdown text,
and Kalem's own clipboard. A list pasted from Word arrives as a list, bold
text as bold — not a soup of `<span style="font-weight:700">`.

Plain text is parsed only if it **really looks like Markdown**;
`parseMarkdownOnPaste: false` turns this off entirely. `Ctrl+Shift+V` does a
one-off paste without formatting.

## Read-only

```ts
editor.setReadOnly(true);
```

The content stays visible, editability is removed and the `readonlychange`
event fires — the UI layer disables its buttons accordingly. Being notified
instead of polling means `@kalem-editor/ui` never has to query the editor.
