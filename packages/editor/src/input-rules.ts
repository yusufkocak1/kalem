/**
 * @kalem/editor — Giriş kuralları  (İş listesi: F2-10)
 *
 * ## Ne işe yarıyor
 *
 * Markdown bilen kullanıcı `## ` yazıp başlığa geçmek istiyor; bilmeyen
 * kullanıcı `- ` yazınca listenin kendiliğinden oluşmasını bekliyor.
 * İkisi de aynı mekanizmayla karşılanıyor: yazılan metin bir kalıba
 * uyduğu anda blok ya da satır içi dönüşüme çevriliyor ve **işaretler
 * metinden siliniyor**.
 *
 * ## Saf
 *
 * `block-edit.ts` gibi burada da DOM yok: girdi belge + imleç, çıktı yeni
 * belge + imleç. Kuralların hangi tuştan sonra çalıştırılacağı çağıranın
 * işi.
 *
 * ## Geri alınabilirlik
 *
 * Dönüşüm ayrı bir geçmiş kaydı olarak yazılıyor (gruplanmıyor), yani tek
 * bir Ctrl+Z kuralı iptal edip yazılan metni **olduğu gibi** bırakıyor.
 * "`# ` yazdım ama başlık istemiyordum" durumunun tek makul cevabı bu.
 */
import type { Block, Inline, Root } from "@kalem/core";
import { replaceAt } from "@kalem/core";
import type { Caret, EditResult } from "./block-edit.js";
import { newId } from "./ids.js";
import { listLength, sliceInline, spliceInline } from "./inline-edit.js";

/** Satır içi listenin düz metni — kalıplar bunun üzerinde çalışıyor. */
export function plainInline(nodes: readonly Inline[]): string {
	let out = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
			case "html":
				out += node.value;
				break;
			case "inlineCode":
				out += node.value;
				break;
			case "break":
				out += "\n";
				break;
			case "image":
			case "imageReference":
				break;
			default:
				out += plainInline(node.children);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Blok kuralları
// ---------------------------------------------------------------------------

/**
 * Blok başındaki işaret kalıpları.
 *
 * Hepsi **satır başında** ve imleç tam işaretin sonunda olduğunda
 * çalışıyor. `- ` yazıp sonra imleci başa götürüp bir şey yazan kullanıcı
 * beklenmedik bir liste görmemeli.
 */
const BASLIK = /^(#{1,6}) $/;
const MADDE_LISTE = /^([-*+]) $/;
const SIRALI_LISTE = /^(\d{1,9})([.)]) $/;
const ALINTI = /^> $/;
const KOD = /^(`{3}|~{3})$/;
const CIZGI = /^(-{3,}|\*{3,}|_{3,})$/;

/**
 * Blok kurallarını dener.
 *
 * Yalnızca **üst düzey paragraflarda** çalışıyor. Başlıkta `- ` yazmak
 * listeye çevirmemeli; kullanıcı orada gerçekten tire yazıyor olabilir ve
 * başlığı listeye çevirmek sürpriz olur.
 */
export function applyBlockRule(doc: Root, caret: Caret): EditResult | null {
	if (caret.path.length !== 0) return null;
	const blok = doc.children[caret.blockIndex];
	if (blok?.type !== "paragraph") return null;

	const metin = plainInline(blok.children);
	const onEk = metin.slice(0, caret.offset);
	// İmleç işaretin hemen sonunda değilse kural çalışmıyor.
	if (onEk.length !== caret.offset) return null;

	const baslik = BASLIK.exec(onEk);
	if (baslik !== null) {
		const depth = (baslik[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6;
		return degistir(doc, caret, {
			...blok,
			type: "heading",
			depth,
			children: kalanIcerik(blok.children, caret.offset),
		} as Block);
	}

	const madde = MADDE_LISTE.exec(onEk);
	if (madde !== null) {
		return listeYap(doc, caret, blok.children, false, madde[1] as "-" | "*" | "+", null);
	}

	const sirali = SIRALI_LISTE.exec(onEk);
	if (sirali !== null) {
		return listeYap(
			doc,
			caret,
			blok.children,
			true,
			null,
			Number(sirali[1]),
			sirali[2] as "." | ")",
		);
	}

	if (ALINTI.test(onEk)) {
		return degistir(doc, caret, {
			type: "blockquote",
			id: blok.id,
			children: [{ type: "paragraph", children: kalanIcerik(blok.children, caret.offset) }],
		} as Block);
	}

	const kod = KOD.exec(onEk);
	if (kod !== null && metin.length === caret.offset) {
		// Kod bloğuna dönüşünce içerik boşalıyor: çit işaretinden sonrası
		// dil adı olur, ama henüz yazılmamıştır.
		return degistir(doc, caret, {
			type: "code",
			id: blok.id,
			lang: null,
			meta: null,
			value: "",
			syntax: { style: "fenced", fence: (kod[1] as string)[0] as "`" | "~", fenceLength: 3 },
		} as Block);
	}

	if (CIZGI.test(onEk) && metin.length === caret.offset) {
		const children = [...doc.children];
		const bosluk = { ...bosParagraf(), id: newId() };
		children.splice(
			caret.blockIndex,
			1,
			{ type: "thematicBreak", id: blok.id, syntax: { raw: onEk } } as Block,
			bosluk as Block,
		);
		return {
			doc: { ...doc, children: children as Root["children"] },
			caret: { blockIndex: caret.blockIndex + 1, path: [], offset: 0 },
		};
	}

	return null;
}

function bosParagraf(): Block {
	return { type: "paragraph", children: [] };
}

/** İşaretten sonraki içerik — kalıbın kendisi metinden siliniyor. */
function kalanIcerik(children: readonly Inline[], offset: number): Inline[] {
	return sliceInline(children, offset, listLength(children));
}

function degistir(doc: Root, caret: Caret, blok: Block): EditResult {
	return {
		doc: replaceAt(doc, [caret.blockIndex], blok),
		caret: { blockIndex: caret.blockIndex, path: blok.type === "blockquote" ? [0] : [], offset: 0 },
	};
}

function listeYap(
	doc: Root,
	caret: Caret,
	children: readonly Inline[],
	ordered: boolean,
	marker: "-" | "*" | "+" | null,
	start: number | null,
	delimiter: "." | ")" = ".",
): EditResult {
	const blok = doc.children[caret.blockIndex] as Block;
	// Kullanıcının yazdığı işaret **korunuyor**: `*` yazana `-` göstermek,
	// projenin "yazdığın gibi geri yaz" kuralının ihlali olurdu.
	const syntax = ordered ? { delimiter } : { marker: marker ?? "-" };
	return {
		doc: replaceAt(doc, [caret.blockIndex], {
			type: "list",
			id: blok.id,
			ordered,
			start: ordered ? start : null,
			spread: false,
			syntax,
			children: [
				{
					type: "listItem",
					checked: null,
					spread: false,
					children: [{ type: "paragraph", children: kalanIcerik(children, caret.offset) }],
				},
			],
		} as Block),
		caret: { blockIndex: caret.blockIndex, path: [0, 0], offset: 0 },
	};
}

// ---------------------------------------------------------------------------
// Satır içi kuralları
// ---------------------------------------------------------------------------

/**
 * Satır içi kalıplar.
 *
 * Sıra önemli: `**` `*`den önce denenmeli, yoksa kalın yazmak isteyen
 * kullanıcı ikinci yıldızda italik alır.
 *
 * Kalıpların hepsi imlecin **hemen solunda** bitmek zorunda (`$`), yani
 * kural yalnızca kapanış işareti yazıldığı anda çalışıyor.
 */
const SATIR_ICI: readonly { readonly desen: RegExp; readonly mark: Inline["type"] }[] = [
	// Her kalıpta 1. grup **önceki karakter** (ya da satır başı), 2. grup
	// gövde. İlk grup sayesinde işaretin uzunluğu tek bir çıkarmayla
	// hesaplanabiliyor ve `***a***` gibi girdilerde yanlış yerden kesilmiyor.
	{ desen: /(^|[^*])\*\*([^\s*][^*]*)\*\*$/, mark: "strong" },
	{ desen: /(^|[^_])__([^\s_][^_]*)__$/, mark: "strong" },
	{ desen: /(^|[^~])~~([^\s~][^~]*)~~$/, mark: "delete" },
	{ desen: /(^|[^*])\*([^\s*][^*]*)\*$/, mark: "emphasis" },
	{ desen: /(^|[^_])_([^\s_][^_]*)_$/, mark: "emphasis" },
	{ desen: /(^|[^`])`([^`]+)`$/, mark: "inlineCode" },
];

/**
 * Satır içi kuralları dener.
 *
 * Kalıp bulunursa işaretler siliniyor ve içerik biçimli düğüme sarılıyor.
 * Zaten biçimli bir bölgenin içindeyse (`inlineCode` gibi) hiçbir şey
 * yapılmıyor — `` `**a**` `` yazan kullanıcı kalın değil kod istiyor.
 */
export function applyInlineRule(doc: Root, caret: Caret): EditResult | null {
	const node = nodeAt(doc, caret) as { children?: readonly Inline[] } | undefined;
	const children = node?.children;
	if (children === undefined) return null;

	const metin = plainInline(children);
	const solda = metin.slice(0, caret.offset);

	for (const { desen, mark } of SATIR_ICI) {
		const eslesme = desen.exec(solda);
		if (eslesme === null) continue;

		const onceki = eslesme[1] ?? "";
		const govdeMetni = eslesme[2] as string;
		const bas = (eslesme.index ?? 0) + onceki.length;
		const son = caret.offset;
		// İşaretin tek yandaki uzunluğu: `**` için 2, `` ` `` için 1.
		const isaret = (son - bas - govdeMetni.length) / 2;
		if (!Number.isInteger(isaret) || isaret < 1) continue;

		// Zaten biçimli bir bölgenin içindeyse kural çalışmıyor:
		// `` `**a**` `` yazan kullanıcı kalın değil kod istiyor.
		const secili = sliceInline(children, bas, son);
		if (secili.some((n) => n.type === "inlineCode" || n.type === "link")) return null;

		const govde = sliceInline(children, bas + isaret, son - isaret);
		if (govde.length === 0) return null;

		const yeni: Inline =
			mark === "inlineCode"
				? { type: "inlineCode", value: plainInline(govde) }
				: ({ type: mark, children: govde } as Inline);

		const sonuc = spliceInline(children, bas, son, [yeni]);
		return {
			doc: replaceAt(doc, [caret.blockIndex, ...caret.path], { ...node, children: sonuc } as never),
			caret: { ...caret, offset: bas + listLength([yeni]) },
		};
	}
	return null;
}

function nodeAt(doc: Root, caret: Caret): unknown {
	let current: unknown = doc.children[caret.blockIndex];
	for (const index of caret.path) {
		const children = (current as { children?: readonly unknown[] } | undefined)?.children;
		if (children === undefined) return undefined;
		current = children[index];
	}
	return current;
}
