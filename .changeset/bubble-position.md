---
"@kalem-editor/ui": patch
---

The bubble toolbar (and every floating box) is centred over the selection. It was measured before it was `position: fixed`, as wide as the window, and so always pushed to the left edge.
