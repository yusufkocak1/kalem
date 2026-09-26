---
title: Markdown compatibility
description: Which syntax is supported, and why your writing style is preserved.
---

Kalem's source of truth is **the Markdown text itself**. That isn't a
slogan, it's a tested guarantee:

```ts
import { parse, serialize } from '@kalem/core';

serialize(parse(md)) === md; // byte-for-byte on the test corpus
```

The round-trip is verified byte-for-byte on a corpus of 18 real documents,
checked for idempotence on 652 CommonMark examples and tens of thousands of
random inputs, and re-measured on every CI run. A few rare patterns are
still normalized; they're listed on the [Known limitations](/en/bilinen-kisitlar/)
page.

## Your writing style is preserved

Most editors normalize Markdown to their own "canonical" form: a list you
wrote with `*` comes back as `-`, a `1)` delimiter as `1.`. Kalem doesn't —
the choice is stored in the AST.

| What you write | What's stored |
|---|---|
| `- ` · `* ` · `+ ` | List marker |
| `1.` · `1)` | Ordered list delimiter |
| `1. 2. 3.` · `1. 1. 1.` | Numbering style |
| `1.  text` · `-   text` | Spaces after the marker |
| four-space or two-space nested lists | Indentation before the marker |
| `**bold**` · `__bold__` | Emphasis marker |
| `# Heading` · a heading written with an underline | ATX or setext |
| a short `---` under a long heading | Setext underline length |
| `## Heading ##` | Closing hashes |
| ` ``` ` · `~~~` · indented | Code block style and fence length |
| `[m](u)` · `<url>` · bare URL | Link style |
| `---` · `***` · `___` | The raw form of the horizontal rule |
| `> quote` followed by a line without `>` | Lazy blockquote continuation |
| trailing spaces, blank lines at the start or end | Whitespace |

In practice this means: if a team keeps its Markdown files in git, the diff
of a document opened in Kalem shows **only the lines that actually
changed**.

## Supported syntax

All of CommonMark, plus these parts of GFM:

**Blocks** — paragraph, ATX and setext headings, fenced and indented code
blocks, blockquote, unordered/ordered lists, task lists (`- [x]`), tables,
horizontal rule, raw HTML block, link reference definition (`[name]: url`),
frontmatter (YAML and TOML).

**Inline** — bold, italic, inline code, strikethrough (`~~`), links,
autolinks (`<url>`), bare URLs, images, reference links and images
(`[m][name]`), line breaks (two spaces and backslash), raw HTML.

### Not supported

- **Footnotes** (`[^1]`) — not in CommonMark or in core GFM.
- **Definition lists** (`<dl>`) — not in the Markdown standard.
- **Math** (`$...$`) — the job of a separate plugin.

These are preserved as raw text; so if a document has them, they **don't
disappear**, they just aren't formatted.

## Tables

Tables are parsed, displayed, and **their cell text is editable.** They're
written back to Markdown row by row: an untouched row stays in its raw form
(`TableSyntax.raw`), an edited row is regenerated. The new row keeps the old
row's style — the edge pipes and the cell widths are the same; if the new
text fits in the old width it's padded with spaces, and if it doesn't, only
that cell grows.

Re-aligning the whole table is deliberately not done: changing every row of
a hand-aligned table for a single word would mean changing rows nobody
touched.

:::note[v1.1]
Adding or removing rows and columns, and changing alignment, come with
`@kalem/plugin-table` (decision #5).
:::

## Locale-sensitive behavior

The document's `lang` is the single source, and every comparison uses it.

```ts
new Editor(el, { value: md, lang: 'tr' });
```

In Turkish, the `i/İ` and `ı/I` pairs fold differently from English:

```ts
'IŞIK'.toLowerCase()            // "işik" — the dotless ı became a dotted i
'IŞIK'.toLocaleLowerCase('tr')  // "ışık" ✓
```

The bug **doesn't crash**, it silently gives the wrong answer: a user
searching for `ışık` can't find the line that says `IŞIK`, and doesn't
understand why.

That's why the repository has a **lint rule**: a locale-less
`toLowerCase()` / `toUpperCase()` call fails the build. A line that wants to
opt out has to state its reason (`// kalem-locale-ok: …`).

Where it matters: slash menu search, find and replace, table of contents
ordering and word counting (`Intl.Segmenter`).

If `lang` isn't given, the `lang` of the container or its ancestors is used
— so on a page with `<html lang="tr">` you don't need to pass it separately.

## Raw HTML

Markdown allows raw HTML; Kalem **escapes it by default**
(`html: "escape"`). The policy is configurable:

| Value | What happens |
|---|---|
| `"escape"` (default) | The HTML is shown as text |
| `"strip"` | It's removed entirely |
| `"allow"` | It's handed to the caller's hook |

Details and rationale: [Security](/en/rehber/guvenlik/).

## Serialization options

```ts
import { serialize } from '@kalem/core';

serialize(doc, { /* SerializeOptions */ });
```

| Option | Default |
|---|---|
| `bulletMarker` | `-` |
| `emphasisMarker` | `*` |
| `codeFence` | `` ` `` |
| `orderedDelimiter` | `.` |
| `thematicBreak` | `---` |
| `lineEnding` | LF (the root's own choice wins if it has one) |

These options apply only to nodes where a choice **isn't recorded** — in
other words, they don't reformat the document the user wrote; they decide
how an AST you build from scratch gets written.
