/**
 * @kalem-editor/core — Ağaç gezinme  (İş listesi: F1-02)
 *
 * Gezinme, künye kaydına (`spec.ts`) dayanır: hangi düğümün çocuğu olduğu
 * `isParent` ile sorulur, her düğüm tipi için ayrı `switch` yazılmaz. Yeni
 * bir düğüm tipi eklendiğinde bu dosyada değişiklik gerekmez.
 *
 * Bütün gezinme **derinlik öncelikli** ve **belge sırasındadır** — ziyaret
 * sırası, düğümlerin Markdown metnindeki sırasıyla aynıdır.
 */
import type { Node, NodeOf, NodeType, ParentNode } from "./ast.js";
import { isParent } from "./guards.js";
import type { Path } from "./path.js";

/** Gezinmeye devam et (varsayılan; `undefined` döndürmekle aynı). */
export const CONTINUE = "continue";
/** Bu düğümün çocuklarına inme, kardeşten devam et. */
export const SKIP = "skip";
/** Gezinmeyi tamamen bitir. */
export const EXIT = "exit";

/** Ziyaretçinin dönebileceği değerler. */
export type VisitorResult = typeof CONTINUE | typeof SKIP | typeof EXIT | undefined;

/** Ziyaret edilen düğümün ağaçtaki bağlamı. */
export interface VisitContext {
	/** Kökten bu düğüme inen yol. Kök için boş dizi. */
	readonly path: Path;
	/** Ebeveyn düğüm. Kök için `undefined`. */
	readonly parent: ParentNode | undefined;
	/** Düğümün ebeveynindeki indisi. Kök için `undefined`. */
	readonly index: number | undefined;
}

export type Visitor<T extends Node = Node> = (node: T, context: VisitContext) => VisitorResult;

/**
 * Ağaçtaki her düğümü belge sırasıyla ziyaret eder.
 *
 * Ziyaretçi `SKIP` dönerse o düğümün çocuklarına inilmez; `EXIT` dönerse
 * gezinme biter.
 *
 * Yol dizileri **her düğüm için yeniden üretilir**, yani ziyaretçi `path`'i
 * saklayabilir. Bu, düğüm başına küçük bir tahsis demek — Markdown belgeleri
 * için önemsiz, ve saklanabilir olması hata kaynağı bir mikro-optimizasyondan
 * daha değerli.
 */
export function walk(tree: Node, visitor: Visitor): void {
	const gez = (
		node: Node,
		path: Path,
		parent: ParentNode | undefined,
		index: number | undefined,
	): VisitorResult => {
		const result = visitor(node, { path, parent, index });
		if (result === EXIT) return EXIT;
		if (result === SKIP) return undefined;
		if (!isParent(node)) return undefined;

		// `.entries()` ile geziliyor: indisle erişim `noUncheckedIndexedAccess`
		// yüzünden gereksiz bir `undefined` dalı doğururdu.
		for (const [i, child] of (node.children as readonly Node[]).entries()) {
			if (gez(child, [...path, i], node, i) === EXIT) return EXIT;
		}
		return undefined;
	};

	gez(tree, [], undefined, undefined);
}

/**
 * Yalnızca verilen tipteki düğümleri ziyaret eder.
 *
 * ```ts
 * visit(belge, "heading", (h) => { console.log(h.depth); });
 * visit(belge, ["link", "image"], (n) => { ... });
 * ```
 *
 * Eşleşmeyen düğümlerin **çocuklarına inilmeye devam edilir** — bir başlık
 * aramak için bütün ağacı taramak gerekir.
 */
export function visit<T extends NodeType>(
	tree: Node,
	type: T | readonly T[],
	visitor: Visitor<NodeOf<T>>,
): void {
	const types: ReadonlySet<string> = new Set(typeof type === "string" ? [type] : type);
	walk(tree, (node, context) =>
		types.has(node.type) ? visitor(node as NodeOf<T>, context) : undefined,
	);
}

/**
 * Koşulu sağlayan **ilk** düğümü belge sırasıyla bulur.
 *
 * Konumu da gerekiyorsa `pathToNode` ile alınabilir; ya da `walk` içinde
 * bağlamı doğrudan okumak daha ucuzdur.
 */
export function find(
	tree: Node,
	predicate: (node: Node, context: VisitContext) => boolean,
): Node | undefined {
	let found: Node | undefined;
	walk(tree, (node, context) => {
		if (predicate(node, context)) {
			found = node;
			return EXIT;
		}
		return undefined;
	});
	return found;
}
