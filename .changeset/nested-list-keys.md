---
"@kalem-editor/editor": patch
---

Lists at any depth.

- Enter in a nested list item splits it into a new item at the same depth; it used to do nothing, and what was typed next ran into the same item. Enter in an empty nested item moves it one level out.
- Enter at the end of an item with a nested list keeps the nested list, under the new item; it used to be deleted.
- Tab and Shift+Tab work at every depth. Shift+Tab keeps the reading order: the items after the moved one go under it instead of ending up above it.
- Backspace at the start of a nested item moves it one level out.
- Empty nested items get a paragraph to type in, as top-level ones do.
