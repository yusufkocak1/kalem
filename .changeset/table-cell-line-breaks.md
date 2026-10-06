---
"@kalem-editor/core": minor
"@kalem-editor/editor": minor
---

Table cells can hold several lines. A line break in a cell is written as
`<br>` (the only way a GFM cell can hold one, and how GitHub shows it), and
`<br>` in a cell is read back as a line break instead of raw HTML. A cell's
line break used to be written as `\` plus a newline, which split the table
row and lost the rest of the cell on the next load. Pasted tables keep a
cell's paragraphs and list items as separate lines instead of running them
together. In the editor, Enter in a table cell starts a new line in the
cell; it used to do nothing.
