<script setup lang="ts">
import { KalemEditor } from "@kalem-editor/vue";
import { ref } from "vue";

/*
 * Sunucuda da çalışan bir bileşen.
 *
 * `<ClientOnly>` **yok**: `<KalemEditor>` sunucuda belgeyi
 * `@kalem-editor/viewer` ile çiziyor, yani ilk boyada okunabilir bir metin var
 * ve arama motoru onu görüyor. JavaScript geldiğinde editör aynı elemanı
 * devralıyor.
 */
const BASLANGIC = `# Işık ve Gölge

Bu metin **sunucuda** çizildi. Sayfanın kaynağına bakın: başlık ve liste
HTML olarak orada.

* yıldız işareti korunuyor
* çünkü yazım tercihi modelde duruyor
`;

const metin = ref(BASLANGIC);
</script>

<template>
	<main>
		<h1>Kalem — Nuxt örneği</h1>
		<p class="not">
			Bu sayfa sunucuda üretildi ve editör <code>&lt;ClientOnly&gt;</code> olmadan çalışıyor.
		</p>

		<KalemEditor v-model="metin" class="editor" lang="tr" label="Belge" />

		<section>
			<h2>Markdown çıktısı</h2>
			<pre>{{ metin }}</pre>
		</section>
	</main>
</template>

<style>
body {
	margin: 0;
	font: 15px/1.6 system-ui, sans-serif;
	color: #22201d;
	background: #fbfaf8;
}

main {
	max-width: 46rem;
	margin: 0 auto;
	padding: 24px 20px 60px;
}

h1 {
	font-size: 18px;
}

.not {
	font-size: 13px;
	color: #6f6a62;
}

.editor {
	min-height: 12rem;
	padding: 14px 16px;
	background: #fff;
	border: 1px solid #e3e0da;
	border-radius: 8px;
}

pre {
	padding: 12px 14px;
	background: #fff;
	border: 1px solid #e3e0da;
	border-radius: 8px;
	white-space: pre-wrap;
	font-size: 13px;
}
</style>
