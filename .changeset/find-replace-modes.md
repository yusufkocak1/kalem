---
"@kalem-editor/plugin-find-replace": minor
"@kalem-editor/themes": minor
---

Find and replace gets Notepad++'s search modes and a wrap-around switch.
Extended mode decodes `\n`, `\t`, `\xHH`, `\uHHHH` (a line break inside a
paragraph can be found and inserted); regular expression mode takes a
JavaScript pattern, with `$1`, `$&` and `$<name>` in the replacement and an
"Invalid expression" notice while the pattern does not compile. With wrap
around off, next/previous stops at the end of the document. New exports:
`SearchMode`, `compilePattern`, `replacementFor`, `unescapeExtended`;
`replaceOne`/`replaceAll` also take a function for per-match replacements.
`FindLabels` gains optional fields for the new controls.
