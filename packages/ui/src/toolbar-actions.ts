/**
 * @kalem/ui — Araç çubuğu eylemleri  (İş listesi: F3-01, F3-06)
 *
 * Balon çubuğu ile sabit çubuk aynı işleri yapıyor; ikisinin de kendi
 * düğme tanımını taşıması, "kalın" davranışının iki yerde ayrışması
 * demekti. Eylemler burada bir kez tanımlanıyor, iki çubuk da buradan
 * okuyor.
 *
 * Bir eylem üç şeyden ibaret: adı, nasıl çalıştığı ve **basılı olup
 * olmadığı**. Üçüncüsü olmadan araç çubuğu kullanıcıya imlecin nerede
 * durduğunu söyleyemiyor.
 */
import type { MarkType } from "@kalem/core/commands";
import type { Editor } from "@kalem/editor";
import { toggleList } from "@kalem/editor";
import { el } from "./dom.js";
import type { UiLabels } from "./labels.js";

export interface ToolbarAction {
	readonly id: string;
	readonly label: string;
	readonly glyph: string;
	/** Basılı durum — `undefined` ise düğme durumsuz (örn. geri al). */
	isActive?: () => boolean;
	/** Kullanılabilir mi — `undefined` ise her zaman. */
	isEnabled?: () => boolean;
	run(): void;
}

/** Satır içi biçim düğmeleri; balon çubuğu da bunu kullanıyor. */
export const MARKS: readonly {
	readonly mark: MarkType;
	readonly glyph: string;
	readonly key: keyof UiLabels;
}[] = [
	{ mark: "strong", glyph: "B", key: "bold" },
	{ mark: "emphasis", glyph: "I", key: "italic" },
	{ mark: "delete", glyph: "S", key: "strikethrough" },
	{ mark: "inlineCode", glyph: "<>", key: "code" },
];

export function formatActions(editor: Editor, labels: UiLabels): ToolbarAction[] {
	return MARKS.map(({ mark, glyph, key }) => ({
		id: `mark-${mark}`,
		label: labels[key],
		glyph,
		isActive: () => editor.isMarkActive(mark),
		run: () => editor.toggleMark(mark),
	}));
}

export function historyActions(editor: Editor, labels: UiLabels): ToolbarAction[] {
	return [
		{
			id: "undo",
			label: labels.undo,
			glyph: "↶",
			isEnabled: () => editor.canUndo(),
			run: () => void editor.undo(),
		},
		{
			id: "redo",
			label: labels.redo,
			glyph: "↷",
			isEnabled: () => editor.canRedo(),
			run: () => void editor.redo(),
		},
	];
}

export function listActions(editor: Editor, labels: UiLabels): ToolbarAction[] {
	const cevir = (ordered: boolean) => (): void => {
		const caret = editor.getCaret();
		if (caret === null) return;
		editor.applyEdit(toggleList(editor.getDocument(), caret, ordered));
	};
	return [
		{ id: "bullet-list", label: labels.bulletList, glyph: "•", run: cevir(false) },
		{ id: "ordered-list", label: labels.orderedList, glyph: "1.", run: cevir(true) },
	];
}

// ---------------------------------------------------------------------------
// Blok türü listesi
// ---------------------------------------------------------------------------

export interface BlockSelect {
	readonly element: HTMLSelectElement;
	/** Listeyi imlecin bulunduğu bloğun türüne getirir. */
	sync(): void;
}

/**
 * Blok türü açılır listesi.
 *
 * Yerel `<select>` kullanılıyor, özel bir açılır menü değil: klavye
 * gezinmesi, ekran okuyucu duyurusu, dokunmatik davranış ve mobil yerel
 * tekerlek hepsi bedava geliyor. Özel menü bunların hepsini yeniden
 * yazmak demek ve hiçbiri bu düğme için değerli değil.
 */
export function createBlockSelect(editor: Editor, p: string, labels: UiLabels): BlockSelect {
	const doc = editor.getElement().ownerDocument;
	const secim = el(doc, "select", {
		class: `${p}block-select`,
		attrs: { "aria-label": labels.blockType },
	});

	const secenekler: readonly [string, string][] = [
		["paragraph", labels.paragraph],
		["heading-1", labels.heading1],
		["heading-2", labels.heading2],
		["heading-3", labels.heading3],
		["blockquote", labels.quote],
		["code", labels.codeBlock],
	];
	for (const [value, text] of secenekler) {
		secim.append(el(doc, "option", { text, attrs: { value } }));
	}

	// `mousedown` engellenmiyor: `<select>` açılırken seçim zaten korunuyor
	// ve engellemek listeyi açılamaz hâle getiriyor.
	secim.addEventListener("change", () => {
		const deger = secim.value;
		if (deger.startsWith("heading-")) {
			const depth = Number(deger.slice(8)) as 1 | 2 | 3;
			editor.setBlockType({ type: "heading", depth });
		} else if (deger === "blockquote") editor.setBlockType({ type: "blockquote" });
		else if (deger === "code") editor.setBlockType({ type: "code" });
		else editor.setBlockType({ type: "paragraph" });
		editor.focus();
	});

	return {
		element: secim,
		sync() {
			const tur = editor.getBlockType();
			secim.value =
				tur === null
					? "paragraph"
					: tur.type === "heading"
						? `heading-${Math.min(tur.depth, 3)}`
						: tur.type;
		},
	};
}
