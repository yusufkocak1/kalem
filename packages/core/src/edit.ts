/**
 * @kalem-editor/core — Ağaç düzenleme  (İş listesi: F1-02)
 *
 * ## Neden değişmez (immutable)
 *
 * Bu dosyadaki işlemler girdiyi **değiştirmez**, yeni bir ağaç döndürür.
 * unist/remark ekosistemi yerinde değiştirir; biz üç sebeple ayrılıyoruz:
 *
 * 1. **Geri al / ileri al (F2-09).** Değişmez ağaçta bir anlık görüntü,
 *    kök referansını saklamaktan ibarettir. Yerinde değiştirme yapan bir
 *    modelde her adımda derin kopya almak gerekirdi.
 * 2. **Render karşılaştırması (F2).** Değişmemiş alt ağacın referansı aynı
 *    kalır (`===`), yani editör hangi bloğun gerçekten değiştiğini bir
 *    karşılaştırmayla anlar; derin gezinme gerekmez.
 * 3. **Sürpriz yok.** `remove(agac, dugum)` çağıran birinin elindeki ağacın
 *    sessizce değişmesi, hata ayıklaması zor bir davranıştır.
 *
 * **Maliyeti düşük:** yalnızca yol üzerindeki atalar kopyalanır (sığ kopya),
 * kardeş alt ağaçlar paylaşılır. 500 bloklu bir belgede bir bloğu değiştirmek
 * 500 değil, yol derinliği kadar (tipik 1–3) nesne kopyalar.
 *
 * ## Hata davranışı
 *
 * Geçersiz yol **istisna fırlatır**, sessizce hiçbir şey yapmaz değil.
 * Editörde yanlış yola yazmak bir programlama hatasıdır; sessiz geçilirse
 * belirtisi çok sonra, alakasız bir yerde ortaya çıkar.
 */
import type { Node } from "./ast.js";
import { isParent } from "./guards.js";
import type { Path } from "./path.js";
import { pathToNode } from "./path.js";

/** `clone` seçenekleri. */
export interface CloneOptions {
	/**
	 * `position` alanları korunsun mu (varsayılan: `true`).
	 *
	 * Alt ağacı **başka bir yere takmak** için kopyalıyorsan `false` ver:
	 * konum bilgisi kaynak metindeki eski yeri gösterir ve bayattır.
	 */
	position?: boolean;
	/**
	 * `id` alanları korunsun mu (varsayılan: `true`).
	 *
	 * Kopyayı aynı belgeye eklerken `false` ver — aynı kimlikten iki tane
	 * olması editörün blok eşlemesini bozar.
	 */
	id?: boolean;
}

/** `data` gibi serbest alanların derin kopyası. */
function cloneValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cloneValue);
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) out[key] = cloneValue(item);
		return out;
	}
	return value;
}

/**
 * Düğümün derin kopyası.
 *
 * `structuredClone` kullanılmıyor: o, `data` içinde bir fonksiyon olursa
 * istisna fırlatır ve `position` / `id` alanlarını seçmeli bırakmaya izin
 * vermez.
 */
export function clone<T extends Node>(node: T, options: CloneOptions = {}): T {
	const keepPosition = options.position ?? true;
	const keepId = options.id ?? true;

	const kopyala = (current: Node): Node => {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(current)) {
			if (key === "children") continue;
			if (key === "position" && !keepPosition) continue;
			if (key === "id" && !keepId) continue;
			out[key] = cloneValue(value);
		}
		if (isParent(current)) {
			out.children = (current.children as readonly Node[]).map(kopyala);
		}
		return out as unknown as Node;
	};

	return kopyala(node) as T;
}

/**
 * Yol üzerindeki ataları kopyalayarak ağacı yeniden kurar.
 *
 * `transform`, hedefin **ebeveynindeki** çocuk dizisini ve hedefin indisini
 * alır; yeni çocuk dizisini döndürür. Ekleme, değiştirme ve silme aynı
 * mekanizmayı paylaşır.
 */
function rebuild(
	node: Node,
	path: Path,
	depth: number,
	transform: (children: readonly Node[], index: number) => readonly Node[],
): Node {
	const index = path[depth];
	if (index === undefined) {
		throw new Error(`Invalid path: no index at depth ${depth} (path: [${path.join(", ")}])`);
	}
	if (!isParent(node)) {
		throw new Error(
			`Invalid path: "${node.type}" node has no children (path: [${path.join(", ")}], depth: ${depth})`,
		);
	}

	const children = node.children as readonly Node[];

	if (depth === path.length - 1) {
		return { ...node, children: transform(children, index) } as unknown as Node;
	}

	const child = children[index];
	if (child === undefined) {
		throw new Error(
			`Invalid path: [${path.join(", ")}] — no child at index ${index} at depth ${depth} (${children.length} children)`,
		);
	}

	const next = [...children];
	next[index] = rebuild(child, path, depth + 1, transform);
	return { ...node, children: next } as unknown as Node;
}

/** Boş yol, üç düzenleme işleminin hiçbirinde anlamlı değil. */
function assertNotRoot(path: Path, operation: string): void {
	if (path.length === 0) {
		throw new Error(
			`${operation}: an empty path points to the root, which has no parent. To replace the root, use the returned tree directly.`,
		);
	}
}

/**
 * Yolun gösterdiği konuma düğüm ekler; oradaki ve sonraki kardeşler sağa kayar.
 *
 * Dizinin sonuna eklemek için indis olarak `children.length` verilebilir.
 */
export function insertAt<T extends Node>(tree: T, path: Path, node: Node): T {
	assertNotRoot(path, "insertAt");
	return rebuild(tree, path, 0, (children, index) => {
		if (index < 0 || index > children.length) {
			throw new Error(`insertAt: position ${index} out of range (expected 0–${children.length})`);
		}
		return [...children.slice(0, index), node, ...children.slice(index)];
	}) as T;
}

/** Yolun gösterdiği düğümü yenisiyle değiştirir. */
export function replaceAt<T extends Node>(tree: T, path: Path, node: Node): T {
	assertNotRoot(path, "replaceAt");
	return rebuild(tree, path, 0, (children, index) => {
		if (children[index] === undefined) {
			throw new Error(`replaceAt: no child at index ${index} (${children.length} children)`);
		}
		const next = [...children];
		next[index] = node;
		return next;
	}) as T;
}

/** Yolun gösterdiği düğümü siler. */
export function removeAt<T extends Node>(tree: T, path: Path): T {
	assertNotRoot(path, "removeAt");
	return rebuild(tree, path, 0, (children, index) => {
		if (children[index] === undefined) {
			throw new Error(`removeAt: no child at index ${index} (${children.length} children)`);
		}
		return [...children.slice(0, index), ...children.slice(index + 1)];
	}) as T;
}

/**
 * Ağaçtaki bir düğümü referansıyla bulup değiştirir.
 *
 * Yol biliniyorsa `replaceAt` daha ucuzdur — bu sarmalayıcı önce ağacı
 * tarayarak yolu bulur.
 */
export function replace<T extends Node>(tree: T, target: Node, replacement: Node): T {
	const path = pathToNode(tree, target);
	if (path === undefined) throw new Error(`replace: "${target.type}" node not found in the tree`);
	return replaceAt(tree, path, replacement);
}

/** Ağaçtaki bir düğümü referansıyla bulup siler. */
export function remove<T extends Node>(tree: T, target: Node): T {
	const path = pathToNode(tree, target);
	if (path === undefined) throw new Error(`remove: "${target.type}" node not found in the tree`);
	return removeAt(tree, path);
}
