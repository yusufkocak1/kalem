---
title: Vue
description: <KalemEditor v-model />, useKalem ve SSR.
---

```bash
npm i @kalem-editor/vue @kalem-editor/editor @kalem-editor/themes
```

`vue` bir **peer bağımlılık** (`^3`). Kendi boyutu 686 B.

## `v-model`

```vue
<script setup lang="ts">
import { KalemEditor } from '@kalem-editor/vue';
import { ref } from 'vue';

const metin = ref('# Merhaba');
</script>

<template>
  <KalemEditor v-model="metin" lang="tr" label="Belge" />
</template>
```

Kontrolsüz kullanım da destekleniyor: `v-model` yerine `default-value`
verin, metin editörde yaşasın, `update:modelValue` olayı yine yayılsın.

## Prop'lar ve olaylar

| Prop | Tip | Not |
|---|---|---|
| `modelValue` | `string` | `v-model` bağlantısı |
| `defaultValue` | `string` | Kontrolsüz başlangıç metni |
| `readOnly` | `boolean` | |
| `lang` · `label` · `plugins` | | **Montaj anında** okunuyor |

| Olay | İmza |
|---|---|
| `update:modelValue` | `(value: string)` |
| `ready` | `(editor: Editor)` |

## `useKalem()`

`<KalemEditor>`in içindeki bileşenler editöre buradan erişiyor:

```vue
<script setup lang="ts">
import { useKalem } from '@kalem-editor/vue';
const editor = useKalem();   // ShallowRef<Editor | null>
</script>

<template>
  <button :disabled="!editor" @click="editor?.focus()">Odağı ver</button>
</template>
```

Dönen şey düz bir değer değil **ref**: editör `onMounted` içinde
kuruluyor, yani alt bileşenin `setup`ı çalıştığında henüz yok. Ref olunca
alt bileşen ona abone kalıyor ve editör hazır olduğunda kendiliğinden
güncelleniyor.

## Nuxt / SSR — `<ClientOnly>` gerekmiyor

Vue dünyasında editör sarmalayıcılarının neredeyse hepsi `<ClientOnly>`
istiyor ve bedeli görünür: sunucu boş bir kutu gönderiyor, içerik
sonradan beliriyor, arama motoru metni hiç görmüyor.

Kalem'de sunucu belgeyi `@kalem-editor/viewer` ile **gerçekten çiziyor**. İlk
boyada okunabilir bir belge var; JavaScript yüklendiğinde editör aynı
elemanı devralıyor.

Hidrasyon uyuşmazlığı `innerHTML`i dondurarak engelleniyor: dize bir kez
hesaplanıyor ve bileşen yaşadığı sürece değişmiyor. Değişseydi Vue
elemanın içini silip yeniden yazar, editörün DOM'u, imleci ve geçmişi
onunla giderdi. Değişiklikler editöre `setValue` ile iniyor.

Ayrıntı: [Nuxt](/frameworkler/nuxt/).

## Öznitelik aktarımı

Bileşenin kökü tek bir eleman değil (düzenlenebilir kutu ve yuva içeriği
kardeş), bu yüzden `class` ve `style` **elle** aktarılıyor
(`inheritAttrs: false`). Yani `<KalemEditor class="editor" />` beklediğiniz
gibi çalışıyor.

## Yuva içeriği

Yuva (slot) içeriği düzenlenebilir alanın **yanında**, içinde değil:
kutunun içi modelden çiziliyor ve Vue'nun oraya koyduğu her düğüm editörün
ilk çiziminde silinirdi.

```vue
<KalemEditor v-model="metin" lang="tr" label="Belge">
  <Durum />
</KalemEditor>
```
