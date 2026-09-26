---
title: Nuxt
description: SSR — no <ClientOnly> needed, the document is rendered on the server.
---

```bash
npm i @kalem/vue @kalem/editor @kalem/themes
```

```vue
<!-- app/app.vue -->
<script setup lang="ts">
import { KalemEditor } from '@kalem/vue';
import { ref } from 'vue';

const text = ref('# Light and Shadow\n\nA document rendered on the server.');
</script>

<template>
  <KalemEditor v-model="text" lang="en" label="Document" class="editor" />
</template>
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: [
    '@kalem/themes/tokens.css',
    '@kalem/themes/viewer.css',
    '@kalem/themes/editor.css',
    '@kalem/themes/ui.css',
  ],
});
```

There's no other line for Kalem in the configuration.

## No `<ClientOnly>` needed

In the Vue world, almost every editor wrapper asks for it. The cost is
visible: the server sends an empty box, the content appears later, and
search engines never see the text.

With Kalem, the server **really renders** the document with
`@kalem/viewer`. The raw HTTP response contains `<h1>` and `<li>`; a test
verifies this. A readable document shows up on first paint, and when the
JavaScript loads, the editor takes over the same element.

## How hydration mismatch is prevented

Vue compares the HTML from the server with what the client produces. That's
why `innerHTML` is computed **once** and doesn't change for the life of the
component:

- The same string is produced on the server and on the client's first
  render → no mismatch. A test pins down that there isn't a single warning
  in the console.
- When `v-model` changes later, the `innerHTML` prop is **not updated**; if
  it were, Vue would wipe the element and rewrite it, and the editor's DOM,
  caret and history would go with it.

Changes reach the editor through `setValue` — so after mounting, the DOM is
managed by the editor, not by Vue.

## Version

There's not a single Nuxt-specific line in the wrapper; what's measured is
Vue 3 SSR behavior, and it's the same in Nuxt 3 and 4.

## Markdown → HTML on the server

In a Nitro endpoint, without loading the editor at all:

```ts
// server/api/preview.post.ts
import { parse } from '@kalem/core';
import { renderToString } from '@kalem/viewer';

export default defineEventHandler(async (event) => {
  const { markdown } = await readBody<{ markdown: string }>(event);
  return { html: renderToString(parse(markdown)) };
});
```

`@kalem/core` and `@kalem/viewer` don't touch the DOM; a purity gate
verifies this in CI.

## Working example

[`examples/nuxt`](https://github.com/yusufkocak1/kalem/tree/main/examples/nuxt)
— Nuxt 4, a production build in CI, tested with four browser tests.
