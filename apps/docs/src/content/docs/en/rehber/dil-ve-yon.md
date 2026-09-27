---
title: Language and direction
description: Where the document language comes from, how the UI is translated, right-to-left text, and Turkish casing rules.
---

There are two separate language-dependent jobs in Kalem, and the second one
is usually forgotten:

1. **Translation** — which language the UI speaks.
2. **Locale-sensitive behavior** — upper/lower case, search, number format.
   When these are wrong, nothing crashes; they just work wrong. A
   `toLowerCase()` that was tested and passes in English can't match a
   search for "IŞIK" with "ışık" in Turkish.

Both are fed from the same place: **the document language**.

## Where the document language comes from

```ts
import { Editor } from '@kalem-editor/editor';

const editor = new Editor(element, { lang: 'en' });
editor.getLang(); // "en"
```

The `lang` option is written to the element's `lang` attribute. If it isn't
given, in order:

| Order | Source | When it helps |
| --- | --- | --- |
| 1 | The `lang` of the element or its nearest ancestor | When part of the page is in a different language |
| 2 | `<html lang>` | When the element isn't attached to the document yet |
| 3 | `navigator.language` | When the page declares no language — the user's browser |
| 4 | `"en"` | When none of the above exists |

The UI, the custom element and every plugin read the language **from here**;
no part decides on its own. `lang=""` means "unknown language" in HTML and
is skipped.

:::note[The language is read at mount time]
The UI and plugins read the language once, when they're set up. After
changing the language, mount the UI again — the same model as the toolbar
mode:

```ts
import { mountUi } from '@kalem-editor/ui';

editor.getElement().lang = 'tr';
ui.destroy();
ui = mountUi(editor);
```
:::

## UI strings

**Every** string the UI shows comes from a dictionary: toolbar tooltips,
slash menu labels, menus, screen reader announcements, user-facing error
messages. No component carries strings of its own.

Turkish and English are built in. If the language starts with `tr` (`tr`,
`tr-TR`, `tr-CY`), Turkish is chosen; otherwise English.

Every package has its own dictionary, and they're all exported the same way:

| Package | Type | English | Turkish |
| --- | --- | --- | --- |
| `@kalem-editor/ui` | `UiLabels` | `enLabels` | `trLabels` |
| `@kalem-editor/wc` | `WcLabels` | `enWcLabels` | `trWcLabels` |
| `@kalem-editor/plugin-find-replace` | `FindLabels` | `enFindLabels` | `trFindLabels` |
| `@kalem-editor/plugin-outline` | `OutlineLabels` | `enOutlineLabels` | `trOutlineLabels` |
| `@kalem-editor/plugin-word-count` | `WordCountLabels` | `enWordCountLabels` | `trWordCountLabels` |
| `@kalem-editor/plugin-source-mode` | `SourceLabels` | `enSourceLabels` | `trSourceLabels` |
| `@kalem-editor/plugin-image-upload` | `ImageLabels` | `enImageLabels` | `trImageLabels` |
| `@kalem-editor/plugin-autosave` | `AutosaveLabels` | `enAutosaveLabels` | `trAutosaveLabels` |

Errors thrown for developers (misusing the API, `throw new Error(...)`)
aren't UI strings; they're always in English.

### Changing a single string

```ts
import { mountUi, enLabels } from '@kalem-editor/ui';

mountUi(editor, {
  labels: { ...enLabels, editor: 'Product description' },
});
```

### Adding another language

A dictionary is a plain object; its type makes the compiler point out any
missing key. A German UI:

```ts
import { mountUi, enLabels, type UiLabels } from '@kalem-editor/ui';
import { wordCountPlugin, type WordCountLabels } from '@kalem-editor/plugin-word-count';

const deLabels: UiLabels = {
  ...enLabels,          // untranslated keys stay in English
  editor: 'Dokument',
  bold: 'Fett',
  italic: 'Kursiv',
  // …
};

const zahl = new Intl.NumberFormat('de');
const deCounter: WordCountLabels = {
  title: 'Dokumentstatistik',
  words: (n) => `${zahl.format(n)} ${n === 1 ? 'Wort' : 'Wörter'}`,
  characters: (n) => `${zahl.format(n)} Zeichen`,
  minutes: (n) => `${zahl.format(n)} Min. Lesezeit`,
};

mountUi(editor, { labels: deLabels });
editor.addPlugin(wordCountPlugin({ container, labels: deCounter }));
```

Strings that take a number are functions, because **plural rules depend on
the language**: "1 word / 2 words" in English, "kelime" for both in Turkish,
"Wort / Wörter" in German.

### Your plugin's own strings

If you're writing a plugin, follow the same pattern: your own dictionary
type, two ready-made dictionaries and a `labels` option. Don't resolve the
language yourself, take it from the context — that way you always speak the
same language as the UI:

```ts
import type { Plugin } from '@kalem-editor/editor';

export function myPlugin(options: { labels?: MyLabels } = {}): Plugin {
  return {
    name: 'my-plugin',
    setup(context) {
      const labels = options.labels ?? labelsFor(context.getLang());
      // …
    },
  };
}
```

## Numbers

The word counter formats numbers in the document's language:

| Language | Output |
| --- | --- |
| Turkish | 12.345 kelime |
| English | 12,345 words |

The thousands separator is **reversed** between the two languages — the
wrong one reads as a different number. An English reader would take
"12.345" as twelve point three four five.

## Turkish upper/lower case

In Turkish, the uppercase of `i` isn't `I` but `İ`, and the lowercase of `I`
isn't `i` but `ı`. A plain `toLowerCase()` doesn't know this and works
wrong **silently**. Writing a bare `toLowerCase()` in Kalem's code stops the
build; so does a locale-less `Intl.NumberFormat()` and an argument-less
`toLocaleString()`.

The two searches apply this rule **deliberately differently**:

| | Slash menu search | Find and replace |
| --- | --- | --- |
| `IŞIK` vs `ışık` | matches | matches |
| `İYİ` vs `iyi` | matches | matches |
| `ılık` vs `ilik` | **matches** | **doesn't match** |
| `bas` vs `Başlık` | matches | doesn't match |

The reason for the difference is their job:

- **The slash menu searches for a command.** A user without `ı` or `ş` on
  their keyboard types `/bas` and should find "Başlık". Loose matching is a
  convenience.
- **Find and replace changes text.** If a user replacing "ılık" with "sıcak"
  also had the word "ilik" in their document changed, that's **data loss**.
  Here looseness is a bug.

### The table of contents isn't sorted

The table of contents panel shows headings **in document order**, not
alphabetically — the reader wants to see the next section. No case
conversion is applied to heading text: "IŞIK" stays "IŞIK", "İŞİK" stays
"İŞİK".

## Right-to-left text

`dir="rtl"` has basic support:

```html
<div id="editor" dir="rtl" lang="ar"></div>
```

- **The block handle** moves to the start of the line, i.e. to the right;
  so does the space reserved for it.
- **The quote bar**, **list indentation**, **table of contents indentation**
  and **table cell alignment** are mirrored.
- Writing direction and caret movement are the browser's job; the editor
  brings them down to Markdown without breaking the model.

The direction is read from **the computed style**, not the `dir` attribute,
so a `dir` on an ancestor or a CSS `direction` works too.

:::caution[What basic support means]
Two things aren't mirrored, both on purpose:

- **Table column alignment.** In Markdown, `:---` and `---:` are where the
  author **explicitly** said left and right; they aren't flipped by
  direction.
- **Mixed-direction documents.** A document can have both left-to-right and
  right-to-left paragraphs, but the direction is set for the whole editor,
  not per block.

This hasn't been tested with real users of right-to-left languages. If you
run into a problem, please report it.
:::
