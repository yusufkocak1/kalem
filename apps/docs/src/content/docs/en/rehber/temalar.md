---
title: Themes and UI
description: Color tokens, dark theme and mountUi options.
---

Kalem's look comes from two parts: **CSS files** (`@kalem-editor/themes`) and **UI
components** (`@kalem-editor/ui`). They're independent — you can write your own
toolbar and use the theme, or the other way round.

## CSS layers

Each layer is a separate file; load only what you use.

| File | For | Size (gzip) |
|---|---|---|
| `tokens.css` | Color, typography and spacing tokens — **the base of everything** | 482 B |
| `viewer.css` | Document typography (headings, lists, code, tables) | 869 B |
| `editor.css` | The editing layer (focus ring, block selection) | 357 B |
| `ui.css` | Toolbar, menus, handle, popovers | 1.6 kB |
| `dark.css` | The "whole page is dark" scenario (see below) | 333 B |
| `minimal.css` | Minimal theme — no shadows, no rounding | 221 B |
| `plugin-*.css` | Per-plugin styles | 210–665 B |

```ts
import '@kalem-editor/themes/tokens.css';
import '@kalem-editor/themes/viewer.css';
import '@kalem-editor/themes/editor.css';
import '@kalem-editor/themes/ui.css';
```

A read-only page loads only the first two: there's no point making users
download editing styles they won't use.

## Changing the brand color

The tokens are written at **zero specificity** (inside `:where()`). That
means your own rule wins without `!important` or long selector chains:

```css
.kalem-theme {
  --kalem-accent: #7c3aed;
  --kalem-accent-fg: #ffffff;
}
```

One block recolors the document, the toolbar and the menus. Previously each
layer had its own tokens (`--kalem-accent`, `--kalem-ui-accent`), and when
one was forgotten the toolbar stayed a different color from the document.

### Why the tokens aren't on `:root`

A Markdown library changing the color of the host app's buttons is
unacceptable. The variables are defined only on Kalem's own surfaces:
`.kalem-theme`, `.kalem-doc`, `.kalem-editor` and the floating parts.

:::caution[Your app's shell can't read these variables]
If you try to use the `--kalem-*` values for your own buttons, the rule
becomes **invalid** and the style silently disappears. The app should have
its own palette. This is exactly what happened while writing
[Kalem Notlar](https://github.com/yusufkocak1/kalem/tree/main/apps/notlar).
:::

## Dark theme

There are three cases, and all three are covered:

```css
/* 1. The user made no choice → system preference */
@media (prefers-color-scheme: dark) { … }

/* 2. Explicitly chose dark */
[data-theme="dark"] … { … }

/* 3. Explicitly chose light → light even if the system is dark */
[data-theme="light"] … { … }
```

Your app only changes the attribute on `<html>`:

```ts
document.documentElement.dataset.theme = 'dark';
```

The attribute can be on **an ancestor**; it doesn't have to be on the
editor itself.

:::note[That's not what `dark.css` is for]
That file is for a different case: **the whole page is dark and the user
isn't offered a choice**. It's a separate file for embedding scenarios that
can't write `[data-theme]` — someone putting the library into a CMS block
may not be able to add an attribute to the root element, but they can decide
which CSS gets loaded.

If you load it unconditionally, your theme switch won't work: the editor
stays dark whatever `[data-theme]` says. If you offer a choice, `tokens.css`
is already enough.
:::

## `mountUi`

The whole Word experience in one call:

```ts
import { mountUi } from '@kalem-editor/ui';

const ui = mountUi(editor, { toolbar: 'both' });
// …
ui.destroy();
```

| Option | Type | Default | Description |
|---|---|---|---|
| `toolbar` | `"bubble" \| "fixed" \| "both" \| false` | `"bubble"` | Which toolbar |
| `toolbarGroups` | `readonly ToolbarGroup[]` | all | Group order in the fixed toolbar |
| `slashMenu` | `boolean` | `true` | The `/` menu |
| `slashItems` | `readonly SlashItem[]` | `[]` | Items added to the menu |
| `blockHandle` | `boolean` | `true` | Block handle and drag and drop |
| `linkPopover` | `boolean` | `true` | The Ctrl+K link flow |
| `placeholder` | `boolean` | `true` | Hint text in an empty document |
| `labels` | `UiLabels` | based on the document language | UI strings |
| `locale` | `string` | the document's `lang` | Search comparison language |
| `classPrefix` | `string` | `"kalem-"` | Must match the editor's |

`mountUi` returns a `Ui` object: `bubbleToolbar`, `fixedToolbar`,
`slashMenu`, `blockHandle`, `blockMenu`, `linkPopover`, `liveRegion`,
`labels` and `destroy()`.

### Which toolbar?

- **`"bubble"`** — a bubble that appears on selection. The visible way to
  format for users who don't know the shortcuts; nobody discovers Ctrl+B on
  their own.
- **`"fixed"`** — a fixed bar above the editor. Users used to Word see
  "what's here" without selecting anything.
- **`"both"`** — one for discovery, the other for access.
- **`false`** — neither; you write your own UI.

:::tip[The mode isn't a runtime switch]
`mountUi` is a one-time mount. To change the toolbar, call `ui.destroy()`
and mount again.
:::

### UI strings

The dictionary is chosen from the document language (`tr` → Turkish,
otherwise English); where the language comes from and how to add another
language are on the [Language and direction](/en/rehber/dil-ve-yon/) page.
You can pass your own dictionary:

```ts
import { mountUi, enLabels } from '@kalem-editor/ui';

mountUi(editor, {
  labels: { ...enLabels, editor: 'Product description' },
});
```

## Minimal theme

`minimal.css` removes shadows and rounding and moves the accent color onto
the text itself — the place where the library takes back its "own look"
entirely. A starting point for apps with their own design system.

```ts
import '@kalem-editor/themes/tokens.css';
import '@kalem-editor/themes/viewer.css';
import '@kalem-editor/themes/editor.css';
import '@kalem-editor/themes/ui.css';
import '@kalem-editor/themes/minimal.css'; // last
```
