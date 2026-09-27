# `@kalem-editor/wc` — Vite + Svelte 5

```bash
pnpm --filter example-svelte dev
```

**Svelte için Kalem paketi yok ve gerekmiyor.** `<kalem-editor>` bir Custom
Element; Svelte onu sıradan bir DOM elemanı gibi ele alıyor.

```svelte
<script lang="ts">
  import "@kalem-editor/wc/define";
  let metin = $state("# Merhaba");
</script>

<kalem-editor value={metin} oninput={(e) => (metin = e.detail.value)}></kalem-editor>
```

Svelte özel elemanlarda, **özellik varsa özelliği** yazıyor (`el.value = …`),
yani çok satırlı Markdown bir özniteliğe sıkışmak zorunda kalmıyor.

Sonsuz döngü elle kırılmıyor: elemanın `value` setter'ı gelen metin güncel
metinle aynıysa hiçbir şey yapmıyor.

Sayfadaki ikinci editör bir **form alanı** — `name`, `required` ve
sıfırlama tarayıcının kendi akışından geçiyor, Svelte'nin haberi bile yok.
