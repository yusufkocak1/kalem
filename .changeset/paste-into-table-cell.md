---
"@kalem-editor/editor": patch
---

Pasting into a table cell, a list item or a quote now inserts at the
caret. It used to look only at the top-level block: a table carries no
text of its own, so the pasted content was added as a new block below the
table. A multi-block fragment pasted there becomes lines of the cell (or
item), with list items prefixed `• `.
