---
"@kalem-editor/core": minor
"@kalem-editor/editor": minor
"@kalem-editor/viewer": minor
"@kalem-editor/themes": minor
---

Text color, and pasting into code blocks.

- **Text color.** `<span style="color:…">text</span>` is now parsed into a `color` inline node (`{ type: "color", color, children }`) instead of two raw HTML nodes, and written back byte-for-byte. Only a span whose `style` is a single, safe color value qualifies; every other `<span>` stays raw HTML. The editor gains `setColor(color | null)` and `getColor()`, the viewer renders the span even under the `escape` HTML policy, and `sanitizeColor` is exported from `@kalem-editor/core`. Bold, italic and strikethrough toggle through a color, and the editor keeps the color outside those marks so the Markdown stays valid next to letters. `color` is not an mdast node type: code that switches over `Inline["type"]` may need a case for it.
- **Pasting into a code block** did nothing: the paste was consumed and then dropped because a code block has no inline caret. The clipboard's plain text now goes into the code at the selection, replacing it, as a single undo step.
- Links inside colored text inherit the color (`@kalem-editor/themes`, `viewer.css`).
