<script setup lang="ts">
import { useKalem } from "@kalem-editor/vue";
import { onUnmounted, ref, watch } from "vue";

/**
 * `<KalemEditor>`in çocuğu: editöre `useKalem()` ile erişiyor.
 *
 * Enjekte edilen şey bir `ShallowRef` çünkü editör `onMounted` içinde
 * kuruluyor — bu bileşenin `setup`ı çalıştığında henüz yok.
 */
const editor = useKalem();
const uzunluk = ref(0);
let birak: (() => void) | null = null;

watch(
	editor,
	(ed) => {
		birak?.();
		birak = null;
		if (ed === null) return;
		uzunluk.value = ed.getValue().length;
		birak = ed.on("change", (value) => {
			uzunluk.value = value.length;
		});
	},
	{ immediate: true },
);

onUnmounted(() => birak?.());
</script>

<template>
	<p class="durum">
		<span>{{ uzunluk }} karakter</span>
		<button type="button" :disabled="editor === null" @click="editor?.focus()">
			Odağı editöre ver
		</button>
	</p>
</template>
