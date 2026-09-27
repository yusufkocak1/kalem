---
title: Known limitations
description: Where it works, what's missing on mobile, and what's deliberately left out.
---

This page describes what Kalem **doesn't** do. When choosing a library, this
is usually the list that actually helps; we'd rather you have no surprises
after reading it.

## Supported browsers

| Browser | Status | How it's verified |
| --- | --- | --- |
| Chrome / Chromium | Supported | 400+ tests, every run |
| Firefox | Supported | 350+ tests, every run |
| Safari (macOS) | Supported | 380+ tests, every run (WebKit) |
| Edge | Supported | Browser smoke test on a real Edge install |
| iOS Safari | **Works, not optimized** | Smoke test with device emulation |
| Android Chrome | **Works, not optimized** | Smoke test with device emulation |

More than 1,150 browser tests run across the three engines; the counts
differ because of things an engine can't emulate — Firefox doesn't expose
synthetic clipboard data, and `longtask` measurement exists only in
Chromium. The default locale is `tr-TR` — that makes it harder for a
locale-sensitive bug to pass in English and blow up in Turkish.

Since Edge uses the same engine as Chrome (Blink + V8), we don't run every
test twice; what's different is the shell, and the smoke test covers that.

:::note[What "the last two versions" means]
Kalem carries no code specific to any browser version, and the build target
is widely supported modern syntax. The newest APIs it uses are
`ElementInternals` (form integration, only if you use `@kalem-editor/wc`) and
`CompressionStream` (only in the playground's share feature, which turns
itself off when it's missing).
:::

## Mobile

The decision is explicit: mobile **works but isn't optimized**. You can
write your document from a phone, but you won't get the whole Word-like
experience you get on a desktop.

### Works

- Tapping a block and typing, moving the caret to another block.
- Enter for a new block, Backspace to merge.
- Input rules: `# ` heading, `* ` list, `> ` quote, ` ``` ` code.
- The slash menu (typing `/`) — the main way to change a block's type on
  touch devices.
- The fixed toolbar: it wraps onto lines on narrow screens, doesn't
  overflow, and its buttons are touch-sized (above the 24×24 CSS pixels
  WCAG 2.2 asks for).
- The bubble toolbar and the find-and-replace panel stay inside the
  viewport.
- Long code blocks and long links don't scroll the page sideways.

### Missing or uncertain

**The block handle may not appear on narrow screens.** The handle is
positioned to the left of the block, in the margin; if there isn't enough
room, it doesn't show at all — overlapping the text would swallow taps and
selection. Measured: it doesn't appear at 393 px wide, it does at 412 px.
The slash menu and input rules remain as a fallback for changing a block's
type and deleting blocks, but **drag-to-reorder has no touch equivalent**.

**Drag-to-reorder hasn't been verified on a real device.** The handle has
`touch-action: none`, so the browser doesn't treat the finger as a scroll
and cancel the drag. But we haven't measured this on a real phone; device
emulation can't produce the native touch-drag gesture.

**On-screen keyboard behavior hasn't been measured.** Software keyboards
produce `beforeinput` events differently from a physical keyboard:
autocorrect, word completion and composition get in the way. Kalem accounts
for composition (`compositionstart`/`compositionend`) and is tested with a
desktop IME, but how mobile autocorrect interacts with input rules is
**unknown**. The keyboard covering the screen and scrolling the viewport
isn't accounted for either — the caret can end up under the keyboard.

**Native text selection gestures can't be tested by automation.** Selecting
text on mobile means long-pressing and dragging handles, which happens at the
operating system level. We verified that the bubble toolbar appears in the
right place once a selection exists, using a programmatic selection; we
couldn't verify the gesture itself.

**Tablets haven't been tested.** Smoke tests run at phone widths (393 px and
412 px); we haven't measured how the desktop layout or the touch targets
behave at tablet widths.

## Deliberately absent

These aren't gaps, they're **decisions**:

**No virtual scrolling.** Measurement showed it isn't needed: in a
10,000-block document a keystroke costs 13 ms, under one frame. Details on
the [Large documents and performance](/en/rehber/performans/) page.

**No collaborative editing (CRDT).** Kalem is a single-user editor. Because
the model is persistent and edits are pure functions, a sync layer can be
written on top, but the library itself doesn't do it.

**Embedded HTML isn't executed.** Raw HTML inside Markdown is preserved as
text; it's not parsed and inserted into the DOM. The reason is security: user
text is never parsed as HTML anywhere in this library. Details on the
[Security](/en/rehber/guvenlik/) page.

**Link protocols are limited by an allowlist.** Only `http:`, `https:`,
`mailto:`, `tel:` and `ftp:` pass; everything not on the list — including
`javascript:` and anything invented tomorrow — is dropped. Images also accept
`data:image/png|jpeg|gif|webp|avif`; `data:image/svg+xml` is **deliberately
excluded**, because scripts run inside SVG.

**Tables are only partly editable.** Cell text can be edited; only the edited
row is rewritten and column alignment is kept. Adding or removing rows and
columns, and changing alignment, comes with `@kalem-editor/plugin-table` in v1.1.

## Not yet measured

To be honest, these haven't been tested enough to say "it works":

- **Manual testing with a screen reader** (NVDA, VoiceOver). Accessibility
  is checked automatically with `axe` on every run and keyboard navigation
  is pinned down by tests, but the screen reader experience hasn't been
  listened to by a person.

## A few rare Markdown patterns are normalized

A line you didn't touch comes back byte-for-byte for the habits authors
actually have — `1.` `1.` `1.` numbering, four-space nested lists, extra
spaces after the list marker, trailing whitespace, lazy blockquote lines.
A few rare patterns are still normalized: indented continuation lines inside
a paragraph, `#  Heading` with two spaces, blank lines containing only
spaces, and a lazy (unindented) continuation line inside a list item. The
output is equivalent Markdown, but not the same bytes.

## If you hit a limitation

If you run into something that isn't on this list, it may be a bug — report
it with the browser, the device and the document you used.
