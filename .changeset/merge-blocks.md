---
"@kalem-editor/core": minor
"@kalem-editor/editor": minor
---

Merging blocks.

- `editor.mergeBlocks()` merges the selected blocks into the first one; with only a caret it merges the caret's block into the one above. `editor.canMergeBlocks()` reports whether that is possible, and the pure `mergeBlocks(doc, from, count)` is exported for headless use. Paragraphs and headings are joined line by line with hard breaks; a code block takes the others as code lines, a list as items and a quote as its content. Tables, thematic breaks, raw HTML and frontmatter are refused.
- Turning a paragraph into a code block (`setBlockType`) now keeps hard line breaks as code lines; the lines used to run together.
