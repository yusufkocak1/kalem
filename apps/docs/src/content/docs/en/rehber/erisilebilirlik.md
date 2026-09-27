---
title: Accessibility
description: Keyboard, screen readers, focus management and known limitations.
---

For an editor that aims at the Word experience, keyboard and screen reader
support can't be a "feature to add later": when drag and drop is the only
way, some users can never move a block at all.

## Automated checks

Every CI run performs a WCAG 2.1 A/AA audit with **axe-core** — not on one
screen, but in eight states:

- the initial screen
- with the bubble toolbar open
- with the slash menu open
- with the block menu open
- with the link popover open
- in read-only mode
- in the dark theme
- in the minimal theme

The viewer has two more audits (light and dark theme). A violation = a red
build.

## The editor's identity

The root element carries `role="textbox"` and `aria-multiline="true"`. A
text box **must have a name**; a nameless box is announced by a screen
reader as "edit, multi-line", without ever saying what's being edited.

```ts
new Editor(el, { value: md, label: 'Product description' });
```

You have to choose one of three:

1. pass the `label` option,
2. write `aria-label` / `aria-labelledby` on the root element yourself —
   linking it to a visible heading is best,
3. use `mountUi`; it sets a name from its dictionary.

Since `@kalem-editor/editor` is headless, it contains no user-facing text and **no**
default string is written here: if it were, a Turkish document would be
announced in English.

:::note
An element that already has a name isn't touched. If you linked it to a
visible `<h2>` with `aria-labelledby`, `mountUi` doesn't overwrite it.
:::

Read-only mode is announced with `aria-readonly`.

## Everything from the keyboard

Everything that can be done with a mouse has a keyboard equivalent.

| Task | Keyboard |
|---|---|
| Formatting | `Ctrl+B` · `Ctrl+I` · `Ctrl+E` · `Ctrl+Shift+X` |
| Link | `Ctrl+K` |
| Heading / paragraph | `Ctrl+Alt+1…6` · `Ctrl+Alt+0` |
| List | `Ctrl+Shift+8` · `Ctrl+Shift+7` |
| List level | `Tab` · `Shift+Tab` |
| **Moving a block** | `Ctrl+Shift+↑ / ↓` |
| Block menu | Tab to the handle, then `Enter` |
| Slash menu | `/` then `↑ ↓ Enter` |

Moving blocks is especially important: if drag and drop were the only way,
someone who can't use a pointing device could never change the order of the
document.

## Focus management

- **Toolbars are a single tab stop.** Inside a toolbar you move with `←` `→`
  (roving tabindex). If a fifteen-button toolbar were fifteen tab stops,
  getting back to the text by keyboard would be torture.
- **Focus is returned when a menu closes.** When the slash menu, the block
  menu or the link popover closes, the caret goes back where it was.
- **The focus ring is on the block**, not the container: you can see which
  block you're in.

## Announcements

`mountUi` sets up a **live region** (`aria-live`) and announces results
that aren't visible on screen: a block was moved, a block was deleted,
formatting was applied, how many matches were found.

```ts
const ui = mountUi(editor);
ui.liveRegion.announce('Document saved');
```

An operation that happens silently, for a screen reader user, didn't happen
at all.

## Icons and names

Every button has an accessible name and every decorative icon has
`aria-hidden` — a separate test pins this down. If the icon and the name
were both read, every button would be announced twice.

## Task lists

The `- [x]` checkboxes are real `<input type="checkbox">` elements; their
accessible names come from the item's text.

## Color and contrast

The theme palette meets WCAG AA contrast ratios, and axe measures this in
every theme. Transitions are turned off under `prefers-reduced-motion`.

## Known limitations

:::caution
- **Manual testing with screen readers isn't done yet.** The automated audit
  (axe) catches structural errors, but it doesn't replace a real reading
  session with NVDA and VoiceOver. It will be done before v1.0.
- **Mobile** "works but isn't optimized": documents can be written, and
  touch selection handles are left to the browser's own behavior.
:::
