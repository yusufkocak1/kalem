---
"@kalem-editor/plugin-source-mode": patch
---

Switching to the Markdown source and back no longer jumps to the top of the
document. The block at the top of the view is found and its line in the
source is brought to the same height, with the cursor on it; on the way
back, the block the source's top line falls in is brought to the same
place, and focus goes to it with `preventScroll`. A source longer than the
rendered document makes the text box as tall as its text, so only the page
scrolls.
