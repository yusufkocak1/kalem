<script setup lang="ts">
import { KalemEditor } from "@kalem/vue";
import { ref } from "vue";
import Durum from "./Durum.vue";

const BASLANGIC = `# Işık ve Gölge

Bu editör bir Vue bileşeni. Yazdıkça metin aşağıda güncelleniyor.

* yıldız işareti korunuyor
* çünkü yazım tercihi modelde duruyor
`;

// `v-model`: metin Vue durumunda, editör onu yansıtıyor.
const metin = ref(BASLANGIC);
const saltOkunur = ref(false);

function geriYukle() {
	metin.value = BASLANGIC;
}
</script>

<template>
	<main class="kalem-theme">
		<header>
			<h1>Kalem — Vue örneği</h1>
			<nav>
				<label> <input v-model="saltOkunur" type="checkbox" /> salt okunur </label>
				<button type="button" @click="geriYukle">Örneği geri yükle</button>
			</nav>
		</header>

		<KalemEditor
			v-model="metin"
			class="editor"
			:read-only="saltOkunur"
			lang="tr"
			label="Belge"
		>
			<Durum />
		</KalemEditor>

		<section>
			<h2>Markdown çıktısı</h2>
			<pre>{{ metin }}</pre>
		</section>
	</main>
</template>
