---
"@kalem-editor/editor": patch
---

Text typed after `**bold**`, `` `code` ``, `_italic_` or `~~strike~~` is plain. The input rule left the caret inside the new mark and the browser typed on into it: `**kalın** sonra` was saved as `**kalın sonra**`. The marker typed (`_` or `*`) is kept, also when the paragraph is edited later; an edited line used to write every `_a_` as `*a*`.
