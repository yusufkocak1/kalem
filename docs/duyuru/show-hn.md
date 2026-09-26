<!--
Show HN taslağı  (İş listesi: F6-11 → gönderim F6-14)

Gönderimden önce:
- `<PLAYGROUND_URL>` doldurulacak. Playground bugün hiçbir yerde
  barındırılmıyor; `astro.config.mjs`teki `kalem.dev` 403 dönüyor (alan adı
  bizim mi, belli değil).
- Depo herkese açık mı? (bugün private; README'deki CI rozeti ve bağlantılar
  ancak açıldığında çalışır)
- npm'de `@kalem/editor` var mı? (F6-13)
- Dil paragrafı bugünkü durumu söylüyor: doküman sitesi yalnızca Türkçe.
  İngilizce çeviri gönderimden önce biterse paragraf değişmeli.
- Sayılar `pnpm size` ile aynı mı? (`pnpm guard:sizes` bu dosyayı da denetliyor)
- HN metin kutusu Markdown işlemiyor: yalnızca paragraf ve iki boşlukla
  girintili kod. Aşağıdaki metin buna göre yazıldı — biçim ekleme.
- Başlık en fazla 80 karakter.
-->

# Title

Show HN: Kalem – A Word-like editor whose source of truth is Markdown

# URL

https://github.com/yusufkocak1/kalem

# Text

Hi HN. Kalem is a WYSIWYG Markdown editor for people who don't know Markdown: bubble toolbar, slash menu, drag handles, paste from Word. What it saves is Markdown, and lines the user didn't touch come back as they were written.

Why I built it: our content ends up as Markdown (docs, a static site, prompts for AI tools), but the people writing it think in Word. The editors I tried store JSON or HTML and convert to Markdown on save. That conversion normalizes things: `*` lists become `-`, `1)` becomes `1.`, and a one-word fix produces a diff that touches the whole file.

Kalem keeps Markdown as the source of truth. The document model records how each construct was written (list markers, numbering style, emphasis characters, setext vs. ATX headings, fence style), and the serializer writes it back the same way:

    serialize(parse(markdown)) === markdown

That holds byte-for-byte for the habits real authors have (1. 1. 1. numbering, four-space nested lists, trailing whitespace, lazy blockquote lines, Windows paths with backslashes). A few rare patterns are still normalized, like indented continuation lines inside a paragraph. They're listed in the README and I treat each one as a bug.

Other things that may be interesting:

- Block-based engine: each block is its own contenteditable, and the engine owns the model. Zero runtime dependencies.
- Framework-agnostic: vanilla core, thin React and Vue wrappers, and a form-associated <kalem-editor> custom element for Svelte, Angular or plain HTML.
- Size budgets enforced in CI: 13.0 kB for the parser/serializer, 36.3 kB for the editor plus the Word-like UI (min+gzip).
- No innerHTML anywhere. Raw HTML inside Markdown is kept as text, and links go through a protocol allowlist.
- Tests run in Chromium, Firefox and WebKit under a Turkish locale, because locale bugs that pass in English tend to fail in Turkish (the dotted/dotless i breaks naive case folding).

What it doesn't do: tables are only partly editable (cell text yes; adding rows and columns is v1.1), mobile works but isn't polished, and there's no real-time collaboration.

A note on language: I'm in Turkey. The API, types, UI strings and README are in English; the source comments, design docs and (for now) the docs site are in Turkish.

Playground: <PLAYGROUND_URL> (your document is compressed into the URL hash, so shared links never reach a server)

I'd love feedback on the API and on the Markdown edge cases you care about. If you have a document that doesn't round-trip, that's a bug I want to see.
