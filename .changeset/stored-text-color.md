---
"@kalem-editor/editor": minor
---

`setColor` with only a caret now stores the color: the text typed next at
that spot gets it, as in Word. Moving the caret forgets it. `getColor`
reports the stored color while the caret stays there. The typed run is one
undo step.
