---
"@kalem-editor/plugin-find-replace": patch
---

Closing the find panel no longer scrolls the document. Focus went back to
the caret from before the search with a plain `focus()`, which scrolled
there, or to the top of the document when nothing had been clicked yet.
The current match is now selected (as in browsers and Word) and focus is
given with `preventScroll`.
