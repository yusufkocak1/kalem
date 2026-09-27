---
title: Vue
description: <KalemEditor v-model />, useKalem and SSR.
---

```bash
npm i @kalem-editor/vue @kalem-editor/editor @kalem-editor/themes
```

`vue` is a **peer dependency** (`^3`). Its own size is 686 B.

## `v-model`

```vue
<script setup lang="ts">
import { KalemEditor } from '@kalem-editor/vue';
import { ref } from 'vue';

const text = ref('# Hello');
</script>

<template>
  <KalemEditor v-model="text" lang="en" label="Document" />
</template>
```

Uncontrolled use is supported too: pass `default-value` instead of
`v-model`, let the text live in the editor, and `update:modelValue` is still
emitted.

## Props and events

| Prop | Type | Note |
|---|---|---|
| `modelValue` | `string` | The `v-model` binding |
| `defaultValue` | `string` | Uncontrolled initial text |
| `readOnly` | `boolean` | |
| `lang` · `label` · `plugins` | | Read **at mount time** |

| Event | Signature |
|---|---|
| `update:modelValue` | `(value: string)` |
| `ready` | `(editor: Editor)` |

## `useKalem()`

Components inside `<KalemEditor>` reach the editor through it:

```vue
<script setup lang="ts">
import { useKalem } from '@kalem-editor/vue';
const editor = useKalem();   // ShallowRef<Editor | null>
</script>

<template>
  <button :disabled="!editor" @click="editor?.focus()">Focus</button>
</template>
```

What you get back isn't a plain value but a **ref**: the editor is set up in
`onMounted`, so it doesn't exist yet when the child component's `setup`
runs. Because it's a ref, the child stays subscribed and updates on its own
when the editor is ready.

## Nuxt / SSR — no `<ClientOnly>` needed

In the Vue world, almost every editor wrapper asks for `<ClientOnly>`, and
the cost is visible: the server sends an empty box, the content appears
later, and search engines never see the text.

With Kalem, the server **really renders** the document with
`@kalem-editor/viewer`. There's a readable document on first paint; when the
JavaScript loads, the editor takes over the same element.

Hydration mismatch is prevented by freezing `innerHTML`: the string is
computed once and doesn't change for the life of the component. If it did,
Vue would wipe the element and rewrite it, and the editor's DOM, caret and
history would go with it. Changes reach the editor through `setValue`.

Details: [Nuxt](/en/frameworkler/nuxt/).

## Attribute passthrough

The component's root isn't a single element (the editable box and the slot
content are siblings), so `class` and `style` are passed through **by hand**
(`inheritAttrs: false`). That means `<KalemEditor class="editor" />` works
as you'd expect.

## Slot content

Slot content goes **next to** the editable area, not inside it: the inside
of the box is drawn from the model, and any node Vue put there would be
removed on the editor's first render.

```vue
<KalemEditor v-model="text" lang="en" label="Document">
  <Status />
</KalemEditor>
```

## The Word-like UI

The toolbars come from `@kalem-editor/ui`, mounted on the `ready` event:

```vue
<script setup lang="ts">
import { KalemEditor } from '@kalem-editor/vue';
import { mountUi, type Ui } from '@kalem-editor/ui';
import { onBeforeUnmount, ref } from 'vue';

const text = ref('# Hello');
let ui: Ui | null = null;
// The UI is torn down before the editor.
onBeforeUnmount(() => ui?.destroy());
</script>

<template>
  <KalemEditor v-model="text" lang="en" label="Document" @ready="(e) => (ui = mountUi(e))" />
</template>
```
