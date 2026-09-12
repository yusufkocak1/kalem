---
title: React
description: <KalemEditor />, useKalem ve useKalemValue.
---

```bash
npm i @kalem/react @kalem/editor @kalem/themes
```

`react` bir **peer bağımlılık** (`>=17`); paket kendi kopyasını getirmiyor.
Kendi boyutu 903 B.

## Kontrolsüz (çoğu kullanım)

Metin editörde yaşıyor, React karışmıyor:

```tsx
import { KalemEditor } from '@kalem/react';

<KalemEditor
  defaultValue="# Merhaba"
  lang="tr"
  label="Belge"
  onChange={(markdown) => kaydet(markdown)}
/>
```

## Kontrollü

Metin üst bileşende:

```tsx
const [metin, setMetin] = useState('# Merhaba');

<KalemEditor value={metin} onChange={setMetin} lang="tr" label="Belge" />
```

Kontrollü kipin klasik tuzağı sonsuz döngü: kullanıcı yazıyor → `onChange`
→ `setState` → `value` değişiyor → editöre yazılıyor → **imleç başa
kaçıyor**. Sarmalayıcı editörün kendi yaydığı metni hatırlıyor ve gelen
`value` ona eşitse hiçbir şey yapmıyor. Yani yalnızca gerçekten dışarıdan
gelen bir değişiklik editöre iniyor.

## Prop'lar

| Prop | Tip | Not |
|---|---|---|
| `value` | `string` | Kontrollü metin |
| `defaultValue` | `string` | Kontrolsüz başlangıç metni |
| `onChange` | `(value: string, doc: Root) => void` | |
| `onReady` | `(editor: Editor) => void` | İmperatif erişim |
| `readOnly` | `boolean` | |
| `lang` · `label` · `plugins` | | **Montaj anında** okunuyor |
| `className` · `style` · `id` | | Kutuya iniyor |
| `children` | `ReactNode` | Editörün **yanına** çiziliyor |

:::note[Neden bazıları montaj anında]
Kurulum imleci, seçimi ve geçmişi sıfırlıyor. `lang`, `plugins` ve `label`
sonradan değiştirilirse yeni bir editör gerekirdi; kullanıcının yazdığı
yeri kaybetmesi, bir prop'un geç uygulanmasından kötü. Değişebilen iki şey
— `value` ve `readOnly` — editörün kendi API'siyle güncelleniyor.

Geri çağırmalar istisna: bir ref'te tutuluyorlar, yani satır içi yazılan
`onChange={() => …}` editörü yeniden kurmuyor.
:::

## Kancalar

`<KalemEditor>`in **çocuğu** olan bileşenler için:

```tsx
import { KalemEditor, useKalem, useKalemValue } from '@kalem/react';

function Durum() {
  const editor = useKalem();          // Editor | null
  const metin = useKalemValue();      // string, değiştikçe yeniden çiziyor

  return (
    <p>
      {metin.length} karakter
      <button onClick={() => editor?.focus()}>Odağı ver</button>
    </p>
  );
}

<KalemEditor defaultValue={md} lang="tr" label="Belge">
  <Durum />
</KalemEditor>
```

`useKalemValue` `useSyncExternalStore` üzerine kurulu: eşzamanlı render'da
yırtılma (aynı ağacın iki bileşeninin farklı metin görmesi) ve abonelik
öncesi kaçırılan güncelleme — ikisi de kapalı.

:::tip[`children` editörün içine konmuyor]
Düzenlenebilir alanın içi modelden çiziliyor; React'in oraya koyduğu her
düğüm ilk render'da silinirdi. Yuva içeriği kutunun **yanında**.
:::

## Strict Mode

React'in geliştirme kipi her etkiyi kurup söküp yeniden kuruyor.
Sarmalayıcı bunu tek editörle atlatıyor ve bir tarayıcı testi bunu
sabitliyor — `<StrictMode>`u kapatmanız gerekmiyor.

## Next.js App Router

Paket derleme çıktısında kendi `"use client"` yönergesini taşıyor, yani
bir sunucu bileşeni `<KalemEditor>`ü doğrudan import edebiliyor —
`transpilePackages` ya da `dynamic(… { ssr: false })` gerekmiyor.

Ayrıntı: [Next.js](/frameworkler/nextjs/).

## Eklentiler

`plugins` montaj anında okunuyor; sonradan eklemek için `onReady`:

```tsx
<KalemEditor
  defaultValue={md}
  onReady={(editor) => editor.addPlugin(codeHighlightPlugin())}
/>
```

Panel isteyen eklentiler (içindekiler, kelime sayacı) React'in çizdiği bir
kaba ihtiyaç duyuyor. Kalıbın tamamı için
[Kalem Notlar](https://github.com/kalem-editor/kalem/blob/main/apps/notlar/src/Arayuz.tsx)
uygulamasına bakın.
