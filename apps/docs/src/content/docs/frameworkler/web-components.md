---
title: "Web Components: <kalem-editor>"
description: Çerçeve gerektirmeyen yol — tarayıcının kendi bileşen modeli.
---

Çerçeve başına bir paket yazmanın sonu yok. `@kalem/wc`, editörü
tarayıcının kendi bileşen modeline paketliyor: **Svelte, Angular, Astro,
Rails, Django ve düz HTML — hepsinde aynı etiket.**

```bash
npm i @kalem/wc @kalem/themes
```

Kendi boyutu 1,98 kB (editör hariç).

```ts
import { defineKalemEditor } from '@kalem/wc';
defineKalemEditor();
```

```html
<kalem-editor label="Belge" name="icerik">
    # Merhaba

    Yazmaya başlayın.
</kalem-editor>
```

Tek satırlık kurulum da var: `import '@kalem/wc/define';`

:::note[Kayıt neden otomatik değil]
`customElements.define` global bir isim alanına yazıyor ve aynı adı iki kez
kaydetmek **hata atıyor**. Import edilir edilmez kaydeden bir kütüphane,
aynı sayfada iki sürümü bulunan bir uygulamayı (mikro-ön uç, iki
bağımlılığın farklı sürümleri) açılışta patlatırdı.

Çağrı **tekrarlanabilir**: ad zaten kayıtlıysa `false` dönüyor, hata
vermiyor.
:::

## Başlangıç metni elemanın içinde

Çok satırlı Markdown'ı bir özniteliğe sıkıştırmanız gerekmiyor. Sayfanın
girintisi sökülüyor — yoksa Markdown onu **kod bloğu** sayardı:

```html
<kalem-editor>
    ## Başlık

    * liste
</kalem-editor>
```

`<script type="text/markdown">` çocuğu da aynı yoldan okunuyor: tarayıcı
bilmediği tipi çalıştırmıyor ama metni `textContent`e katıyor, yani eleman
yükselmeden önce ham Markdown ekranda görünmüyor.

## Öznitelikler

| Öznitelik | Ne |
|---|---|
| `value` | Metin. **Sonradan değiştirmek de çalışıyor** (aşağıya bakın) |
| `readonly` | Salt okunur |
| `required` | Form doğrulaması: boş belge geçersiz |
| `required-message` | Doğrulama mesajı; verilmezse belge diline göre |
| `label` | Erişilebilir ad |
| `name` | Form alanı adı |
| `disabled` | Form tarafından devre dışı |
| `shadow` | Gölge DOM (varsayılan **kapalı**) |

`lang` listede yok ve bu bir eksiklik değil: düzenlenebilir alan elemanın
çocuğu, `lang` DOM'da kalıtımla iniyor ve tarayıcının yazım denetimi
sözlüğünü zaten o seçiyor.

:::note[`value` özniteliği `<input>`ten ayrılıyor]
Platformda `value` özniteliği yalnızca **başlangıç** değeri; kullanıcı
yazdıktan sonra değiştirmek hiçbir şey yapmıyor. Burada yapıyor, çünkü
çerçevelerin özel elemanlara bağlanma yolu çoğu zaman öznitelik ve
bağlamanın sessizce çalışmaması en kötü sonuç. Form sıfırlamasının ihtiyaç
duyduğu ilk değer ayrı: `defaultValue`.
:::

## Özellikler

`value`, `defaultValue`, `readOnly`, `required`, `label`,
`requiredMessage`, `name`, `plugins`, `styles` — hepsi yazılabilir.
Okunabilenler: `editor` (örneğin kendisi), `editorElement`, `form`,
`validity`, `validationMessage`, `willValidate`.

Metotlar: `focus()`, `checkValidity()`, `reportValidity()`.

```ts
const el = document.querySelector('kalem-editor')!;
el.value = '# Başka belge';       // olay yaymıyor (platform kuralı)
el.editor?.toggleMark('strong');
```

## Olaylar

| Olay | Ne zaman | Taşıdığı |
|---|---|---|
| `input` | Her değişiklikte | `event.detail.value` ve `event.target.value` |
| `change` | Odak editörden çıkarken, metin değiştiyse | — |
| `kalem-ready` | Editör kurulduğunda | `event.detail.editor` |

`contenteditable`ın kendi `input` olayı elemanın içinde **kesiliyor** ve
yerine metni taşıyan bir `CustomEvent` yayılıyor. Kesilmeseydi dinleyici
her tuşta iki olay görürdü ve birinde `event.target` içerideki blok
elemanı olurdu — yani `event.target.value` `undefined` dönerdi.

Programla yapılan `el.value = '…'` **olay yaymıyor**; platformun form
denetimleriyle aynı kural.

## Form entegrasyonu

Eleman `ElementInternals` ile forma bağlanıyor: `name`, `required`,
sıfırlama, `disabled` ve tarayıcı geri/ileri gezinmesinde durum geri
yükleme — hepsi platformun kendi akışı.

```html
<form>
  <kalem-editor name="ozet" required label="Özet"></kalem-editor>
  <button type="submit">Gönder</button>
</form>
```

`FormData` metni doğrudan taşıyor; arada JavaScript yok.

## Gölge DOM — opsiyonel, varsayılan kapalı

Gölge kök stilleri dışarıda bırakıyor: `@kalem/themes` sayfanın genelinde
tanımlı ve gölgeye **girmiyor**. Varsayılan açık olsaydı editör her
kurulumda stilsiz açılır, herkes bir geçici çözüm arardı.

Açık olması gereken durum da gerçek — yabancı bir sayfaya gömülen bir
widget'ta sayfanın `p { margin: 0 }` kuralı belgeyi bozuyor:

```html
<kalem-editor shadow label="Belge"></kalem-editor>
```

```ts
el.styles = `
  p { margin: 0 0 0.6em; }
  h2 { font-size: 15px; }
`;
```

Gölge kök `open` modda, yani `el.shadowRoot.adoptedStyleSheets` ile
hazır stil sayfası da verebilirsiniz.

## Stil

Özel elemanlar varsayılan olarak `display: inline`.
`@kalem/themes/editor.css` bunu düzeltiyor:

```css
:where(kalem-editor) { display: block; }
```

Tek satır bu dosyada duruyor çünkü elemanın kendisi inline stille
yazsaydı, sayfanın `display: flex` demesini imkânsız kılardı.

## Elemanı taşımak

DOM'da yer değiştiren bir eleman önce sökülüp sonra takılıyor. Söküm bir
mikrogörev geciktirildiği için `parent.append(el)` **içeriği, geçmişi ve
imleci koruyor**.

## Çerçevelerde

- [Svelte](/frameworkler/svelte/)
- [Angular](/frameworkler/angular/)
- [CDN / düz HTML](/frameworkler/cdn/)
