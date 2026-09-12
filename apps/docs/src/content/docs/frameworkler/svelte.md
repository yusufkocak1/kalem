---
title: Svelte
description: Sarmalayıcı yok — <kalem-editor> sıradan bir DOM elemanı.
---

**Svelte için Kalem paketi yok ve gerekmiyor.** `<kalem-editor>` bir
Custom Element; Svelte onu sıradan bir DOM elemanı gibi ele alıyor.

```bash
npm i @kalem/wc @kalem/themes
```

```svelte
<script lang="ts">
  import '@kalem/wc/define';

  let metin = $state('# Merhaba');
  let saltOkunur = $state(false);
  let el = $state<(HTMLElement & { value: string }) | null>(null);

  function girdi(olay: Event) {
    metin = (olay as CustomEvent<{ value: string }>).detail.value;
  }
</script>

<kalem-editor
  bind:this={el}
  class="editor"
  label="Belge"
  value={metin}
  readOnly={saltOkunur}
  oninput={girdi}
></kalem-editor>

<p>{metin.length} karakter</p>
```

## Svelte özellik mi öznitelik mi yazıyor?

Özel elemanlarda Svelte, **özellik varsa özelliği** yazıyor
(`el.value = …`). Yani çok satırlı Markdown bir özniteliğe sıkışmak
zorunda kalmıyor ve `readOnly` gibi camelCase adlar da çalışıyor.

## Sonsuz döngü kendiliğinden kırılıyor

Elemanın `value` setter'ı, gelen metin güncel metinle aynıysa hiçbir şey
yapmıyor. Kullanıcı yazıyor → olay → `metin` → bağlama aynı metni geri
yazıyor → setter sessizce duruyor. Belge yeniden yüklenmiyor, imleç
yerinde kalıyor.

React ve Vue sarmalayıcıları da aynı şeyi yapıyor; tek farkı orada kancanın
içinde olması.

## Form entegrasyonu

`ElementInternals` sayesinde editör sıradan bir form alanı — Svelte'nin
haberi bile olmuyor:

```svelte
<form onsubmit={(e) => {
  e.preventDefault();
  gonderilen = String(new FormData(e.currentTarget).get('ozet') ?? '');
}}>
  <kalem-editor name="ozet" required label="Özet"></kalem-editor>
  <button type="submit">Gönder</button>
</form>
```

`required` boşken tarayıcı gönderimi engelliyor; `onsubmit` hiç
çalışmıyor.

## İmperatif erişim

```svelte
<button onclick={() => el?.focus()}>Odağı editöre ver</button>
```

`el.editor` editörün kendisini veriyor — eklenti eklemek, geçmişi yoklamak
ya da `mountUi` çağırmak için.

## Stil

```ts
import '@kalem/themes/tokens.css';
import '@kalem/themes/viewer.css';
import '@kalem/themes/editor.css';
import '@kalem/themes/ui.css';
```

Svelte'nin bileşen kapsamlı CSS'i (`<style>` bloğu) editörün **içine**
ulaşmıyor: oradaki düğümleri Svelte üretmediği için `svelte-xxxx` sınıfını
almıyorlar. Belge tipografisini `@kalem/themes` veriyor; kabuğu
(kenarlık, dolgu) `:global()` ile ya da global bir stil dosyasıyla yazın.

## Çalışan örnek

[`examples/svelte`](https://github.com/kalem-editor/kalem/tree/main/examples/svelte)
— Vite + Svelte 5, CI'da derleniyor ve yedi tarayıcı testiyle sınanıyor.

Elemanın tüm yüzeyi: [Web Components](/frameworkler/web-components/).
