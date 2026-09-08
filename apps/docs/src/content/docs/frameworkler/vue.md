---
title: Vue
description: Vue 3 ve Nuxt ile kullanım — projenize React sızmadan.
---

```bash
npm i @kalem/editor @kalem/ui @kalem/vue
```

:::tip[Framework sızıntısı yok]
`@kalem/editor` ve `@kalem/ui` saf TypeScript'tir; `dependencies` alanları boştur.
`@kalem/vue` yalnızca Vue'yu `peerDependency` olarak alır. Bu kurulumdan sonra
`node_modules` içinde React bulunmaz — CI'daki *saflık kapısı* testi bunu her
commit'te doğrular.
:::

## v-model ile

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { KalemEditor } from '@kalem/vue';
import { toolbar, slashMenu, dragHandle } from '@kalem/ui';
import '@kalem/themes/default.css';

const icerik = ref('# Merhaba\n\nYazmaya başlayın.');
</script>

<template>
  <KalemEditor v-model="icerik" :plugins="[toolbar(), slashMenu(), dragHandle()]" />
  <pre>{{ icerik }}</pre>
</template>
```

## Imperatif erişim

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { KalemEditor, type KalemHandle } from '@kalem/vue';

const editor = ref<KalemHandle | null>(null);
const kalinYap = () => editor.value?.exec('toggleMark', { mark: 'strong' });
</script>

<template>
  <button @click="kalinYap">Kalın</button>
  <KalemEditor ref="editor" v-model="icerik" />
</template>
```

## Nuxt 3

Editör istemci taraflıdır:

```vue
<template>
  <ClientOnly>
    <KalemEditor v-model="icerik" />
  </ClientOnly>
</template>
```

Salt okunur içerik için `ClientOnly` **gerekmez** — `@kalem/viewer` Nitro içinde
sunucuda çalışır:

```ts
// server/api/yazi.get.ts
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export default defineEventHandler(() => ({
  html: renderToString(parse(markdown)),
}));
```

## Temizlik

Sarmalayıcı `onBeforeUnmount` içinde `editor.destroy()` çağırır; ayrıca bir şey
yapmanız gerekmez.
