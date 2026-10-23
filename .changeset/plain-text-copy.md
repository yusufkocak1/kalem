---
"@kalem-editor/editor": minor
"@kalem-editor/plugin-source-mode": patch
---

Copying puts plain text on the clipboard as it reads, without Markdown's
marks: copied bold text is "bold", not `**bold**`. List items keep a `•` or
their number, table cells are split by tabs. The Markdown goes along under
`text/markdown`, which a paste into Kalem (and into source mode) reads
first, so nothing is lost there. `clipboardText: "markdown"` brings back the
Markdown as the plain text. `plainText` and `MARKDOWN_TYPE` are exported.
