/**
 * `@kalem-editor/vue` — Vue sarmalayıcısı  (İş listesi: F5-02)
 *
 *     <script setup lang="ts">
 *     import { KalemEditor } from "@kalem-editor/vue";
 *     import { ref } from "vue";
 *     const metin = ref("# Merhaba");
 *     </script>
 *
 *     <template>
 *       <KalemEditor v-model="metin" lang="tr" label="Belge" />
 *     </template>
 *
 * Vue bir **peer** bağımlılık. Sunucuda belge `@kalem-editor/viewer` ile
 * çiziliyor, yani Nuxt'ta `<ClientOnly>` gerekmiyor: ilk boyada okunabilir
 * bir metin var ve JavaScript geldiğinde editör aynı elemanı devralıyor.
 *
 * @module @kalem-editor/vue
 */

export { KALEM_KEY, useKalem } from "./inject.js";
export { KalemEditor } from "./KalemEditor.js";
