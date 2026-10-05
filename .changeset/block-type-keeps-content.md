---
"@kalem-editor/core": patch
"@kalem-editor/editor": patch
---

Changing the block type no longer deletes content.

- `setBlockType` leaves tables, lists, quotes and link definitions unchanged instead of replacing them with an empty paragraph, heading or code block; wrapping them in a quote still works.
- `editor.setBlockType({ type: "code" })` inside a table cell turns the selected text into inline code, since a cell cannot hold a code block. Other block types do nothing in a table and return `false`.
