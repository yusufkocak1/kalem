import {
	Component,
	CUSTOM_ELEMENTS_SCHEMA,
	type ElementRef,
	signal,
	viewChild,
} from "@angular/core";

/**
 * Kalem — Angular örneği  (İş listesi: F5-03)
 *
 * Angular için ayrı bir paket yok ve gerekmiyor. `<kalem-editor>` bir
 * Custom Element; Angular'a tek söylenmesi gereken şey "bu etiketi ben
 * bilmiyorum, tarayıcı biliyor": `CUSTOM_ELEMENTS_SCHEMA`.
 *
 * Bağlama tamamen deyimsel:
 *
 * - `[value]` — Angular tanımadığı bir elemanda köşeli parantezi **DOM
 *   özelliği** olarak yazıyor, yani `el.value = …` çalışıyor.
 * - `(input)` — sıradan `addEventListener`; olay `detail.value` taşıyor.
 *
 * Sonsuz döngü kendiliğinden kırılıyor: elemanın `value` setter'ı gelen
 * metin güncel metinle aynıysa hiçbir şey yapmıyor. Kullanıcı yazıyor →
 * olay → sinyal → bağlama aynı metni geri yazıyor → setter sessizce
 * duruyor. Belge yeniden yüklenmiyor, imleç yerinde kalıyor.
 */

const BASLANGIC = `# Işık ve Gölge

Bu editör bir **özel eleman**. Angular için sarmalayıcı paket yok — olan
şey tarayıcının kendi bileşen modeli.

* yıldız işareti korunuyor
* çünkü yazım tercihi modelde duruyor
`;

/** Elemanın yüzeyi; \`@kalem/wc\` tipi ayrıca import edilebilir. */
type Kalem = HTMLElement & { value: string; readOnly: boolean };

@Component({
	selector: "ornek-app",
	schemas: [CUSTOM_ELEMENTS_SCHEMA],
	template: `
		<main class="kalem-theme">
			<header>
				<h1>Kalem — Angular örneği</h1>
				<nav>
					<label>
						<input type="checkbox" [checked]="saltOkunur()" (change)="saltOkunurDegisti($event)" />
						salt okunur
					</label>
					<button type="button" (click)="geriYukle()">Örneği geri yükle</button>
					<button type="button" (click)="odakla()">Odağı editöre ver</button>
				</nav>
			</header>

			<kalem-editor
				#kutu
				class="editor"
				label="Belge"
				[value]="metin()"
				[readOnly]="saltOkunur()"
				(input)="girdi($event)"
			></kalem-editor>

			<p class="durum">{{ metin().length }} karakter</p>

			<section>
				<h2>Markdown çıktısı</h2>
				<pre>{{ metin() }}</pre>
			</section>
		</main>
	`,
})
export class App {
	readonly metin = signal(BASLANGIC);
	readonly saltOkunur = signal(false);

	private readonly kutu = viewChild<ElementRef<Kalem>>("kutu");

	girdi(olay: Event): void {
		this.metin.set((olay as CustomEvent<{ value: string }>).detail.value);
	}

	saltOkunurDegisti(olay: Event): void {
		this.saltOkunur.set((olay.target as HTMLInputElement).checked);
	}

	geriYukle(): void {
		this.metin.set(BASLANGIC);
	}

	odakla(): void {
		// `focus()` elemanda ezilmiş: odağı ilk düzenlenebilir bloğa veriyor.
		this.kutu()?.nativeElement.focus();
	}
}
