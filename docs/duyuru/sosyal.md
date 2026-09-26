<!--
Kısa duyuru taslakları: r/webdev, X, Bluesky  (İş listesi: F6-14)

Gönderimden önce:
- `<PLAYGROUND_URL>` ve `<DOCS_URL>` doldurulacak (show-hn.md'deki notlar).
- **r/webdev: kişisel proje tanıtımı yalnızca "Showoff Saturday" günü**
  (Cumartesi, UTC). Başka gün atılan gönderi kural 2 gereği siliniyor.
  Başlığa "[Showoff Saturday]" eklenmeli.
- X ve Bluesky'da GIF değil video (`demo.mp4`) — ikisi de GIF'i sıkıştırıp
  bulanıklaştırıyor.
- X 280, Bluesky 300 karakter. Aşağıdaki sayımlar bağlantılar
  doldurulmadan yapıldı; X her bağlantıyı 23 karakter sayıyor.
- Sıra: Show HN (Salı–Perşembe, 14:00–16:00 UTC en iyi saatler) → aynı gün
  X ve Bluesky → dev.to ertesi gün → r/webdev ilk Cumartesi.
- İlk 48 saat: issue'lara ve yorumlara hızlı dönüş. Round-trip
  bildirimlerine öncelik — duyurunun asıl iddiası onlar.
-->

# r/webdev

## Title

[Showoff Saturday] Kalem — a WYSIWYG editor that saves Markdown without rewriting the lines you didn't touch

## Body

I built a WYSIWYG editor for people who don't know Markdown. It feels like Word (bubble toolbar, `/` slash menu, drag handles, paste from Word), but what it saves is Markdown — and a line the user didn't edit comes back exactly as it was written, so git diffs only show real changes.

Most rich-text editors store JSON or HTML and convert to Markdown on save, which normalizes everything: `*` lists become `-`, `1.` `1.` `1.` gets renumbered, four-space nested lists get re-indented. Kalem's parser records how each construct was written and the serializer writes it back the same way.

- Zero runtime dependencies; 36 kB min+gzip for the editor plus the Word-like UI
- Vanilla core, thin React and Vue wrappers, and a `<kalem-editor>` custom element for everything else (it's form-associated, so a plain HTML form submits Markdown)
- Tested in Chromium, Firefox and WebKit, under a Turkish locale on purpose (the dotted/dotless i breaks naive case folding)

Playground: <PLAYGROUND_URL>
Repo: https://github.com/yusufkocak1/kalem

Happy to hear what breaks. If you have a Markdown file that doesn't round-trip, that's the bug I most want to see.

# X

Kalem 1.0: a WYSIWYG editor for people who don't know Markdown — that saves Markdown.

Lines you didn't touch come back byte-for-byte, so your git diffs stay clean.

Zero deps · React, Vue or plain HTML

<PLAYGROUND_URL>

# Bluesky

Kalem 1.0: a Word-like editor whose source of truth is Markdown.

Lines you didn't touch come back byte-for-byte, so git diffs show only real changes.

Zero dependencies. React, Vue, Svelte, Angular or one <script> tag.

<PLAYGROUND_URL>
