import type { Lang } from "../shared/i18n.js";

const TR = `# Kalem'e hoş geldiniz

Kalem, **Word rahatlığında** yazdığınız ama diske *düz Markdown* olarak kaydedilen bir editördür. Bu belge bir örnek; dilediğiniz gibi değiştirin ya da \`Ctrl+N\` ile boş bir sayfa açın.

## Yazarken

- Metni seçince beliren **balon çubuğu** ya da üstteki şerit ile biçimlendirin.
- Boş bir satırda \`/\` yazarak başlık, liste, tablo ya da kod bloğu ekleyin.
- Bloğun solundaki tutamaçla paragrafları sürükleyip yeniden sıralayın.
- Markdown biliyorsanız doğrudan yazın: \`# \` başlık, \`- \` liste, \`**kalın**\` kalın olur.

## Belgeler

1. **Dosya → Aç** ile bir \`.md\` dosyası açın ya da dosyayı pencereye sürükleyin.
2. **Dosya → Word'den İçe Aktar** ile bir \`.docx\` belgesini Markdown'a çevirin.
3. Görselleri yapıştırın ya da sürükleyin; belgenin yanındaki \`.assets\` klasörüne kaydedilir.

- [x] Kalem'i açtım
- [ ] İlk belgemi kaydettim
- [ ] Bir Word belgesini içe aktardım

## Kısayollar

| İşlem | Kısayol |
| --- | --- |
| Kaydet | \`Ctrl+S\` |
| Kalın · İtalik | \`Ctrl+B\` · \`Ctrl+I\` |
| Bağlantı | \`Ctrl+K\` |
| Başlık 1–6 | \`Ctrl+Alt+1\` … \`6\` |
| Bul · Değiştir | \`Ctrl+F\` · \`Ctrl+H\` |
| Markdown kaynağı | \`Ctrl+Shift+M\` |

> Belgeleriniz her zaman sizin: düz metin, her editörde açılır.

\`\`\`js
// Kod blokları renklendirilir.
const selam = "Merhaba, Kalem!";
\`\`\`
`;

const EN = `# Welcome to Kalem

Kalem is an editor that feels **as easy as Word** but saves your writing as *plain Markdown*. This document is a sample; change it freely or press \`Ctrl+N\` for a blank page.

## While writing

- Format with the **bubble toolbar** that appears on selection, or with the ribbon above.
- Type \`/\` on an empty line to insert a heading, list, table or code block.
- Drag the handle on the left of a block to reorder paragraphs.
- If you know Markdown, just type it: \`# \` makes a heading, \`- \` a list, \`**bold**\` bold.

## Documents

1. Open a \`.md\` file with **File → Open**, or drop it onto the window.
2. Convert a \`.docx\` document to Markdown with **File → Import from Word**.
3. Paste or drop images; they are saved in the \`.assets\` folder next to the document.

- [x] Opened Kalem
- [ ] Saved my first document
- [ ] Imported a Word document

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Save | \`Ctrl+S\` |
| Bold · Italic | \`Ctrl+B\` · \`Ctrl+I\` |
| Link | \`Ctrl+K\` |
| Heading 1–6 | \`Ctrl+Alt+1\` … \`6\` |
| Find · Replace | \`Ctrl+F\` · \`Ctrl+H\` |
| Markdown source | \`Ctrl+Shift+M\` |

> Your documents are always yours: plain text that opens in any editor.

\`\`\`js
// Code blocks are highlighted.
const greeting = "Hello, Kalem!";
\`\`\`
`;

export function welcomeDocument(lang: Lang): string {
	return lang === "tr" ? TR : EN;
}
