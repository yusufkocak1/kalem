<script lang="ts">
/**
 * Kalem — Svelte örneği  (İş listesi: F5-03)
 *
 * Svelte için ayrı bir paket yok. `<kalem-editor>` bir Custom Element,
 * yani Svelte onu sıradan bir DOM elemanı gibi ele alıyor.
 *
 * Bağlama iki satır:
 *
 * - `value={metin}` — Svelte özel elemanlarda, **özellik varsa** özelliği
 *   yazıyor (`el.value = …`). Çok satırlı Markdown bir özniteliğe
 *   sıkışmak zorunda kalmıyor.
 * - `oninput={girdi}` — sıradan bir olay dinleyicisi; `event.detail.value`
 *   metni taşıyor, yani ikinci bir okuma gerekmiyor.
 *
 * Sonsuz döngü kendiliğinden kırılıyor: elemanın `value` setter'ı gelen
 * metin güncel metinle aynıysa hiçbir şey yapmıyor. Kullanıcı yazıyor →
 * olay → `metin` → bağlama aynı metni geri yazıyor → setter sessizce
 * duruyor. Belge yeniden yüklenmiyor, imleç yerinde kalıyor.
 */
type Kalem = HTMLElement & { value: string; readOnly: boolean };

const BASLANGIC = `# Işık ve Gölge

Bu editör bir **özel eleman**. Svelte için sarmalayıcı paket yok — olan
şey tarayıcının kendi bileşen modeli.

* yıldız işareti korunuyor
* çünkü yazım tercihi modelde duruyor
`;

let metin = $state(BASLANGIC);
let saltOkunur = $state(false);
let gonderilen = $state("");
let el = $state<Kalem | null>(null);

function girdi(olay: Event) {
	metin = (olay as CustomEvent<{ value: string }>).detail.value;
}

function gonder(olay: SubmitEvent) {
	olay.preventDefault();
	const veri = new FormData(olay.currentTarget as HTMLFormElement);
	gonderilen = String(veri.get("ozet") ?? "");
}
</script>

<main class="kalem-theme">
	<header>
		<h1>Kalem — Svelte örneği</h1>
		<nav>
			<label>
				<input type="checkbox" bind:checked={saltOkunur} />
				salt okunur
			</label>
			<button type="button" onclick={() => (metin = BASLANGIC)}>Örneği geri yükle</button>
			<button type="button" onclick={() => el?.focus()}>Odağı editöre ver</button>
		</nav>
	</header>

	<kalem-editor
		bind:this={el}
		class="editor"
		label="Belge"
		value={metin}
		readOnly={saltOkunur}
		oninput={girdi}
	></kalem-editor>

	<p class="durum">{metin.length} karakter</p>

	<section>
		<h2>Markdown çıktısı</h2>
		<pre>{metin}</pre>
	</section>

	<section>
		<h2>Form entegrasyonu</h2>
		<p class="not">
			Aşağıdaki editör bir form alanı: <code>name</code>, <code>required</code> ve sıfırlama
			tarayıcının kendi akışından geçiyor. Svelte'nin haberi bile yok.
		</p>
		<form onsubmit={gonder}>
			<kalem-editor class="editor kucuk" name="ozet" required label="Özet"></kalem-editor>
			<div class="satir">
				<button type="submit">Gönder</button>
				<button type="reset">Sıfırla</button>
			</div>
		</form>
		<p class="durum">gönderilen: <b id="gonderilen">{gonderilen || "—"}</b></p>
	</section>
</main>
