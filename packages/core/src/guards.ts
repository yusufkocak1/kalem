/**
 * @kalem-editor/core — Tip koruyucular  (İş listesi: F1-01)
 *
 * Hepsi künye kaydından (`spec.ts`) türer. Yeni bir düğüm tipi eklendiğinde
 * burada değişiklik gerekmez — künyesini yazmak yeterlidir.
 *
 * Koruyucular **güvenilmeyen veriye karşı da dayanıklıdır**: `null`, `1`,
 * `"metin"` gibi girdilerde patlamaz, `false` döner. JSON'dan gelen bir ağacı
 * ya da bir eklentinin dönüşünü doğrularken bu önemlidir.
 */
import type {
	Block,
	Frontmatter,
	Inline,
	LiteralNode,
	Node,
	NodeSpec,
	NodeType,
	ParentNode,
	Root,
	Structural,
} from "./ast.js";
import { isParentContent, specOf } from "./spec.js";

/**
 * Değerin künyesini tek geçişte bulur.
 *
 * Bütün koruyucular bunun üzerine kurulu: her biri ayrı ayrı "önce düğüm mü,
 * sonra künyesi ne" diye sorsaydı ikinci arama hiçbir zaman `undefined`
 * dönmeyen ölü bir dal olurdu.
 */
function specFor(value: unknown): NodeSpec | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const type: unknown = (value as { type?: unknown }).type;
	return typeof type === "string" ? specOf(type) : undefined;
}

/** Değer, künyesi bilinen bir düğüm mü. */
export function isNode(value: unknown): value is Node {
	return specFor(value) !== undefined;
}

/** Değer, verilen tipte bir düğüm mü: `isNodeOf(n, "heading")`. */
export function isNodeOf<T extends NodeType>(
	value: unknown,
	type: T,
): value is Extract<Node, { type: T }> {
	return specFor(value)?.type === type;
}

/** Belgenin kökü mü. */
export function isRoot(value: unknown): value is Root {
	return specFor(value)?.type === "root";
}

/**
 * Blok düzeyi içerik mi — bir bloğun beklendiği yere konabilir mi.
 *
 * `html` hem blok hem satır içi olabildiği için `isBlock` ve `isInline` ikisi
 * de onun için `true` döner. Bu bir tutarsızlık değil, mdast'ın gerçeği:
 * `<br>` bir cümlenin ortasında da, tek başına da yazılabilir.
 */
export function isBlock(value: unknown): value is Block {
	return specFor(value)?.groups.includes("block") === true;
}

/** Satır içi içerik mi. */
export function isInline(value: unknown): value is Inline {
	return specFor(value)?.groups.includes("inline") === true;
}

/**
 * Yalnızca belirli bir ebeveynin içinde geçerli olan yapısal düğüm mü
 * (`listItem`, `tableRow`, `tableCell`).
 */
export function isStructural(value: unknown): value is Structural {
	return specFor(value)?.groups.includes("structural") === true;
}

/** Frontmatter düğümü mü (`yaml`, `toml`). */
export function isFrontmatter(value: unknown): value is Frontmatter {
	return specFor(value)?.groups.includes("frontmatter") === true;
}

/**
 * Çocuk taşıyan bir düğüm mü.
 *
 * Künyeye **ve** düğümün gerçekten bir `children` dizisi taşıdığına birlikte
 * bakar: künyede çocuklu görünen ama alanı eksik gelen bozuk bir düğüm
 * (JSON'dan, eski bir sürümden) gezinme sırasında patlamamalı.
 */
export function isParent(value: unknown): value is ParentNode {
	const spec = specFor(value);
	if (spec === undefined || !isParentContent(spec.content)) return false;
	return Array.isArray((value as { children?: unknown }).children);
}

/** Metin değeri taşıyan yaprak düğüm mü (`text`, `code`, `html`, `yaml`, ...). */
export function isLiteral(value: unknown): value is LiteralNode {
	if (specFor(value)?.content !== "value") return false;
	return typeof (value as { value?: unknown }).value === "string";
}
