# @kalem/vue

Vue wrapper for Kalem — <KalemEditor v-model /> with SSR.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/vue @kalem/editor @kalem/ui @kalem/themes
```

```vue
<script setup lang="ts">
import { KalemEditor } from '@kalem/vue';
import { mountUi } from '@kalem/ui';
import { ref } from 'vue';

const text = ref('# Hello');
</script>

<template>
  <KalemEditor v-model="text" lang="en" label="Document" @ready="mountUi" />
</template>
```

Server-rendered with `@kalem/viewer` — no `<ClientOnly>` needed in Nuxt. `vue` is a peer dependency (^3).

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
