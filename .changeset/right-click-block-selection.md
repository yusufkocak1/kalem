---
"@kalem-editor/editor": patch
---

A right click on blocks selected by dragging keeps the selection, so the
context menu's Copy and Cut act on those blocks. The right click used to put
the caret where it was clicked and drop the selection.

Clicking into a block after a block selection ends it even when the caret
was already there; the selection used to stay, and a paste then replaced all
the selected blocks.
