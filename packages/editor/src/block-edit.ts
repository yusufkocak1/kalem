/**
 * @kalem-editor/editor — Blok yapısı düzenlemeleri  (İş listesi: F2-08)
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
import type { Block, Inline, List, ListItem, NodeId, Paragraph, Root } from "@kalem-editor/core";
import { isFrontmatter, nodeAtPath, replaceAt } from "@kalem-editor/core";
import { emptyParagraph } from "@kalem-editor/core/commands";
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

/** İki imleç aynı yeri mi gösteriyor. */
export function sameCaret(a: Caret | null, b: Caret | null): boolean {
	if (a === null || b === null) return a === b;
	return (
		a.blockIndex === b.blockIndex &&
		a.offset === b.offset &&
		a.path.length === b.path.length &&
		a.path.every((n, i) => n === b.path[i])
	);
}

export interface EditResult {
	readonly doc: Root;
	/**
	 * Düzenlemeden sonra imlecin gideceği yer.
	 *
	 * `null` = **imlece dokunma**. Kullanıcının başlatmadığı, arka planda
	 * biten düzenlemeler için gerekli: bir görsel yüklemesi tamamlandığında
	 * (F4-01) imleci taşımak, kullanıcıyı yazdığı yerden koparıyor — odak
	 * editörün dışındaysa oraya geri **çekiyor**.
	 */
	readonly caret: Caret | null;
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

/**
 * Komşuluğu değişen blokların konum bilgisini düşürür.
 *
 * Serileştirici iki blok arasındaki boş satır sayısını `position`'dan
 * okuyor (F1-07). Bir blok taşındığında yalnızca taşınanın değil,
 * **açılan boşluğun ve eklenen yerin komşularının** da eski konumu yalan
 * söylüyor; dokunulmadan bırakılırsa çıktıda olmayan boş satırlar
 * beliriyor.
 *
 * Kural tek cümle: *önceki komşusu değişen blok konumunu kaybeder.*
 * Dokunulmayan blokların özgün boş satır sayısı böylece korunuyor.
 *
 * Paket dışına açılmıyor; blok dizisini yeniden kuran her işlem
 * (`block-edit.ts`, `paste.ts`) bunu kullanmak zorunda.
 */
export function komsulukTazele<T extends { position?: unknown }>(
	onceki: readonly T[],
	yeni: readonly T[],
): T[] {
	const indeks = new Map<T, number>();
	for (const [i, node] of onceki.entries()) indeks.set(node, i);

	return yeni.map((node, i) => {
		const eski = indeks.get(node);
		const eskiOnce = eski === undefined ? undefined : onceki[eski - 1];
		return eskiOnce === yeni[i - 1] ? node : konumsuz(node);
	});
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

/**
 * İmlecin içinde bulunduğu liste maddesi — hangi derinlikte olursa olsun.
 *
 * Liste bloğundaki yol madde ve çocuk indekslerinin sırayla dizilişi:
 * `[madde, çocuk, madde, çocuk, …, madde, paragraf]`. Üst düzey maddede
 * yol iki elemanlı, bir seviye içeride dört elemanlı. Enter, Tab ve
 * Backspace yalnızca iki ve dört elemanlı yolları tanıdığı için daha
 * derindeki maddelerde (ve iç maddede Enter'da) tuş sessizce yutuluyordu.
 */
interface MaddeYeri {
	/** Maddenin listesinin liste bloğu içindeki yolu; üst düzey listede `[]`. */
	readonly listePath: readonly number[];
	readonly liste: List;
	readonly itemIndex: number;
	readonly madde: ListItem;
	/** İmlecin bulunduğu paragrafın madde içindeki indeksi. */
	readonly cocukIndex: number;
}

function maddeYeri(doc: Root, caret: Caret): MaddeYeri | null {
	const blok = doc.children[caret.blockIndex];
	const yol = caret.path;
	if (blok?.type !== "list" || yol.length < 2 || yol.length % 2 !== 0) return null;
	let liste: List = blok;
	for (let k = 0; k < yol.length - 2; k += 2) {
		const ic = liste.children[yol[k] as number]?.children[yol[k + 1] as number];
		if (ic?.type !== "list") return null;
		liste = ic;
	}
	const itemIndex = yol[yol.length - 2] as number;
	const cocukIndex = yol[yol.length - 1] as number;
	const madde = liste.children[itemIndex];
	if (madde?.children[cocukIndex]?.type !== "paragraph") return null;
	return { listePath: yol.slice(0, -2), liste, itemIndex, madde, cocukIndex };
}

/** Liste bloğundaki `listePath` yolundaki listeyi değiştirir. */
function listeyiDegistir(
	doc: Root,
	blockIndex: number,
	listePath: readonly number[],
	liste: List,
): Root {
	return replaceAt(doc, [blockIndex, ...listePath], liste);
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
 * - **Liste maddesi** → yeni madde, hangi derinlikte olursa olsun. Madde
 *   **boşsa** üst düzeyde listeden çıkılıyor, iç listede bir seviye
 *   dışarı alınıyor; bu, her editörde listeyi bitirmenin yolu.
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
	const yer = maddeYeri(doc, caret);
	if (yer !== null) {
		// Altında iç listesi olan boş madde çıkarılmıyor: çıkarmak iç listeyi
		// de silerdi. Bölünüyor; iç liste yeni maddenin altına geçiyor.
		if (uzunluk === 0 && yer.madde.children.length === 1) {
			return yer.listePath.length === 0
				? exitList(doc, caret, yer.itemIndex)
				: liftItem(doc, caret);
		}
		return splitListItem(doc, caret, yer, once, sonra);
	}

	// --- Tablo hücresi ---
	// Hücre bölünemez; Enter, kelime işlemcilerdeki gibi hücrede yeni satıra geçer.
	if (blok.type === "table" && caret.path.length === 2) return insertBreak(doc, caret);

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

/**
 * Maddeyi imleçte ikiye böler.
 *
 * İmleçten sonraki her şey yeni maddeye geçiyor: paragrafın kalanı ve
 * maddenin altındaki iç liste. Eskiden yalnızca paragraf bölünüyor, iç
 * liste sessizce siliniyordu — üst maddenin sonunda Enter'a basmak alt
 * maddeleri yok ediyordu.
 */
function splitListItem(
	doc: Root,
	caret: Caret,
	yer: MaddeYeri,
	once: readonly Inline[],
	sonra: readonly Inline[],
): EditResult | null {
	const { madde, cocukIndex, itemIndex, liste, listePath } = yer;
	const ilk: ListItem = {
		...madde,
		children: [...madde.children.slice(0, cocukIndex), paragraf(once)],
	};
	const ikinci: ListItem = {
		type: "listItem",
		// Görev listesinde yeni madde de görev olmalı ama işaretsiz: yeni bir
		// iş eklendi, yapılmış sayılamaz.
		checked: madde.checked === null ? null : false,
		spread: madde.spread,
		children: [paragraf(sonra), ...madde.children.slice(cocukIndex + 1)],
	};
	const maddeler = [...liste.children];
	maddeler.splice(itemIndex, 1, ilk, ikinci);

	return {
		doc: listeyiDegistir(doc, caret.blockIndex, listePath, { ...liste, children: maddeler }),
		caret: { blockIndex: caret.blockIndex, path: [...listePath, itemIndex + 1, 0], offset: 0 },
	};
}

/**
 * İç listedeki maddeyi bir seviye dışarı alır (Shift+Tab, boş iç maddede
 * Enter, iç maddenin başında Backspace).
 *
 * Madde, üst maddesinin hemen arkasına geçiyor. Kendisinden **sonraki**
 * kardeşleri onun altına taşınıyor: yerlerinde bırakılsalar üst maddenin
 * altında kalır ve ekranda dışarı alınan maddenin **üstüne** çıkarlardı —
 * okunan sıra değişirdi.
 */
function liftItem(doc: Root, caret: Caret): EditResult | null {
	const yer = maddeYeri(doc, caret);
	if (yer === null || yer.listePath.length < 2) return null;
	const disListePath = yer.listePath.slice(0, -2);
	const disIndex = yer.listePath[yer.listePath.length - 2] as number;
	const icListeIndex = yer.listePath[yer.listePath.length - 1] as number;
	const disListe = nodeAt(doc, caret.blockIndex, disListePath) as List | undefined;
	const dis = disListe?.children[disIndex];
	if (disListe?.type !== "list" || dis === undefined) return null;

	const onceki = yer.liste.children.slice(0, yer.itemIndex);
	const sonraki = yer.liste.children.slice(yer.itemIndex + 1);
	const yeniDis: ListItem = {
		...dis,
		children:
			onceki.length > 0
				? dis.children.map((c, i) => (i === icListeIndex ? { ...yer.liste, children: onceki } : c))
				: dis.children.filter((_, i) => i !== icListeIndex),
	};

	let madde = yer.madde;
	if (sonraki.length > 0) {
		const son = madde.children[madde.children.length - 1];
		madde = {
			...madde,
			children:
				son?.type === "list"
					? [...madde.children.slice(0, -1), { ...son, children: [...son.children, ...sonraki] }]
					: [
							...madde.children,
							{ ...yer.liste, start: yer.liste.ordered ? 1 : null, children: sonraki },
						],
		};
	}

	const maddeler = [...disListe.children];
	maddeler.splice(disIndex, 1, yeniDis, madde);
	return {
		doc: listeyiDegistir(doc, caret.blockIndex, disListePath, { ...disListe, children: maddeler }),
		caret: {
			blockIndex: caret.blockIndex,
			path: [...disListePath, disIndex + 1, yer.cocukIndex],
			offset: caret.offset,
		},
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
	// İç maddenin başında Backspace girintiyi azaltıyor (Word, Google Docs).
	if (caret.path.length >= 4) return liftItem(doc, caret);
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
 * olmak zorunda, yoksa Markdown'da karşılığı yok. İç listelerde de
 * çalışıyor; madde her basışta bir seviye daha içeri giriyor.
 */
export function indentItem(doc: Root, caret: Caret): EditResult | null {
	const yer = maddeYeri(doc, caret);
	if (yer === null) return null;
	const { itemIndex, liste, listePath } = yer;
	if (itemIndex === 0) return null;

	const onceki = liste.children[itemIndex - 1];
	const simdiki = yer.madde;
	if (onceki === undefined) return null;

	// Önceki maddenin sonunda zaten iç liste varsa ona ekleniyor; yoksa yeni
	// bir iç liste açılıyor. İki ayrı iç liste üretmek, aynı görünen ama
	// farklı serileşen bir ağaç bırakırdı.
	const son = onceki.children[onceki.children.length - 1];
	const icListe =
		son?.type === "list"
			? { ...son, children: [...son.children, simdiki] }
			: {
					type: "list" as const,
					ordered: liste.ordered,
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
	const maddeler = [...liste.children];
	maddeler.splice(itemIndex - 1, 2, yeniOnceki);

	const icIndex = icListe.children.length - 1;
	return {
		doc: listeyiDegistir(doc, caret.blockIndex, listePath, { ...liste, children: maddeler }),
		caret: {
			blockIndex: caret.blockIndex,
			path: [...listePath, itemIndex - 1, yeniOnceki.children.length - 1, icIndex, yer.cocukIndex],
			offset: caret.offset,
		},
	};
}

/**
 * İç listedeki maddeyi bir seviye dışarı alır (Shift+Tab), hangi
 * derinlikte olursa olsun. Üst düzey maddede bir şey yapmıyor.
 */
export function outdentItem(doc: Root, caret: Caret): EditResult | null {
	return liftItem(doc, caret);
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
		const yeni = bosMaddeleriDoldur(blok);
		if (yeni !== blok) degisti = true;
		return yeni;
	});
	return degisti ? withBlocks(doc, children as Root["children"]) : doc;
}

/**
 * Listedeki — iç listeler dâhil — çocuksuz maddelere boş paragraf koyar.
 * Değişiklik yoksa aynı nesneyi döndürür; değişmeyen bloğun DOM'u yeniden
 * kurulmasın diye.
 */
function bosMaddeleriDoldur(liste: List): List {
	let degisti = false;
	const maddeler = liste.children.map((madde): ListItem => {
		if (madde.children.length === 0) {
			degisti = true;
			return { ...madde, children: [emptyParagraph()] };
		}
		let icDegisti = false;
		const cocuklar = madde.children.map((cocuk) => {
			if (cocuk.type !== "list") return cocuk;
			const yeni = bosMaddeleriDoldur(cocuk);
			if (yeni !== cocuk) icDegisti = true;
			return yeni;
		});
		if (!icDegisti) return madde;
		degisti = true;
		return { ...madde, children: cocuklar };
	});
	return degisti ? { ...liste, children: maddeler } : liste;
}

/** Kimlik atanmış boş paragraf — dışarıdan da gerekiyor. */
export function newParagraph(): Block & { id: NodeId } {
	return yeniBlok(emptyParagraph()) as Block & { id: NodeId };
}

// ---------------------------------------------------------------------------
// Blok taşıma
// ---------------------------------------------------------------------------

/**
 * `count` bloğu `from` konumundan `to` konumuna taşır.
 *
 * `to`, taşınacak bloklar **çıkarılmadan önceki** listeye göre veriliyor:
 * "3. bloğu 1. sıraya al" demek, kullanıcının ekranda gördüğü sırayla
 * konuşmak demek. Çıkarma sonrası indeks kaymasını bu fonksiyon
 * hesaplıyor; çağıranın hesaplaması gereken tek şey nereye bıraktığı.
 *
 * Taşınan blokların **konum bilgisi düşürülüyor**: serileştirici bloklar
 * arası boş satır sayısını `position`'dan okuyor (F1-07) ve taşınmış bir
 * bloğun eski satır numarası yalan söylüyor.
 */
export function moveBlocks(doc: Root, from: number, count: number, to: number): EditResult | null {
	const toplam = doc.children.length;
	if (from < 0 || count < 1 || from + count > toplam) return null;
	// Kendi içine taşımak ve yerinde bırakmak işlemsiz.
	if (to >= from && to <= from + count) return null;

	const tasinan = doc.children.slice(from, from + count);
	const kalan = [...doc.children.slice(0, from), ...doc.children.slice(from + count)];
	const hedef = to > from ? to - count : to;

	const children = komsulukTazele(doc.children, [
		...kalan.slice(0, hedef),
		...tasinan,
		...kalan.slice(hedef),
	]);
	return {
		doc: withBlocks(doc, children as Root["children"]),
		caret: { blockIndex: hedef, path: [], offset: 0 },
	};
}

/**
 * Bloğu bir sıra yukarı ya da aşağı taşır.
 *
 * Sürükle-bırakın klavye karşılığı (F3-10): sürükleme tek yol olamaz.
 */
export function nudgeBlock(doc: Root, blockIndex: number, direction: -1 | 1): EditResult | null {
	const hedef = blockIndex + direction;
	if (hedef < 0 || hedef >= doc.children.length) return null;
	// Aşağı taşırken hedef, çıkarma öncesi listeye göre bir fazla.
	return moveBlocks(doc, blockIndex, 1, direction === 1 ? hedef + 1 : hedef);
}

// ---------------------------------------------------------------------------
// Blok çoğaltma ve silme
// ---------------------------------------------------------------------------

/**
 * `count` bloğun kopyasını hemen altına ekler.
 *
 * Kopyaların **kimliği yeni**: kimlik DOM eşlemesinin anahtarı (F2-05) ve
 * iki blok aynı kimliği taşırsa `#sync` hangisinin hangisi olduğunu
 * bilemiyor. Yalnızca üst düzey bloklar kimlik taşıdığı için derin bir
 * kimlik gezintisi gerekmiyor.
 *
 * Kopyaların konumu da düşürülüyor: özgün bloğun satır numarası kopyası
 * için yalan.
 *
 * **Ön madde çoğaltılamıyor.** Belgede en fazla bir ön madde olabiliyor ve
 * o da ilk çocuk olmak zorunda (`ast.ts`); kopyası geçersiz bir belge
 * üretirdi.
 */
export function duplicateBlocks(doc: Root, from: number, count = 1): EditResult | null {
	if (from < 0 || count < 1 || from + count > doc.children.length) return null;

	const kopya: Block[] = [];
	for (const node of doc.children.slice(from, from + count)) {
		if (isFrontmatter(node)) return null;
		kopya.push(yeniBlok(konumsuz(node)));
	}
	const children = komsulukTazele(doc.children, [
		...doc.children.slice(0, from + count),
		...kopya,
		...doc.children.slice(from + count),
	]);
	return {
		doc: withBlocks(doc, children as Root["children"]),
		// İmleç kopyaya gidiyor: çoğaltan kullanıcı kopyayı düzenlemek istiyor.
		caret: { blockIndex: from + count, path: [], offset: 0 },
	};
}

/**
 * `count` bloğu siler.
 *
 * Belge tamamen boşalırsa yerine boş bir paragraf konuyor: sıfır bloklu
 * belgede imleç konulacak yer yok ve editör kullanılamaz hâle geliyor
 * (F2-08'de bir kez yaşandı).
 */
export function deleteBlocks(doc: Root, from: number, count = 1): EditResult | null {
	if (from < 0 || count < 1 || from + count > doc.children.length) return null;

	const kalan = komsulukTazele(doc.children, [
		...doc.children.slice(0, from),
		...doc.children.slice(from + count),
	]);
	const children = kalan.length > 0 ? kalan : [newParagraph()];
	return {
		doc: withBlocks(doc, children as Root["children"]),
		// Silinenin yerine geçen blok; sonuncu silindiyse bir öncekine.
		caret: { blockIndex: Math.min(from, children.length - 1), path: [], offset: 0 },
	};
}

// ---------------------------------------------------------------------------
// Merging blocks
// ---------------------------------------------------------------------------

/**
 * Merges `count` consecutive top-level blocks into the first one.
 *
 * The first block decides the result: text blocks are joined line by line
 * (hard breaks), a code block takes the others as code lines, a list takes
 * them as items and a quote takes them as its content. Returns `null` when a
 * block cannot go into the first one (tables, rules, frontmatter…).
 */
export function mergeBlocks(doc: Root, from: number, count: number): EditResult | null {
	if (from < 0 || count < 2 || from + count > doc.children.length) return null;
	const [target, ...rest] = doc.children.slice(from, from + count);
	if (target === undefined || isFrontmatter(target) || rest.some(isFrontmatter)) return null;

	const merged = mergeInto(target, rest as Block[]);
	if (merged === null) return null;

	const children = komsulukTazele(doc.children, [
		...doc.children.slice(0, from),
		konumsuz(merged.block),
		...doc.children.slice(from + count),
	]);
	return {
		doc: withBlocks(doc, children as Root["children"]),
		caret: { blockIndex: from, path: merged.path, offset: merged.offset },
	};
}

interface Merged {
	readonly block: Block;
	readonly path: readonly number[];
	readonly offset: number;
}

function mergeInto(target: Block, rest: readonly Block[]): Merged | null {
	if (isTextBlock(target)) {
		const children = [...target.children];
		for (const block of rest) {
			const line = isTextBlock(block)
				? block.children
				: block.type === "code"
					? codeLines(block)
					: null;
			if (line === null) return null;
			if (line.length === 0) continue;
			if (children.length > 0) children.push({ type: "break" });
			children.push(...line);
		}
		return { block: { ...target, children }, path: [], offset: listLength(target.children) };
	}

	if (target.type === "code") {
		const parts = [target.value];
		for (const block of rest) {
			if (block.type === "code") parts.push(block.value);
			else if (isTextBlock(block)) parts.push(plainLines(block.children));
			else return null;
		}
		const lines = parts.map((part) => part.replace(/\n$/, "")).filter((part) => part !== "");
		const value = lines.join("\n") + (target.value.endsWith("\n") ? "\n" : "");
		return { block: { ...target, value }, path: [], offset: 0 };
	}

	if (target.type === "list") {
		const items = [...target.children];
		for (const block of rest) {
			if (block.type === "list") items.push(...block.children.map(konumsuz));
			else if (isTextBlock(block)) items.push(listItemOf(paragraf(block.children)));
			else if (block.type === "code") items.push(listItemOf(nested(block)));
			else return null;
		}
		return { block: { ...target, children: items }, path: [0, 0], offset: 0 };
	}

	if (target.type === "blockquote") {
		const children = [...target.children];
		for (const block of rest) {
			if (block.type === "blockquote") children.push(...block.children);
			else children.push(nested(block));
		}
		return { block: { ...target, children }, path: [0], offset: 0 };
	}

	return null;
}

/** Only top-level blocks carry an id and a source position. */
function nested<T extends Block>(block: T): T {
	const { id, position, ...rest } = block;
	return rest as T;
}

function listItemOf(block: Block): ListItem {
	return { type: "listItem", checked: null, spread: false, children: [block] };
}

function codeLines(block: Extract<Block, { type: "code" }>): Inline[] {
	const out: Inline[] = [];
	for (const line of block.value.replace(/\n$/, "").split("\n")) {
		if (out.length > 0) out.push({ type: "break" });
		if (line !== "") out.push({ type: "text", value: line });
	}
	return out;
}

function plainLines(nodes: readonly Inline[]): string {
	let out = "";
	for (const node of nodes) {
		if (node.type === "break") out += "\n";
		else if (node.type === "text" || node.type === "inlineCode" || node.type === "html")
			out += node.value;
		else if ("children" in node) out += plainLines(node.children);
		else if (node.type === "image") out += node.alt ?? "";
	}
	return out;
}
