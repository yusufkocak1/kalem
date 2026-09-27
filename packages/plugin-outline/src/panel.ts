/**
 * @kalem-editor/plugin-outline — Panel  (İş listesi: F4-04)
 *
 * İçindekiler listesini, gömen uygulamanın verdiği kapsayıcıya çiziyor.
 *
 * ## Neden yüzen bir kutu değil
 *
 * Bul-değiştir paneli (F4-03) `<body>`ye yüzen bir kutu koyuyor, çünkü
 * geçici: açılıyor, iş bitince kapanıyor. İçindekiler ise **kalıcı** bir
 * kenar çubuğu ve nereye konacağı uygulamanın yerleşim kararı — kütüphane
 * ekranın bir köşesini kendi başına sahiplenemez.
 *
 * Bu yüzden kapsayıcı dışarıdan geliyor. Verilmezse eklenti yine
 * çalışıyor: başlık listesi ve etkin başlık API'den okunabiliyor, kendi
 * arayüzünü çizen uygulama onu kullanıyor.
 *
 * ## Neden düğme, bağlantı değil
 *
 * Başlığa atlamak bir gezinme değil, imleci taşımak. `<a href="#...">`
 * yazmak adres çubuğunu kirletir, geri tuşuna sahte adımlar ekler ve
 * belge kaydedilmemişse yanlış bir "sayfa değişti" hissi verir.
 * `aria-current="location"` ise gerçekten doğru etiket: liste içindeki
 * "şu an buradasınız" işareti.
 */
import type { OutlineItem } from "./outline.js";

export interface OutlinePanelOptions {
	readonly prefix: string;
	/** Panelin erişilebilir adı. */
	readonly label: string;
	/** Başlık yokken gösterilen metin. */
	readonly emptyText: string;
	readonly onSelect: (item: OutlineItem, index: number) => void;
}

export interface OutlinePanel {
	render(items: readonly OutlineItem[]): void;
	/** Etkin başlığı işaretler; `-1` hiçbiri. */
	setActive(index: number): void;
	destroy(): void;
}

export function createOutlinePanel(
	container: HTMLElement,
	options: OutlinePanelOptions,
): OutlinePanel {
	const doc = container.ownerDocument;
	const p = options.prefix;

	const nav = doc.createElement("nav");
	nav.className = `${p}outline ${p}theme`;
	nav.setAttribute("aria-label", options.label);

	const liste = doc.createElement("ol");
	liste.className = `${p}outline-list`;

	const bos = doc.createElement("p");
	bos.className = `${p}outline-empty`;
	bos.textContent = options.emptyText;

	nav.append(liste, bos);
	container.append(nav);

	let dugmeler: HTMLButtonElement[] = [];
	let etkin = -1;

	/**
	 * Tıklama tek bir dinleyiciyle yakalanıyor.
	 *
	 * Başlık başına dinleyici eklemek, 200 başlıklı bir belgede her
	 * yeniden çizimde 200 abonelik demek; liste zaten her `change`ta
	 * yeniden kurulabiliyor.
	 */
	const tiklandi = (event: MouseEvent): void => {
		const hedef = (event.target as Element | null)?.closest(`.${p}outline-item`);
		if (!(hedef instanceof HTMLButtonElement)) return;
		const index = dugmeler.indexOf(hedef);
		if (index < 0) return;
		const item = sonListe[index];
		if (item !== undefined) options.onSelect(item, index);
	};

	liste.addEventListener("click", tiklandi);

	let sonListe: readonly OutlineItem[] = [];

	return {
		render(items) {
			sonListe = items;
			dugmeler = [];
			etkin = -1;
			bos.hidden = items.length > 0;

			const parca = doc.createDocumentFragment();
			for (const item of items) {
				const li = doc.createElement("li");
				const dugme = doc.createElement("button");
				dugme.type = "button";
				dugme.className = `${p}outline-item`;
				// Girinti CSS'e bırakılıyor: `data-level` bir değişkene
				// çevriliyor ve derinlik başına satır içi stil yazmaktan
				// kaçınılıyor.
				dugme.dataset.level = String(item.level);
				// Boş başlık da listede duruyor — belgede gerçekten var ve
				// görünmezse kullanıcı onu bulamaz.
				dugme.textContent = item.text === "" ? "—" : item.text;
				li.append(dugme);
				parca.append(li);
				dugmeler.push(dugme);
			}

			liste.replaceChildren(parca);
		},

		setActive(index) {
			if (index === etkin) return;
			dugmeler[etkin]?.removeAttribute("aria-current");
			etkin = index;
			dugmeler[index]?.setAttribute("aria-current", "location");
		},

		destroy() {
			liste.removeEventListener("click", tiklandi);
			nav.remove();
		},
	};
}
