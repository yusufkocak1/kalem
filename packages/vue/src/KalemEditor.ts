/**
 * @kalem-editor/vue — `<KalemEditor v-model />`  (İş listesi: F5-02)
 *
 * ## `<ClientOnly>` gerekmiyor
 *
 * İş listesinin bu maddeyi ayrıca yazmasının sebebi, Vue dünyasında
 * editör sarmalayıcılarının neredeyse hepsinin `<ClientOnly>` istemesi.
 * Bedeli görünür: sunucu boş bir kutu gönderiyor, sayfa açıldığında
 * içerik **sonradan** beliriyor ve arama motoru metni hiç görmüyor.
 *
 * Burada sunucu belgeyi `@kalem-editor/viewer` ile gerçekten çiziyor. Yani ilk
 * boyada okunabilir bir belge var; JavaScript yüklendiğinde editör aynı
 * elemanı devralıyor.
 *
 * ## Hidrasyon uyuşmazlığı nasıl engelleniyor
 *
 * Vue, sunucudan gelen HTML ile istemcinin ürettiğini karşılaştırıyor.
 * Bu yüzden `innerHTML` **bir kez** hesaplanıyor ve bileşen yaşadığı
 * sürece değişmiyor:
 *
 * - Sunucuda ve istemcinin ilk render'ında aynı dize üretiliyor →
 *   uyuşmazlık yok.
 * - `modelValue` sonradan değişince `innerHTML` prop'u **güncellenmiyor**;
 *   güncellenseydi Vue elemanın içeriğini silip yeniden yazardı ve
 *   editörün DOM'u, imleci, geçmişi onunla birlikte giderdi.
 *
 * Değişiklikler editöre `setValue` ile iniyor — yani DOM'u Vue değil
 * editör yönetiyor, montajdan sonra.
 *
 * ## `v-model`
 *
 * Vue'nun sözleşmesi: `modelValue` prop'u ve `update:modelValue` olayı.
 * Kontrolsüz kullanım da destekleniyor — `modelValue` verilmezse metin
 * editörde yaşıyor ve olay yine yayılıyor.
 */
import { parse } from "@kalem-editor/core";
import type { Plugin } from "@kalem-editor/editor";
import { Editor } from "@kalem-editor/editor";
import { renderToString } from "@kalem-editor/viewer";
import type { PropType } from "vue";
import {
	defineComponent,
	h,
	onBeforeUnmount,
	onMounted,
	provide,
	ref,
	shallowRef,
	watch,
} from "vue";
import { KALEM_KEY } from "./inject.js";

export const KalemEditor = defineComponent({
	name: "KalemEditor",

	/*
	 * Öznitelikler elle geçiriliyor.
	 *
	 * Bileşenin kökü tek bir eleman değil — düzenlenebilir kutu ve yuva
	 * içeriği kardeş (aşağıya bakın). Vue böyle bir bileşende `class`,
	 * `style` ve `id` gibi öznitelikleri **kendiliğinden** aktaramıyor ve
	 * sessizce düşürüyor: `<KalemEditor class="editor" />` yazan kullanıcı
	 * hiçbir uyarı almadan stilsiz bir kutu görüyordu.
	 */
	inheritAttrs: false,

	props: {
		/** `v-model` bağlantısı. Verilmezse metin editörde yaşıyor. */
		modelValue: { type: String, default: undefined },
		/** Kontrolsüz başlangıç metni. */
		defaultValue: { type: String, default: "" },
		readOnly: { type: Boolean, default: false },
		/** Belge dili; yazım denetimi sözlüğünü seçiyor. Montaj anında okunuyor. */
		lang: { type: String, default: undefined },
		/** Erişilebilir ad (`aria-label`). Montaj anında okunuyor. */
		label: { type: String, default: undefined },
		/** Eklentiler. Montaj anında okunuyor. */
		plugins: { type: Array as PropType<Plugin[]>, default: undefined },
	},

	emits: {
		"update:modelValue": (value: string) => typeof value === "string",
		ready: (editor: Editor) => editor instanceof Editor,
	},

	setup(props, { attrs, emit, slots }) {
		const kap = ref<HTMLElement | null>(null);
		const editor = shallowRef<Editor | null>(null);
		/** Editörün en son **kendi yaydığı** metin (döngü kırıcı). */
		let yayilan: string | null = null;

		// Alt bileşenler `useKalem()` ile erişiyor.
		provide(KALEM_KEY, editor);

		/**
		 * Sunucu çıktısı; bir kez hesaplanıyor ve bir daha değişmiyor.
		 *
		 * `props.modelValue ?? props.defaultValue` yalnızca **ilk** değeri
		 * okuyor; sonraki değişiklikler editöre gidiyor, buraya değil
		 * (dosya başındaki not).
		 */
		const ilkMetin = props.modelValue ?? props.defaultValue;
		const ilkHtml = renderToString(parse(ilkMetin));

		onMounted(() => {
			const el = kap.value;
			if (el === null) return;

			yayilan = ilkMetin;
			const ed = new Editor(el, {
				value: ilkMetin,
				readOnly: props.readOnly,
				...(props.lang === undefined ? {} : { lang: props.lang }),
				...(props.label === undefined ? {} : { label: props.label }),
				...(props.plugins === undefined ? {} : { plugins: [...props.plugins] }),
				onChange: (value) => {
					yayilan = value;
					emit("update:modelValue", value);
				},
			});

			editor.value = ed;
			emit("ready", ed);
		});

		onBeforeUnmount(() => {
			editor.value?.destroy();
			editor.value = null;
		});

		watch(
			() => props.modelValue,
			(yeni) => {
				const ed = editor.value;
				// Editörün kendi yaydığı metin geri geldiyse hiçbir şey yapma.
				if (ed === null || yeni === undefined || yeni === yayilan) return;
				yayilan = yeni;
				ed.setValue(yeni);
			},
		);

		watch(
			() => props.readOnly,
			(yeni) => editor.value?.setReadOnly(yeni),
		);

		/*
		 * Yuva içeriği kutunun **yanında**, içinde değil.
		 *
		 * Düzenlenebilir alanın içi modelden çiziliyor; Vue'nun oraya
		 * koyduğu her düğüm editörün ilk çiziminde silinirdi. Kendi araç
		 * çubuğunu yazan uygulama `useKalem()` ile editöre erişiyor.
		 */
		return () => [
			/*
			 * `innerHTML` yalnızca **ilk** çizimde anlamlı: montajdan sonra
			 * elemanın içini editör yönetiyor. Vue bu prop'u bir daha
			 * değiştirmediği için içeriğe dokunmuyor.
			 */
			h("div", { ...attrs, ref: kap, innerHTML: ilkHtml }),
			slots["default"]?.(),
		];
	},
});
