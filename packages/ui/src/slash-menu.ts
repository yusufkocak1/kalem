/**
 * @kalem-editor/ui — Slash menü  (İş listesi: F3-03)
 *
 * `/` yazınca açılan blok ekleme menüsü. Segment A için "ne
 * ekleyebilirim" sorusunun tek görünür cevabı: kısayolları bilmeyen
 * kullanıcı Ctrl+Alt+2'yi keşfetmiyor ama `/` yazmayı bir kez öğreniyor.
 *
 * ## Metin belgede kalıyor
 *
 * Menü açıkken yazılan `/başlık` metni **gerçekten belgede**. Sebebi IME
 * ve yazım denetimi: metni ayrı bir kutuda toplamak, bileşimli yazımı ve
 * imleç davranışını yeniden yazmak demekti. Öğe seçilince o metin tek bir
 * düzenlemede siliniyor ve dönüşüm uygulanıyor — yani **tek Ctrl+Z**
 * hepsini geri alıyor.
 *
 * ## Arama
 *
 * Locale duyarlı (`search.ts`). `lang="tr"` iken `/BAŞ` ile `/baş` aynı,
 * `/bas` da eşleşiyor, `/ıst` "İstatistik" gibi bir öğeyi buluyor.
 *
 * ## Erişilebilirlik
 *
 * `role="listbox"` + `aria-activedescendant`: odak editörde kalıyor
 * (kullanıcı yazmaya devam ediyor), seçili öğe ekran okuyucuya
 * `aria-activedescendant` ile bildiriliyor. Odağı menüye taşımak yazmayı
 * durdururdu.
 */
import type { Root } from "@kalem-editor/core";
import { replaceAt } from "@kalem-editor/core";
import { setBlockType } from "@kalem-editor/core/commands";
import type { Caret, Editor, EditResult } from "@kalem-editor/editor";
import { spliceInline, toggleList } from "@kalem-editor/editor";
import { el, themed } from "./dom.js";
import { position } from "./floating.js";
import type { UiLabels } from "./labels.js";
import { score } from "./search.js";

/** Menüdeki bir öğe. */
export interface SlashItem {
	/** Benzersiz kimlik — eklentiler öğe değiştirmek için kullanabilir. */
	readonly id: string;
	/** Görünen ad; arama bunun üzerinde çalışıyor. */
	readonly label: string;
	/** Kategori başlığı; aynı kategoridekiler bir arada gösteriliyor. */
	readonly group: string;
	/** Kısa simge — metin, SVG değil (bkz. `dom.ts`). */
	readonly glyph: string;
	/** Öğe seçilince uygulanacak dönüşüm. */
	readonly apply: (doc: Root, caret: Caret) => EditResult | null;
}

export interface SlashMenuOptions {
	readonly prefix: string;
	readonly labels: UiLabels;
	/** Arama karşılaştırmasının dili. */
	readonly locale: string;
	/** Yerleşiklere eklenen öğeler (eklentiler için). */
	readonly extraItems?: readonly SlashItem[];
}

export interface SlashMenu {
	readonly element: HTMLElement;
	readonly isOpen: boolean;
	/** Öğe listesi — eklentiler buna ekleme yapabiliyor. */
	register(item: SlashItem): void;
	close(): void;
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Yerleşik öğeler
// ---------------------------------------------------------------------------

/** Bloğu bir başlığa çevirir. */
function baslik(depth: 1 | 2 | 3 | 4) {
	return (doc: Root, caret: Caret): EditResult => ({
		doc: setBlockType(doc, [caret.blockIndex], { type: "heading", depth }),
		caret: { blockIndex: caret.blockIndex, path: [], offset: caret.offset },
	});
}

/** Görev listesi: liste yapıp maddeyi işaretlenebilir hâle getiriyor. */
function gorevListesi(doc: Root, caret: Caret): EditResult | null {
	const liste = toggleList(doc, caret, false);
	if (liste === null) return null;
	const blok = liste.doc.children[caret.blockIndex];
	if (blok?.type !== "list") return liste;
	const madde = blok.children[0];
	if (madde === undefined) return liste;
	return {
		doc: replaceAt(liste.doc, [caret.blockIndex, 0], { ...madde, checked: false }),
		caret: liste.caret,
	};
}

/** Yatay çizgi: bloğu çizgiye çevirip altına yazılacak bir paragraf açıyor. */
function ayirici(doc: Root, caret: Caret): EditResult {
	const blok = doc.children[caret.blockIndex];
	const children = [...doc.children];
	children.splice(
		caret.blockIndex,
		1,
		{ type: "thematicBreak", id: blok?.id } as Root["children"][number],
		{ type: "paragraph", children: [] } as Root["children"][number],
	);
	return {
		doc: { ...doc, children: children as Root["children"] },
		caret: { blockIndex: caret.blockIndex + 1, path: [], offset: 0 },
	};
}

function builtinItems(labels: UiLabels): SlashItem[] {
	const metin = labels.paragraph;
	const yapı = labels.blockType;
	return [
		{ id: "heading-1", label: labels.heading1, group: metin, glyph: "H1", apply: baslik(1) },
		{ id: "heading-2", label: labels.heading2, group: metin, glyph: "H2", apply: baslik(2) },
		{ id: "heading-3", label: labels.heading3, group: metin, glyph: "H3", apply: baslik(3) },
		{ id: "heading-4", label: labels.heading4, group: metin, glyph: "H4", apply: baslik(4) },
		{
			id: "paragraph",
			label: labels.paragraph,
			group: metin,
			glyph: "¶",
			apply: (doc, caret) => ({
				doc: setBlockType(doc, [caret.blockIndex], { type: "paragraph" }),
				caret: { blockIndex: caret.blockIndex, path: [], offset: caret.offset },
			}),
		},
		{
			id: "bullet-list",
			label: labels.bulletList,
			group: yapı,
			glyph: "•",
			apply: (doc, caret) => toggleList(doc, caret, false),
		},
		{
			id: "ordered-list",
			label: labels.orderedList,
			group: yapı,
			glyph: "1.",
			apply: (doc, caret) => toggleList(doc, caret, true),
		},
		{ id: "task-list", label: labels.taskList, group: yapı, glyph: "☑", apply: gorevListesi },
		{
			id: "quote",
			label: labels.quote,
			group: yapı,
			glyph: "❝",
			apply: (doc, caret) => ({
				doc: setBlockType(doc, [caret.blockIndex], { type: "blockquote" }),
				caret: { blockIndex: caret.blockIndex, path: [0], offset: caret.offset },
			}),
		},
		{
			id: "code-block",
			label: labels.codeBlock,
			group: yapı,
			glyph: "{}",
			apply: (doc, caret) => ({
				doc: setBlockType(doc, [caret.blockIndex], { type: "code" }),
				caret: { blockIndex: caret.blockIndex, path: [], offset: 0 },
			}),
		},
		{ id: "divider", label: labels.divider, group: yapı, glyph: "—", apply: ayirici },
	];
}

// ---------------------------------------------------------------------------
// Menü
// ---------------------------------------------------------------------------

export function createSlashMenu(editor: Editor, options: SlashMenuOptions): SlashMenu {
	const doc = editor.getElement().ownerDocument;
	const p = options.prefix;
	const ogeler: SlashItem[] = [...builtinItems(options.labels), ...(options.extraItems ?? [])];

	const liste = el(doc, "div", {
		class: `${p}slash-list`,
		attrs: { role: "listbox", "aria-label": options.labels.slashMenu },
	});
	const bos = el(doc, "div", { class: `${p}slash-empty`, text: options.labels.slashEmpty });
	const root = el(doc, "div", {
		class: `${p}menu ${p}slash`,
		attrs: { hidden: "" },
		children: [liste, bos],
	});
	doc.body.append(themed(root, p));

	/** Menü açıkken `/` karakterinin bulunduğu ofset; kapalıyken `null`. */
	let slashOfseti: number | null = null;
	let secili = 0;
	let gorunen: SlashItem[] = [];

	function acikMi(): boolean {
		return slashOfseti !== null;
	}

	// -----------------------------------------------------------------------
	// Sorgu ve filtreleme
	// -----------------------------------------------------------------------

	/** İmleçle `/` arasındaki metin. */
	function sorgu(): string | null {
		if (slashOfseti === null) return null;
		const caret = editor.getCaret();
		const aralik = editor.getTextRange();
		if (caret === null || aralik === null || aralik.from !== aralik.to) return null;
		if (caret.offset < slashOfseti + 1) return null;
		const metin = blokMetni(caret);
		if (metin === null) return null;
		return metin.slice(slashOfseti + 1, caret.offset);
	}

	function blokMetni(caret: Caret): string | null {
		const dugum = dugumBul(editor.getDocument(), caret);
		if (dugum === null) return null;
		let out = "";
		for (const n of dugum.children) out += duzMetin(n);
		return out;
	}

	function filtrele(q: string): void {
		gorunen = ogeler
			.map((oge) => ({ oge, puan: score(oge.label, q, options.locale) }))
			.filter((x) => x.puan >= 0)
			.sort((a, b) => b.puan - a.puan)
			.map((x) => x.oge);
		secili = 0;
		ciz();
	}

	function ciz(): void {
		liste.replaceChildren();
		bos.hidden = gorunen.length > 0;

		let sonGrup: string | null = null;
		for (const [i, oge] of gorunen.entries()) {
			if (oge.group !== sonGrup) {
				sonGrup = oge.group;
				liste.append(
					el(doc, "div", {
						class: `${p}slash-group`,
						text: oge.group,
						attrs: { role: "presentation" },
					}),
				);
			}
			const satir = el(doc, "div", {
				class: `${p}slash-item`,
				attrs: {
					role: "option",
					id: `${p}slash-${oge.id}`,
					"aria-selected": String(i === secili),
				},
				children: [
					el(doc, "span", {
						class: `${p}slash-glyph`,
						text: oge.glyph,
						attrs: { "aria-hidden": "true" },
					}),
					el(doc, "span", { class: `${p}slash-label`, text: oge.label }),
				],
			});
			// `mousedown` engelleniyor: tıklamak imleci düşürürse uygulanacak
			// yer kalmıyor (balon araç çubuğundaki tuzağın aynısı).
			satir.addEventListener("mousedown", (event) => event.preventDefault());
			satir.addEventListener("click", () => sec(i));
			liste.append(satir);
		}
		aktifiBildir();
	}

	/**
	 * Seçili öğeyi ekran okuyucuya bildirir.
	 *
	 * Odak editörde kaldığı için `aria-activedescendant` editörün kök
	 * elemanına yazılıyor: kullanıcı yazmaya devam ederken hangi öğenin
	 * seçili olduğunu duyuyor.
	 */
	function aktifiBildir(): void {
		const oge = gorunen[secili];
		const element = editor.getElement();
		if (oge === undefined) {
			element.removeAttribute("aria-activedescendant");
			return;
		}
		element.setAttribute("aria-activedescendant", `${p}slash-${oge.id}`);
		liste.querySelector(`[aria-selected="true"]`)?.scrollIntoView({ block: "nearest" });
	}

	function tasi(delta: number): void {
		if (gorunen.length === 0) return;
		secili = (secili + delta + gorunen.length) % gorunen.length;
		for (const [i, satir] of Array.from(liste.querySelectorAll(`.${p}slash-item`)).entries()) {
			satir.setAttribute("aria-selected", String(i === secili));
		}
		aktifiBildir();
	}

	/**
	 * Öğeyi uygular.
	 *
	 * `/sorgu` metninin silinmesi ve blok dönüşümü **tek** bir düzenleme:
	 * ikisi ayrı olsaydı kullanıcı iki kez Ctrl+Z'ye basmak zorunda kalırdı.
	 */
	function sec(index: number): void {
		const oge = gorunen[index];
		const caret = editor.getCaret();
		if (oge === undefined || caret === null || slashOfseti === null) return;

		const belge = editor.getDocument();
		const dugum = dugumBul(belge, caret);
		if (dugum === null) return;

		const temizlenmis = spliceInline(dugum.children, slashOfseti, caret.offset, []);
		const araDoc = replaceAt(belge, [caret.blockIndex, ...caret.path], {
			...dugum,
			children: temizlenmis,
		} as never);

		const hedefCaret: Caret = { ...caret, offset: slashOfseti };
		close();
		// `editor.focus()` çağrılmıyor: o, **ilk** bloğa odaklanıyor.
		// `applyEdit` imleci zaten dönüşen bloğa koyuyor.
		editor.applyEdit(oge.apply(araDoc, hedefCaret));
	}

	// -----------------------------------------------------------------------
	// Açma / kapama
	// -----------------------------------------------------------------------

	function open(offset: number): void {
		if (editor.isReadOnly()) return;
		slashOfseti = offset;
		root.hidden = false;
		filtrele("");
		konumla();
	}

	function close(): void {
		slashOfseti = null;
		root.hidden = true;
		editor.getElement().removeAttribute("aria-activedescendant");
	}

	function konumla(): void {
		const selection = doc.getSelection();
		if (selection === null || selection.rangeCount === 0) return;
		position(root, selection.getRangeAt(0).getBoundingClientRect(), { placement: "bottom" });
	}

	// -----------------------------------------------------------------------
	// Olaylar
	// -----------------------------------------------------------------------

	const element = editor.getElement();

	/**
	 * Menü açıkken tuşları devralır.
	 *
	 * Eklenti olarak kaydedilmiyor çünkü yalnızca **açıkken** araya
	 * giriyor; kapalıyken hiçbir tuşu tüketmemeli ve eklenti kaydı bunu
	 * her tuşta yeniden sormak demek olurdu.
	 */
	const tus = (event: KeyboardEvent): void => {
		if (!acikMi()) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			tasi(1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			tasi(-1);
			return;
		}
		if (event.key === "Enter" || event.key === "Tab") {
			if (gorunen.length === 0) return;
			event.preventDefault();
			sec(secili);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			close();
		}
	};

	/**
	 * `/` yazıldığında açıyor, sorgu değiştikçe filtreliyor.
	 *
	 * Açılış koşulu dar: `/` **kelime başında** olmalı. Aksi hâlde
	 * `and/or` yazan kullanıcının karşısına menü çıkardı.
	 */
	const yazildi = (): void => {
		if (editor.isReadOnly()) return;

		if (acikMi()) {
			const q = sorgu();
			// İmleç `/`nin gerisine geçtiyse ya da blok değiştiyse kapanıyor.
			if (q === null || q.includes(" ")) {
				close();
				return;
			}
			filtrele(q);
			konumla();
			return;
		}

		const caret = editor.getCaret();
		if (caret === null || caret.offset === 0) return;
		const metin = blokMetni(caret);
		if (metin === null || metin[caret.offset - 1] !== "/") return;
		const onceki = caret.offset >= 2 ? metin[caret.offset - 2] : " ";
		if (onceki !== undefined && onceki.trim() !== "") return;
		open(caret.offset - 1);
	};

	element.addEventListener("keydown", tus, true);
	const sokChange = editor.on("change", yazildi);
	const disariTikla = (event: PointerEvent): void => {
		if (!acikMi()) return;
		const hedef = event.target;
		if (hedef instanceof Node && root.contains(hedef)) return;
		close();
	};
	doc.addEventListener("pointerdown", disariTikla, true);

	return {
		element: root,
		get isOpen() {
			return acikMi();
		},
		register(item) {
			ogeler.push(item);
			if (acikMi()) filtrele(sorgu() ?? "");
		},
		close,
		destroy() {
			element.removeEventListener("keydown", tus, true);
			doc.removeEventListener("pointerdown", disariTikla, true);
			sokChange();
			root.remove();
		},
	};
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/**
 * Yoldaki düğümü **olduğu gibi** döndürür.
 *
 * Yalnızca `children` alanını döndürmek yetmiyordu: ondan kurulan yeni
 * düğüm `type` alanını kaybediyor ve blok dönüşümleri onu tanıyamıyordu.
 * "Madde imli liste" öğesi tam olarak bu yüzden sessizce hiçbir şey
 * yapmıyordu — başlık öğeleri çalışıyordu çünkü `setBlockType` türü
 * kendisi yazıyor.
 */
function dugumBul(
	doc: Root,
	caret: Caret,
): { readonly children: readonly import("@kalem-editor/core").Inline[] } | null {
	let current: unknown = doc.children[caret.blockIndex];
	for (const index of caret.path) {
		const children = (current as { children?: readonly unknown[] } | undefined)?.children;
		if (children === undefined) return null;
		current = children[index];
	}
	const dugum = current as
		| { children?: readonly import("@kalem-editor/core").Inline[] }
		| undefined;
	if (dugum?.children === undefined) return null;
	return dugum as { readonly children: readonly import("@kalem-editor/core").Inline[] };
}

function duzMetin(node: import("@kalem-editor/core").Inline): string {
	switch (node.type) {
		case "text":
		case "html":
		case "inlineCode":
			return node.value;
		case "break":
			return "\n";
		case "image":
		case "imageReference":
			return "";
		default:
			return node.children.map(duzMetin).join("");
	}
}
