# @kalem-editor/plugin-source-mode

## 1.0.0

### Major Changes

- First stable release.
  
  Kalem is a WYSIWYG editor for people who don't know Markdown — and its source of truth is Markdown. The document model remembers how each construct was written, so a line the user didn't touch comes back byte-for-byte (a few rare patterns are still normalized; see the known limitations) and git diffs show only real changes.
  
  - **`@kalem-editor/core`** — Markdown parser and serializer (CommonMark plus GFM tables, task lists, strikethrough and autolinks, frontmatter), an immutable mdast-shaped AST, pure edit functions and editor commands. No DOM, no dependencies.
  - **`@kalem-editor/viewer`** — `renderToDOM` and `renderToString` with byte-identical output; no `innerHTML`, raw HTML escaped by default, URL allowlist.
  - **`@kalem-editor/editor`** — a headless block editor engine: one `contenteditable` per block, model-owned selection, undo/redo, input rules, paste from Word/Google Docs/Markdown, a plugin API.
  - **`@kalem-editor/ui`** — bubble and fixed toolbars, `/` slash menu, block handles with drag and drop and keyboard moves, link popover, live-region announcements; English and Turkish strings.
  - **`@kalem-editor/themes`** — plain CSS tokens and layers; light, dark and minimal themes; RTL-ready.
  - **`@kalem-editor/react`, `@kalem-editor/vue`, `@kalem-editor/wc`** — thin wrappers and a form-associated `<kalem-editor>` custom element (also as a single `<script>` IIFE build).
  - **Plugins** — code highlighting, find and replace, image upload, table of contents, word count, source mode, autosave.
  
  Size budgets, lossless round-trip, locale-safe case handling and documentation accuracy are enforced in CI.

### Patch Changes

- Updated dependencies
  - @kalem-editor/core@1.0.0
  - @kalem-editor/editor@1.0.0
