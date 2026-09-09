/**
 * @kalem/ui — Sabit üst araç çubuğu  (İş listesi: F3-06)
 *
 * Word'e alışkın kullanıcı için. Balon çubuğu seçim yapılınca beliriyor;
 * bu her zaman orada.
 *
 * ## Neden ikisi birden var
 *
 * Balon çubuğu keşfedilebilir ama **hatırlatıcı değil**: kullanıcı bir
 * şey seçmeden ne yapabileceğini göremiyor. Word'ün şeridi tam olarak bu
 * boşluğu dolduruyor — "burada neler var" sorusunun cevabı, hiçbir şey
 * yapmadan görünüyor. İkisi birlikte de kullanılabiliyor (`both`), çünkü
 * biri keşif diğeri erişim için.
 *
 * ## Şerit değil, tek satır
 *
 * Word'ün sekmeli şeridi bir kelime işlemcinin yüzlerce komutu için var.
 * Burada onlarca komut yok; sekmeler boş sekmeler olurdu. Gruplar tek
 * satırda, ayırıcılarla.
 *
 * ## Editörün üstüne, `<body>`ye değil
 *
 * Yüzen parçaların (balon, menü) aksine bu çubuk belgenin akışında:
 * editörün hemen üstüne, aynı kapsayıcıya giriyor. `position: sticky`
 * ile kaydırmada üstte kalıyor. Gömen sayfanın düzenini bozmamak için
 * editörün *kardeşi* oluyor, sarmalayıcı eklenmiyor.
 */
import type { Editor } from "@kalem/editor";
import { button, el, themed } from "./dom.js";
import type { UiLabels } from "./labels.js";
import type { BlockSelect, ToolbarAction } from "./toolbar-actions.js";
import {
	createBlockSelect,
	formatActions,
	historyActions,
	listActions,
} from "./toolbar-actions.js";

/** Yapılandırılabilir düğme grupları. */
export type ToolbarGroup = "history" | "blockType" | "format" | "list" | "link";

export const DEFAULT_GROUPS: readonly ToolbarGroup[] = [
	"history",
	"blockType",
	"format",
	"list",
	"link",
];

export interface FixedToolbarOptions {
	readonly prefix: string;
	readonly labels: UiLabels;
	/** Gösterilecek gruplar ve sıraları (varsayılan hepsi). */
	readonly groups?: readonly ToolbarGroup[];
	/** Bağlantı düğmesine basılınca çağrılıyor (F3-02 akışı). */
	readonly onLink?: () => void;
}

export interface FixedToolbar {
	readonly element: HTMLElement;
	/** Düğmelerin basılı/etkin durumunu tazeler. */
	update(): void;
	destroy(): void;
}

export function createFixedToolbar(editor: Editor, options: FixedToolbarOptions): FixedToolbar {
	const element = editor.getElement();
	const doc = element.ownerDocument;
	const p = options.prefix;
	const labels = options.labels;
	const gruplar = options.groups ?? DEFAULT_GROUPS;

	const root = el(doc, "div", {
		class: `${p}toolbar`,
		attrs: { role: "toolbar", "aria-label": labels.toolbar },
	});

	/** Düğme ve onu besleyen eylem — `update` bu listeden okuyor. */
	const dugmeler: { readonly el: HTMLButtonElement; readonly action: ToolbarAction }[] = [];
	let blokSecici: BlockSelect | null = null;

	function grupEkle(actions: readonly ToolbarAction[]): void {
		const kutu = el(doc, "div", { class: `${p}toolbar-group`, attrs: { role: "presentation" } });
		for (const action of actions) {
			const b = button(doc, {
				class: `${p}toolbar-button`,
				label: action.label,
				glyph: action.glyph,
				onClick: () => {
					action.run();
					update();
				},
			});
			dugmeler.push({ el: b, action });
			kutu.append(b);
		}
		root.append(kutu);
	}

	for (const grup of gruplar) {
		switch (grup) {
			case "history":
				grupEkle(historyActions(editor, labels));
				break;
			case "format":
				grupEkle(formatActions(editor, labels));
				break;
			case "list":
				grupEkle(listActions(editor, labels));
				break;
			case "link":
				grupEkle([
					{
						id: "link",
						label: labels.link,
						glyph: "🔗",
						run: () => options.onLink?.(),
					},
				]);
				break;
			case "blockType": {
				blokSecici = createBlockSelect(editor, p, labels);
				root.append(
					el(doc, "div", {
						class: `${p}toolbar-group`,
						attrs: { role: "presentation" },
						children: [blokSecici.element],
					}),
				);
				break;
			}
			default:
				break;
		}
	}

	// Editörün hemen üstüne. `before` sarmalayıcı eklemiyor: gömen sayfanın
	// kendi düzeni (grid/flex) bozulmadan kalıyor.
	element.before(themed(root, p));

	// -----------------------------------------------------------------------
	// Durum
	// -----------------------------------------------------------------------

	function update(): void {
		const saltOkunur = editor.isReadOnly();
		for (const { el: b, action } of dugmeler) {
			// `aria-pressed` yalnızca durumu olan düğmelerde: durumsuz bir
			// düğmeye "basılı değil" demek ekran okuyucuda yanlış bilgi.
			if (action.isActive !== undefined) {
				b.setAttribute("aria-pressed", String(action.isActive()));
			}
			b.disabled = saltOkunur || action.isEnabled?.() === false;
		}
		if (blokSecici !== null) {
			blokSecici.sync();
			blokSecici.element.disabled = saltOkunur;
		}
		root.classList.toggle(`${p}toolbar-readonly`, saltOkunur);
		// Kapanan düğme odağı taşıyor olabilir; sıra yeniden kuruluyor.
		rovingTazele(doc.activeElement instanceof HTMLElement ? doc.activeElement : null);
	}

	// Gezgin sekme sırası: çubuğa bir Tab ile giriliyor, içinde oklarla
	// geziliyor. Onlarca düğmeyi Tab sırasına sokmak, klavye kullanıcısını
	// editöre varmadan önce hepsinin içinden geçirirdi.
	//
	// **Kapalı düğmeler atlanıyor.** Geri al düğmesi geçmiş boşken kapalı
	// ve odak alamıyor; listede bırakılırsa ok tuşu klavye kullanıcısını
	// hiçbir yere götürmüyor gibi görünüyor.
	const odaklanabilirler = (): HTMLElement[] =>
		Array.from(
			root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select"),
		).filter((oge) => !oge.disabled);

	function rovingTazele(aktif: HTMLElement | null): void {
		const liste = odaklanabilirler();
		const secili = aktif !== null && liste.includes(aktif) ? aktif : liste[0];
		for (const oge of root.querySelectorAll<HTMLElement>("button, select")) {
			oge.tabIndex = oge === secili ? 0 : -1;
		}
	}

	const tus = (event: KeyboardEvent): void => {
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
		const liste = odaklanabilirler();
		const simdiki = liste.indexOf(doc.activeElement as HTMLElement);
		if (simdiki < 0) return;
		event.preventDefault();
		const yon = event.key === "ArrowRight" ? 1 : -1;
		const hedef = liste[(simdiki + yon + liste.length) % liste.length];
		hedef?.focus();
		rovingTazele(hedef ?? null);
	};
	root.addEventListener("keydown", tus);
	root.addEventListener("focusin", (event) => {
		const hedef = event.target;
		rovingTazele(hedef instanceof HTMLElement ? hedef : null);
	});

	update();

	return {
		element: root,
		update,
		destroy() {
			root.removeEventListener("keydown", tus);
			root.remove();
		},
	};
}
