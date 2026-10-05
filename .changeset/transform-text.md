---
"@kalem-editor/editor": minor
---

`editor.transformText(fn)` rewrites the selected text, or the word at the
caret, with `fn` and keeps its formatting: a word split by formatting is
transformed as one word, inline code is left alone, and characters the
function removes come out of the nodes they were in. Meant for case
changes and similar text tools; one undo step.
