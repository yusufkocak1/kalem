# `@kalem/vue` — Vite + Vue 3

```bash
pnpm --filter example-vue-vite dev
```

`<KalemEditor v-model="metin" />` — Vue'nun kendi sözleşmesi
(`modelValue` + `update:modelValue`).

- `App.vue` — `v-model`, `readOnly` ve `label`.
- `Durum.vue` — `<KalemEditor>`in içindeki bileşen; editöre `useKalem()`
  ile erişiyor. Dönen şey bir `ShallowRef`, çünkü editör `onMounted`
  içinde kuruluyor ve alt bileşenin `setup`ı ondan önce çalışıyor.

Yuva (slot) içeriği düzenlenebilir kutunun **yanında**, içinde değil:
kutunun içi modelden çiziliyor ve Vue'nun oraya koyduğu her düğüm editörün
ilk çiziminde silinirdi.
