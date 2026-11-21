---
"@kalem-editor/core": patch
---

Files that went through parse and serialize unchanged now come back byte for byte in more cases:

- A tab after a list marker (`-\tmadde`) no longer eats the first characters of the item, and the tab is written back. Continuation lines of such an item are indented with tabs.
- A fenced code block indented by one to three spaces keeps its indent, and a code block indented with tabs keeps its tabs instead of losing columns on every save.
- Backslash escapes the author wrote are kept even where they were not needed (`\*`, `\#`, `\,`), so `$$` math with `\,` is no longer changed.
- `[a]()` stays `[a]()` and `[a](<url>)` keeps its angle brackets; emphasis in an image's alt text (`![*a*](x.png)`) is kept.
- A paragraph's leading spaces on its first line and blank `>` lines at the start of a blockquote are kept.
