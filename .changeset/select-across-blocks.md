---
"@kalem-editor/editor": patch
---

Selecting across blocks works with the keyboard and Shift+click, not only by
dragging: Shift+click in another block selects the blocks between, Shift+Up
or Shift+Down at a block's first or last character goes on into the next
block, and Ctrl+A pressed again selects the whole document. Selected blocks
copy and cut wherever the focus is: Copy is no longer disabled when the
browser has no selection of its own.
