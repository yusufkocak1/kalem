/**
 * @kalem-editor/core — Komut çekirdeği  (İş listesi: F1-11)
 *
 * Editörün AST üzerinde yapacağı işlemler — **DOM'suz ve saf**. Faz 2'deki
 * editör motoru bunları çağıracak; saf oldukları için ondan bağımsız test
 * edilebiliyorlar.
 *
 * Hepsi `edit.ts` gibi **değişmez**: girdiyi değiştirmez, yapısal paylaşımla
 * yeni ağaç döndürür. Geri al/ileri al yığını (F2-09) bunun üzerine kurulacak.
 *
 * ## Neden `Path` ile çalışıyorlar
 *
 * Editör bir seçim tutar ve seçim yollarla ifade edilir. Komutlar da aynı
 * dili konuşursa aradaki dönüşüm katmanı gerekmez.
 *
 * @module @kalem-editor/core/commands
 */
import type { Block, Heading, Inline, List, ListItem, Node, Paragraph, Root } from "./ast.js";
import { insertAt, removeAt, replaceAt } from "./edit.js";
import { isParent } from "./guards.js";
import { nodeAtPath, type Path, parentAtPath } from "./path.js";

/** Satır içi biçimlendirme türleri — kalın, italik, üstü çizili, kod. */
export type MarkType = "strong" | "emphasis" | "delete" | "inlineCode";

/** Bir bloğun dönüştürülebileceği türler. */
export type BlockType =
	| { type: "paragraph" }
	| { type: "heading"; depth: Heading["depth"] }
	| { type: "code"; lang?: string | null }
	| { type: "blockquote" };

// ---------------------------------------------------------------------------
// Satır içi biçimlendirme
// ---------------------------------------------------------------------------

/**
 * Satır içi düğüm listesine bir biçim uygular ya da kaldırır.
 *
 * Zaten **tamamen** o biçimdeyse kaldırır, değilse uygular. Word'ün kalın
 * düğmesi de böyle davranır: seçimin tamamı kalınsa tıklamak kaldırır.
 */
export function toggleMark(nodes: readonly Inline[], mark: MarkType): Inline[] {
	if (nodes.length === 0) return [];

	if (hasMark(nodes, mark)) return nodes.flatMap((n) => unwrapMark(n, mark));

	// `inlineCode` çocuk taşımaz; içerik düz metne indirgenir.
	if (mark === "inlineCode") {
		return [{ type: "inlineCode", value: plainText(nodes) }];
	}
	return [{ type: mark, children: [...nodes] } as Inline];
}

/** Düğümün (ya da alt ağacının) o biçimi taşıyıp taşımadığı. */
export function hasMark(nodes: readonly Inline[], mark: MarkType): boolean {
	return (
		nodes.length > 0 &&
		nodes.every((n) => n.type === mark || (n.type === "color" && hasMark(n.children, mark)))
	);
}

/** Color is transparent to marks: `color[strong[x]]` counts as bold and can be un-bolded. */
function unwrapMark(node: Inline, mark: MarkType): Inline[] {
	if (node.type === "color") {
		return [{ ...node, children: node.children.flatMap((child) => unwrapMark(child, mark)) }];
	}
	return node.type === mark && "children" in node ? [...node.children] : [node];
}

/** Alt ağaçtaki düz metin. */
function plainText(nodes: readonly Inline[], lineBreak = ""): string {
	let out = "";
	for (const node of nodes) {
		if (node.type === "text" || node.type === "inlineCode" || node.type === "html")
			out += node.value;
		else if ("children" in node) out += plainText(node.children, lineBreak);
		else if (node.type === "image") out += node.alt ?? "";
		else if (node.type === "break") out += lineBreak;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Blok dönüşümleri
// ---------------------------------------------------------------------------

/**
 * Yoldaki bloğu başka bir blok türüne dönüştürür.
 *
 * Metin **korunur**: paragraf başlığa dönerken içerik kaybolmaz, kod bloğuna
 * dönerken satır içi biçimler düz metne iner (kod biçim taşıyamaz).
 */
export function setBlockType<T extends Node>(tree: T, path: Path, target: BlockType): T {
	const node = nodeAtPath(tree, path);
	if (node === undefined) throw new Error(`setBlockType: no node at path [${path.join(", ")}]`);

	return replaceAt(tree, path, convertBlock(node as Block, target));
}

function convertBlock(node: Block, target: BlockType): Block {
	const inline = inlineContentOf(node);

	switch (target.type) {
		case "paragraph":
			return { type: "paragraph", children: inline };
		case "heading":
			return { type: "heading", depth: target.depth, children: inline };
		case "code":
			return { type: "code", lang: target.lang ?? null, meta: null, value: codeValueOf(node) };
		case "blockquote":
			// Alıntı bir kapsayıcı: mevcut blok içine alınır, düzleştirilmez.
			return { type: "blockquote", children: [node] };
	}
}

/** Bloğun satır içi içeriği; taşımıyorsa metin değerinden üretilir. */
function inlineContentOf(node: Block): Inline[] {
	if (node.type === "paragraph" || node.type === "heading") return [...node.children];
	if (node.type === "code") {
		const value = node.value.replace(/\n$/, "");
		return value === "" ? [] : [{ type: "text", value }];
	}
	if (node.type === "html") return [{ type: "text", value: node.value }];
	return [];
}

/** Bloğun kod bloğu olarak değeri. */
function codeValueOf(node: Block): string {
	if (node.type === "code") return node.value;
	// A hard break is a line of code; without this the lines ran together.
	const text = plainText(inlineContentOf(node), "\n");
	return text === "" ? "" : `${text}\n`;
}

// ---------------------------------------------------------------------------
// Kapsayıcıya alma ve çıkarma
// ---------------------------------------------------------------------------

/** Yoldaki bloğu bir alıntı ya da liste içine alır. */
export function wrapIn<T extends Node>(tree: T, path: Path, container: "blockquote" | "list"): T {
	const node = nodeAtPath(tree, path);
	if (node === undefined) throw new Error(`wrapIn: no node at path [${path.join(", ")}]`);
	const block = node as Block;

	const wrapped: Block =
		container === "blockquote"
			? { type: "blockquote", children: [block] }
			: {
					type: "list",
					ordered: false,
					start: null,
					spread: false,
					children: [{ type: "listItem", checked: null, spread: false, children: [block] }],
				};

	return replaceAt(tree, path, wrapped);
}

/**
 * Düğümü kapsayıcısından **bir seviye** çıkarır.
 *
 * Kapsayıcıda tek çocuk kalmışsa kapsayıcı da kaybolur; birden çok çocuk
 * varsa yalnızca ilgili çocuk dışarı alınır ve kapsayıcı kalanla sürer.
 * (Şimdilik kapsayıcının **ilk** ve **son** çocuğu çıkarılabilir; ortadaki
 * bir çocuğu çıkarmak kapsayıcıyı ikiye bölmeyi gerektirir — bu, editör
 * ihtiyacı netleştiğinde F2'de eklenecek.)
 */
export function lift<T extends Node>(tree: T, path: Path): T {
	if (path.length < 2) throw new Error("lift: a root-level node cannot be lifted");

	const parent = parentAtPath(tree, path);
	if (parent === undefined) throw new Error(`lift: path [${path.join(", ")}] has no parent`);

	const node = nodeAtPath(tree, path);
	if (node === undefined) throw new Error(`lift: no node at path [${path.join(", ")}]`);

	const index = path[path.length - 1] as number;
	const parentPath = path.slice(0, -1);
	const siblings = parent.children as readonly Node[];

	if (siblings.length === 1) {
		// Kapsayıcı boşalıyor: yerini çocuğu alsın.
		return replaceAt(tree, parentPath, node);
	}
	if (index !== 0 && index !== siblings.length - 1) {
		throw new Error(
			"lift: only the first or last child of a container can be lifted (lifting a middle child would require splitting the container)",
		);
	}

	// Önce kapsayıcıdan çıkar, sonra kapsayıcının yanına koy.
	const withoutChild = removeAt(tree, path);
	const target =
		index === 0
			? parentPath
			: [...parentPath.slice(0, -1), (parentPath[parentPath.length - 1] as number) + 1];
	return insertAt(withoutChild, target, node);
}

// ---------------------------------------------------------------------------
// Bölme ve birleştirme
// ---------------------------------------------------------------------------

/**
 * Bloğu satır içi ofsette ikiye böler — Enter tuşunun AST karşılığı.
 *
 * `offset`, bloğun **çocuk dizisindeki** bölme noktasıdır. Metin ortasında
 * bölmek için önce metin düğümü ikiye ayrılmalı; bunu editör yapar çünkü
 * karakter ofsetini yalnızca o bilir.
 */
export function splitBlock<T extends Node>(tree: T, path: Path, offset: number): T {
	const node = nodeAtPath(tree, path);
	if (node === undefined) throw new Error(`splitBlock: no node at path [${path.join(", ")}]`);
	if (!isParent(node))
		throw new Error(`splitBlock: "${node.type}" cannot be split, it has no children`);

	const children = node.children as readonly Node[];
	const clamped = Math.max(0, Math.min(offset, children.length));

	const first = { ...node, children: children.slice(0, clamped) } as unknown as Block;
	const second = { ...node, children: children.slice(clamped) } as unknown as Block;
	// Konum bilgisi bölünmüş düğümler için bayat; taşınmaz.
	delete (first as { position?: unknown }).position;
	delete (second as { position?: unknown }).position;

	const index = path[path.length - 1] as number;
	const afterReplace = replaceAt(tree, path, first);
	return insertAt(afterReplace, [...path.slice(0, -1), index + 1], second);
}

/**
 * İki komşu bloğu birleştirir — Backspace'in blok başındaki karşılığı.
 *
 * `path`, **ikinci** bloğu gösterir; içeriği bir öncekinin sonuna eklenir.
 */
export function joinBlocks<T extends Node>(tree: T, path: Path): T {
	const index = path[path.length - 1] as number;
	if (index === 0) throw new Error("joinBlocks: the first block has no previous block to join");

	const previousPath = [...path.slice(0, -1), index - 1];
	const previous = nodeAtPath(tree, previousPath);
	const current = nodeAtPath(tree, path);

	if (previous === undefined || current === undefined) {
		throw new Error(`joinBlocks: blocks at path [${path.join(", ")}] not found`);
	}
	if (!isParent(previous) || !isParent(current)) {
		throw new Error("joinBlocks: only blocks with children can be joined");
	}

	const merged = {
		...previous,
		children: [...(previous.children as readonly Node[]), ...(current.children as readonly Node[])],
	} as unknown as Block;
	delete (merged as { position?: unknown }).position;

	return replaceAt(removeAt(tree, path), previousPath, merged);
}

// ---------------------------------------------------------------------------
// Ekleme
// ---------------------------------------------------------------------------

/** Yolun gösterdiği konuma düğüm ekler. `insertAt` için okunur bir ad. */
export function insertNode<T extends Node>(tree: T, path: Path, node: Node): T {
	return insertAt(tree, path, node);
}

/** Boş paragraf — editörün en sık ürettiği düğüm. */
export function emptyParagraph(): Paragraph {
	return { type: "paragraph", children: [] };
}

/** Tek maddelik boş liste. */
export function emptyList(ordered = false): List {
	const item: ListItem = {
		type: "listItem",
		checked: null,
		spread: false,
		children: [emptyParagraph()],
	};
	return { type: "list", ordered, start: ordered ? 1 : null, spread: false, children: [item] };
}

/** Boş belge. */
export function emptyDocument(): Root {
	return { type: "root", children: [emptyParagraph()] };
}
