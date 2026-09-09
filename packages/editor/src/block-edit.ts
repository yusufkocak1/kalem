/**
 * @kalem/editor — Blok yapısı düzenlemeleri  (İş listesi: F2-08)
 *
 * ## Neden tarayıcıya bırakılmıyor
 *
 * `contenteditable` içinde Enter'a basmak tarayıcıya göre `<div>`, `<p>`
 * ya da `<br>` üretir; Backspace blok sınırında etiketleri birbirine
 * yedirir. Ortaya çıkan HTML'in Markdown karşılığı yoktur. Bu yüzden blok
 * yapısını değiştiren her tuş burada, **model üzerinde** karşılanıyor
 * (F2-05'teki akış kararı).
 *
 * ## Saf
 *
 * Bu dosyada DOM yok. Girdi bir belge ve bir imleç konumu, çıktı yeni bir
 * belge ve imlecin yeni konumu. Böylece davranışın tamamı birim testiyle
 * sabitlenebiliyor; tarayıcı testleri yalnızca tuşun buraya doğru
 * bağlandığını doğruluyor.
 */
import type { Block, Inline, ListItem, NodeId, Paragraph, Root } from "@kalem/core";
import { nodeAtPath, replaceAt } from "@kalem/core";
import { emptyParagraph } from "@kalem/core/commands";
import { newId } from "./ids.js";
import { listLength, sliceInline } from "./inline-edit.js";

/**
 * İmleç konumu.
 *
 * `path` blok kökünden satır içi taşıyıcıya giden yol; `offset` o
 * taşıyıcının içindeki karakter konumu. `render.ts`'in `data-kalem-path`
 * özniteliğiyle aynı yol.
 */
export interface Caret {
	readonly blockIndex: number;
	readonly path: readonly number[];
	readonly offset: number;
}

export interface EditResult {
	readonly doc: Root;
	readonly caret: Caret;
}

const paragraf = (children: readonly Inline[]): Paragraph => ({
	type: "paragraph",
	children: [...children],
});

/**
 * Kaynak konumunu düşürür.
 *
 * Serileştirici bloklar arasındaki boş satır sayısını `position`'dan
 * okuyor (F1-07). Aradan bir blok silindiğinde eski konumlar yalan söyler
 * ve çıktıda olmayan boş satırlar belirir; komşuluğu değişen bloğun
 * konumu bu yüzden düşürülüyor, varsayılan aralığa dönülüyor.
 */
function konumsuz<T extends { position?: unknown }>(node: T): T {
	const { position, ...kalan } = node;
	return kalan as T;
}

/** Yeni kimlikli üst düzey blok. */
function yeniBlok<T extends Block>(node: T): T {
	return { ...node, id: newId() };
}

function nodeAt(doc: Root, blockIndex: number, path: readonly number[]): unknown {
	return nodeAtPath(doc, [blockIndex, ...path]);
}

/** Taşıyıcının satır içi içeriği. */
function contentAt(doc: Root, caret: Caret): readonly Inline[] | null {
	const node = nodeAt(doc, caret.blockIndex, caret.path) as
		| { children?: readonly Inline[] }
		| undefined;
	return node?.children ?? null;
}

function withChildren<T>(
	doc: Root,
	blockIndex: number,
	path: readonly number[],
	children: T,
): Root {
	const node = nodeAt(doc, blockIndex, path) as object;
	return replaceAt(doc, [blockIndex, ...path], { ...node, children } as never);
}

/** Kökün çocuk listesini değiştirir. */
function withBlocks(doc: Root, children: Root["children"]): Root {
	return { ...doc, children };
}

// ---------------------------------------------------------------------------
// Enter — bloğu böl
// ---------------------------------------------------------------------------

/**
 * İmleçte bloğu böler.
 *
 * Üç kap türü var ve üçü de farklı davranıyor:
 *
 * - **Üst düzey paragraf/başlık** → iki üst düzey blok. Başlığın ikinci
 *   yarısı paragraf oluyor: başlığın ortasında Enter'a basan kullanıcı
 *   ikinci bir başlık değil, o başlığın altına metin yazmak istiyor.
 * - **Alıntı içi** → alıntının içinde yeni paragraf. Enter alıntıdan
 *   çıkarmıyor; çıkarsaydı çok paragraflı alıntı yazmak imkânsız olurdu.
 * - **Liste maddesi** → yeni madde. Madde **boşsa** listeden çıkılıyor;
 *   bu, her editörde listeyi bitirmenin yolu.
 */
export function splitAtCaret(doc: Root, caret: Caret): EditResult | null {
	const icerik = contentAt(doc, caret);
	if (icerik === null) return null;

	const uzunluk = listLength(icerik);
	const once = sliceInline(icerik, 0, caret.offset);
	const sonra = sliceInline(icerik, caret.offset, uzunluk);
	const blok = doc.children[caret.blockIndex];
	if (blok === undefined) return null;

	// --- Liste maddesi ---
	if (blok.type === "list" && caret.path.length === 2) {
		const itemIndex = caret.path[0] as number;
		if (uzunluk === 0) return exitList(doc, caret, itemIndex);
		return splitListItem(doc, caret, itemIndex, once, sonra);
	}

	// --- Alıntı içi ---
	if (blok.type === "blockquote" && caret.path.length === 1) {
		const index = caret.path[0] as number;
		const cocuklar = [...blok.children];
		cocuklar.splice(index, 1, paragraf(once), paragraf(sonra));
		return {
			doc: replaceAt(doc, [caret.blockIndex], { ...blok, children: cocuklar }),
			caret: { blockIndex: caret.blockIndex, path: [index + 1], offset: 0 },
		};
	}

	// --- Üst düzey paragraf / başlık ---
	if (caret.path.length !== 0) return null;
	if (blok.type !== "paragraph" && blok.type !== "heading") return null;

	const ilk = { ...blok, children: once };
	const ikinci = yeniBlok(paragraf(sonra));
	const children = [...doc.children];
	children.splice(caret.blockIndex, 1, ilk, ikinci);
	return {
		doc: withBlocks(doc, children as Root["children"]),
		caret: { blockIndex: caret.blockIndex + 1, path: [], offset: 0 },
	};
}

function splitListItem(
	doc: Root,
	caret: Caret,
	itemIndex: number,
	once: readonly Inline[],
	sonra: readonly Inline[],
): EditResult | null {
	const blok = doc.children[caret.blockIndex];
	if (blok?.type !== "list") return null;
	const madde = blok.children[itemIndex];
	if (madde === undefined) return null;

	const ilk: ListItem = { ...madde, children: [paragraf(once)] };
	const ikinci: ListItem = {
		type: "listItem",
		// Görev listesinde yeni madde de görev olmalı ama işaretsiz: yeni bir
		// iş eklendi, yapılmış sayılamaz.
		checked: madde.checked === null ? null : false,
		spread: madde.spread,
		children: [paragraf(sonra)],
	};
	const maddeler = [...blok.children];
	maddeler.splice(itemIndex, 1, ilk, ikinci);

	return {
		doc: replaceAt(doc, [caret.blockIndex], { ...blok, children: maddeler }),
		caret: { blockIndex: caret.blockIndex, path: [itemIndex + 1, 0], offset: 0 },
	};
}

/**
 * Boş maddede Enter → listeden çık.
 *
 * Boş madde listenin sonundaysa madde siliniyor ve listeden sonra paragraf
 * açılıyor. Ortadaysa liste ikiye bölünmüyor — madde yine siliniyor ve
 * paragraf araya giriyor; iki listenin arasındaki paragraf Markdown'da
 * geçerli ve kullanıcının kastettiği de bu.
 */
function exitList(doc: Root, caret: Caret, itemIndex: number): EditResult | null {
	const blok = doc.children[caret.blockIndex];
	if (blok?.type !== "list") return null;

	const once = blok.children.slice(0, itemIndex);
	const sonra = blok.children.slice(itemIndex + 1);
	const yeni: Block[] = [];
	if (once.length > 0) yeni.push(yeniBlok({ ...blok, children: once }));
	const bosluk = yeniBlok(emptyParagraph());
	yeni.push(bosluk);
	if (sonra.length > 0) yeni.push(yeniBlok({ ...blok, children: sonra }));

	const children = [...doc.children];
	children.splice(caret.blockIndex, 1, ...yeni);
	return {
		doc: withBlocks(doc, children as Root["children"]),
		caret: { blockIndex: caret.blockIndex + (once.length > 0 ? 1 : 0), path: [], offset: 0 },
	};
}

// ---------------------------------------------------------------------------
// Shift+Enter — satır sonu
// ---------------------------------------------------------------------------

/** İmlece sert satır sonu ekler. */
export function insertBreak(doc: Root, caret: Caret): EditResult | null {
	const icerik = contentAt(doc, caret);
	if (icerik === null) return null;
	const uzunluk = listLength(icerik);
	const yeni = [
		...sliceInline(icerik, 0, caret.offset),
		// Ters bölü, iki boşluğa yeğleniyor: sondaki iki boşluk görünmez,
		// çoğu editör ve linter onu kırpar, kırpınca satır sonu sessizce
		// kaybolur. Kaynakta zaten iki boşlukla yazılmış satır sonları
		// `syntax` sayesinde olduğu gibi kalıyor.
		{ type: "break", syntax: { marker: "backslash" } } as Inline,
		...sliceInline(icerik, caret.offset, uzunluk),
	];
	return {
		doc: withChildren(doc, caret.blockIndex, caret.path, yeni),
		caret: { ...caret, offset: caret.offset + 1 },
	};
}

// ---------------------------------------------------------------------------
// Backspace / Delete — blok sınırında birleştirme
// ---------------------------------------------------------------------------

/**
 * Bloğu bir öncekiyle birleştirir (blok başında Backspace).
 *
 * İmleç birleşme noktasına konuyor — kullanıcı sildiği şeyin nereye
 * gittiğini görmeli. Bu, birleştirmenin en çok fark edilen ayrıntısı.
 */
export function mergeWithPrevious(doc: Root, caret: Caret): EditResult | null {
	// Liste maddesi: önceki maddeyle birleş, ilk maddeyse listeden çık.
	if (caret.path.length === 2) {
		const itemIndex = caret.path[0] as number;
		return itemIndex === 0 ? liftFirstItem(doc, caret) : mergeListItems(doc, caret, itemIndex);
	}
	if (caret.path.length !== 0) return null;

	const index = caret.blockIndex;
	if (index === 0) return null;
	const onceki = doc.children[index - 1];
	const simdiki = doc.children[index];
	if (onceki === undefined || simdiki === undefined) return null;

	// Önceki blok metin taşımıyorsa (yatay çizgi, kod) birleşme olmaz;
	// silinir. Kullanıcı Backspace ile onu kaldırmak istiyor.
	if (!isTextBlock(onceki)) {
		const children = [...doc.children];
		children.splice(index - 1, 1, konumsuz(simdiki));
		children.splice(index, 1);
		return {
			doc: withBlocks(doc, children as Root["children"]),
			caret: { blockIndex: index - 1, path: [], offset: 0 },
		};
	}
	if (!isTextBlock(simdiki)) return null;

	const birlesik = { ...onceki, children: [...onceki.children, ...simdiki.children] };
	const children = [...doc.children];
	children.splice(index - 1, 2, birlesik);
	return {
		doc: withBlocks(doc, children as Root["children"]),
		caret: { blockIndex: index - 1, path: [], offset: listLength(onceki.children) },
	};
}

/** Bir sonraki bloğu bu bloğun sonuna ekler (blok sonunda Delete). */
export function mergeWithNext(doc: Root, caret: Caret): EditResult | null {
	if (caret.path.length !== 0) return null;
	const sonraki = doc.children[caret.blockIndex + 1];
	if (sonraki === undefined) return null;
	return mergeWithPrevious(doc, { blockIndex: caret.blockIndex + 1, path: [], offset: 0 });
}

type TextBlock = Extract<Block, { type: "paragraph" | "heading" }>;

function isTextBlock(node: Root["children"][number]): node is TextBlock {
	return node.type === "paragraph" || node.type === "heading";
}

function mergeListItems(doc: Root, caret: Caret, itemIndex: number): EditResult | null {
	const blok = doc.children[caret.blockIndex];
	if (blok?.type !== "list") return null;
	const onceki = blok.children[itemIndex - 1];
	const simdiki = blok.children[itemIndex];
	if (onceki === undefined || simdiki === undefined) return null;

	const onceIcerik = itemContent(onceki);
	const simdiIcerik = itemContent(simdiki);
	if (onceIcerik === null || simdiIcerik === null) return null;

	const maddeler = [...blok.children];
	maddeler.splice(itemIndex - 1, 2, {
		...onceki,
		children: [paragraf([...onceIcerik, ...simdiIcerik])],
	});
	return {
		doc: replaceAt(doc, [caret.blockIndex], { ...blok, children: maddeler }),
		caret: {
			blockIndex: caret.blockIndex,
			path: [itemIndex - 1, 0],
			offset: listLength(onceIcerik),
		},
	};
}

/** Maddenin tek paragraflı içeriği; değilse `null` (birleştirme yapılmaz). */
function itemContent(item: ListItem): readonly Inline[] | null {
	if (item.children.length !== 1) return null;
	const ilk = item.children[0];
	return ilk?.type === "paragraph" ? ilk.children : null;
}

/** İlk maddede Backspace → maddeyi listeden çıkarıp paragrafa çevir. */
function liftFirstItem(doc: Root, caret: Caret): EditResult | null {
	const blok = doc.children[caret.blockIndex];
	if (blok?.type !== "list") return null;
	const madde = blok.children[0];
	const icerik = madde === undefined ? null : itemContent(madde);
	if (icerik === null) return null;

	const yeni: Block[] = [yeniBlok(paragraf(icerik))];
	const kalan = blok.children.slice(1);
	if (kalan.length > 0) yeni.push(yeniBlok({ ...blok, children: kalan }));

	const children = [...doc.children];
	children.splice(caret.blockIndex, 1, ...yeni);
	return {
		doc: withBlocks(doc, children as Root["children"]),
		caret: { blockIndex: caret.blockIndex, path: [], offset: 0 },
	};
}

// ---------------------------------------------------------------------------
// Tab / Shift+Tab — liste girintisi
// ---------------------------------------------------------------------------

/**
 * Liste maddesini bir seviye içeri alır.
 *
 * İlk madde girintilenemez: girintili bir maddenin üstünde bir ana madde
 * olmak zorunda, yoksa Markdown'da karşılığı yok.
 */
export function indentItem(doc: Root, caret: Caret): EditResult | null {
	if (caret.path.length !== 2) return null;
	const itemIndex = caret.path[0] as number;
	if (itemIndex === 0) return null;

	const blok = doc.children[caret.blockIndex];
	if (blok?.type !== "list") return null;
	const onceki = blok.children[itemIndex - 1];
	const simdiki = blok.children[itemIndex];
	if (onceki === undefined || simdiki === undefined) return null;

	// Önceki maddenin sonunda zaten iç liste varsa ona ekleniyor; yoksa yeni
	// bir iç liste açılıyor. İki ayrı iç liste üretmek, aynı görünen ama
	// farklı serileşen bir ağaç bırakırdı.
	const son = onceki.children[onceki.children.length - 1];
	const icListe =
		son?.type === "list"
			? { ...son, children: [...son.children, simdiki] }
			: {
					type: "list" as const,
					ordered: blok.ordered,
					start: null,
					spread: false,
					children: [simdiki],
				};

	const yeniOnceki: ListItem = {
		...onceki,
		children:
			son?.type === "list"
				? [...onceki.children.slice(0, -1), icListe]
				: [...onceki.children, icListe],
	};
	const maddeler = [...blok.children];
	maddeler.splice(itemIndex - 1, 2, yeniOnceki);

	const icIndex = icListe.children.length - 1;
	return {
		doc: replaceAt(doc, [caret.blockIndex], { ...blok, children: maddeler }),
		caret: {
			blockIndex: caret.blockIndex,
			path: [itemIndex - 1, yeniOnceki.children.length - 1, icIndex, 0],
			offset: caret.offset,
		},
	};
}

/**
 * İç listedeki maddeyi bir seviye dışarı alır.
 *
 * Yalnızca tek seviye içerideki maddeler destekleniyor; daha derin
 * girintiler için aynı işlem tekrarlanıyor. Rastgele derinlikte yeniden
 * yapılandırma, `lift`'in çekirdekteki sınırlarıyla (F1-11) uyumlu
 * tutuldu.
 */
export function outdentItem(doc: Root, caret: Caret): EditResult | null {
	if (caret.path.length !== 4) return null;
	const [disIndex, cocukIndex, icIndex] = caret.path as [number, number, number, number];

	const blok = doc.children[caret.blockIndex];
	if (blok?.type !== "list") return null;
	const dis = blok.children[disIndex];
	const icListe = dis?.children[cocukIndex];
	if (dis === undefined || icListe?.type !== "list") return null;
	const madde = icListe.children[icIndex];
	if (madde === undefined) return null;

	const kalan = icListe.children.filter((_, i) => i !== icIndex);
	const yeniDis: ListItem = {
		...dis,
		children:
			kalan.length > 0
				? dis.children.map((c, i) => (i === cocukIndex ? { ...icListe, children: kalan } : c))
				: dis.children.filter((_, i) => i !== cocukIndex),
	};

	const maddeler = [...blok.children];
	maddeler.splice(disIndex, 1, yeniDis, madde);
	return {
		doc: replaceAt(doc, [caret.blockIndex], { ...blok, children: maddeler }),
		caret: { blockIndex: caret.blockIndex, path: [disIndex + 1, 0], offset: caret.offset },
	};
}

// ---------------------------------------------------------------------------
// Blok türü dönüşümleri
// ---------------------------------------------------------------------------

/** İmlecin bulunduğu üst düzey bloğu listeye çevirir ya da listeden çıkarır. */
export function toggleList(doc: Root, caret: Caret, ordered: boolean): EditResult | null {
	const blok = doc.children[caret.blockIndex];
	if (blok === undefined) return null;

	// Zaten aynı türde listeyse: maddeleri paragrafa çevir.
	if (blok.type === "list" && blok.ordered === ordered && caret.path.length === 2) {
		const paragraflar = blok.children.flatMap((item) => {
			const icerik = itemContent(item);
			return icerik === null ? [] : [yeniBlok(paragraf(icerik))];
		});
		if (paragraflar.length === 0) return null;
		const children = [...doc.children];
		children.splice(caret.blockIndex, 1, ...paragraflar);
		return {
			doc: withBlocks(doc, children as Root["children"]),
			caret: {
				blockIndex: caret.blockIndex + (caret.path[0] as number),
				path: [],
				offset: caret.offset,
			},
		};
	}

	// Farklı türde listeyse yalnızca türü değiştir.
	if (blok.type === "list") {
		// `syntax` bilerek düşürülüyor: kaynaktaki `-` işareti ya da `)`
		// ayracı artık başka türden bir listeye ait, taşınması yanlış olurdu.
		const { syntax, ...kalan } = blok;
		return {
			doc: replaceAt(doc, [caret.blockIndex], {
				...kalan,
				ordered,
				start: ordered ? 1 : null,
			}),
			caret,
		};
	}

	if (blok.type !== "paragraph" && blok.type !== "heading") return null;
	const liste: Block = yeniBlok({
		type: "list",
		ordered,
		start: ordered ? 1 : null,
		spread: false,
		children: [
			{ type: "listItem", checked: null, spread: false, children: [paragraf(blok.children)] },
		],
	});
	return {
		doc: replaceAt(doc, [caret.blockIndex], liste),
		caret: { blockIndex: caret.blockIndex, path: [0, 0], offset: caret.offset },
	};
}

/**
 * Belgeyi düzenlenebilir hâle getirir.
 *
 * Ayrıştırıcı boş bir liste maddesini (`- `) **çocuksuz** üretiyor ve bu
 * doğru: kaynakta gerçekten içerik yok. Ama çocuksuz maddenin render
 * edilecek bir içerik taşıyıcısı da olmuyor — kullanıcı o maddeye
 * tıklayamıyor, yazamıyor. Editör bu yüzden her maddeye en az bir boş
 * paragraf koyuyor.
 *
 * Bedeli: böyle bir belge hiç düzenlenmeden `getValue()` ile geri
 * alındığında `- ` yerine `-` yazılıyor (sondaki boşluk kırpılıyor).
 * Görüntüleyici ve çekirdek etkilenmiyor; normalleştirme editöre özgü.
 */
export function normalizeDocument(doc: Root): Root {
	// Bloksuz belgeye tıklanacak yer yok; kullanıcı yazmaya başlayamaz.
	// `new Editor(el)` — yani en sık başlangıç hâli — tam olarak buraya
	// düşüyordu.
	if (doc.children.length === 0) {
		return { ...doc, children: [emptyParagraph()] };
	}

	let degisti = false;
	const children = doc.children.map((blok) => {
		if (blok.type !== "list") return blok;
		let listeDegisti = false;
		const maddeler = blok.children.map((madde) => {
			if (madde.children.length > 0) return madde;
			listeDegisti = true;
			return { ...madde, children: [emptyParagraph()] };
		});
		if (!listeDegisti) return blok;
		degisti = true;
		return { ...blok, children: maddeler };
	});
	return degisti ? withBlocks(doc, children as Root["children"]) : doc;
}

/** Kimlik atanmış boş paragraf — dışarıdan da gerekiyor. */
export function newParagraph(): Block & { id: NodeId } {
	return yeniBlok(emptyParagraph()) as Block & { id: NodeId };
}
