---
title: Nuxt
description: SSR — <ClientOnly> gerekmiyor, belge sunucuda çiziliyor.
---

```bash
npm i @kalem-editor/vue @kalem-editor/editor @kalem-editor/themes
```

```vue
<!-- app/app.vue -->
<script setup lang="ts">
import { KalemEditor } from '@kalem-editor/vue';
import { ref } from 'vue';

const metin = ref('# Işık ve Gölge\n\nSunucuda çizilen belge.');
</script>

<template>
  <KalemEditor v-model="metin" lang="tr" label="Belge" class="editor" />
</template>
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: [
    '@kalem-editor/themes/tokens.css',
    '@kalem-editor/themes/viewer.css',
    '@kalem-editor/themes/editor.css',
    '@kalem-editor/themes/ui.css',
  ],
});
```

Yapılandırmada Kalem'e ait başka bir satır yok.

## `<ClientOnly>` gerekmiyor

Vue dünyasında editör sarmalayıcılarının neredeyse hepsi onu istiyor.
Bedeli görünür: sunucu boş bir kutu gönderiyor, içerik sonradan beliriyor,
arama motoru metni hiç görmüyor.

Kalem'de sunucu belgeyi `@kalem-editor/viewer` ile **gerçekten çiziyor**. Ham
HTTP yanıtında `<h1>` ve `<li>` var; bunu bir test doğruluyor. İlk boyada
okunabilir bir belge görünüyor ve JavaScript yüklendiğinde editör aynı
elemanı devralıyor.

## Hidrasyon uyuşmazlığı nasıl engelleniyor

Vue, sunucudan gelen HTML ile istemcinin ürettiğini karşılaştırıyor. Bu
yüzden `innerHTML` **bir kez** hesaplanıyor ve bileşen yaşadığı sürece
değişmiyor:

- Sunucuda ve istemcinin ilk render'ında aynı dize üretiliyor →
  uyuşmazlık yok. Bir test konsolda tek bir uyarı bile olmadığını
  sabitliyor.
- `v-model` sonradan değişince `innerHTML` prop'u **güncellenmiyor**;
  güncellenseydi Vue elemanın içini silip yeniden yazardı ve editörün
  DOM'u, imleci, geçmişi onunla birlikte giderdi.

Değişiklikler editöre `setValue` ile iniyor — yani montajdan sonra DOM'u
Vue değil editör yönetiyor.

## Sürüm

Sarmalayıcıda Nuxt'a özel tek satır yok; ölçülen şey Vue 3 SSR davranışı
ve Nuxt 3 ile 4'te aynı.

## Sunucuda Markdown → HTML

Editörü hiç yüklemeden, bir Nitro uç noktasında:

```ts
// server/api/onizleme.post.ts
import { parse } from '@kalem-editor/core';
import { renderToString } from '@kalem-editor/viewer';

export default defineEventHandler(async (event) => {
  const { markdown } = await readBody<{ markdown: string }>(event);
  return { html: renderToString(parse(markdown)) };
});
```

`@kalem-editor/core` ve `@kalem-editor/viewer` DOM'a dokunmuyor; bir saflık kapısı bunu
CI'da doğruluyor.

## Çalışan örnek

[`examples/nuxt`](https://github.com/yusufkocak1/kalem/tree/main/examples/nuxt)
— Nuxt 4, CI'da üretim derlemesi yapılıp dört tarayıcı testiyle sınanıyor.
