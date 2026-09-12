<script setup lang="ts">
/**
 * Canlı örnek — Vue  (İş listesi: F6-03)
 *
 * `@kalem/vue` sarmalayıcısı, Astro'nun Vue adasında. Sayfadaki React
 * örneğiyle aynı anda yaşıyor.
 *
 * Ada `client:load` ile kuruluyor, yani bileşen **önce sunucuda**
 * çiziliyor: kaynağa bakarsanız belgenin `<h1>`i ve listesi orada.
 * Nuxt sayfasında anlatılan "`<ClientOnly>` gerekmiyor" iddiası, bu
 * sayfanın kendi HTML'inde görünüyor.
 */
import type { Editor } from "@kalem/editor";
import { mountUi, type Ui } from "@kalem/ui";
import { KalemEditor } from "@kalem/vue";
import { onBeforeUnmount, ref } from "vue";
import { ORNEK_BELGE } from "./ornek-belge.js";

const metin = ref(ORNEK_BELGE);
let ui: Ui | null = null;

function hazir(editor: Editor) {
	ui = mountUi(editor, { toolbar: "both" });
}

// Arayüz editörden **önce** sökülüyor.
onBeforeUnmount(() => {
	ui?.destroy();
	ui = null;
});
</script>

<template>
	<div class="canli">
		<p class="canli-rozet">
			<b>Vue</b> · <code>&lt;KalemEditor v-model /&gt;</code>
		</p>
		<KalemEditor
			v-model="metin"
			class="canli-yazi kalem-theme"
			lang="tr"
			label="Canlı örnek — Vue"
			@ready="hazir"
		/>
		<pre class="canli-cikti">{{ metin }}</pre>
	</div>
</template>
