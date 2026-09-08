/**
 * @kalem/core — Konum yolları  (İş listesi: F1-02)
 *
 * Bir düğümün ağaçtaki yeri, kökten ona inen **çocuk indisleri dizisidir**.
 * `[1, 0, 2]` = kökün 1. çocuğunun 0. çocuğunun 2. çocuğu. Boş dizi kökün
 * kendisidir.
 *
 * Neden nesne referansı değil de yol: düzenleme işlemleri (`edit.ts`) yeni
 * ağaçlar üretir, eski referanslar bayatlar. Yol ise ağaçtan bağımsızdır ve
 * düzenlemeden sonra da anlamlıdır — editörün geri al/ileri al yığını (F2-09)
 * bunun üzerine kurulacak.
 */
import type { Node, ParentNode } from "./ast.js";
import { isParent } from "./guards.js";

/** Kökten bir düğüme inen çocuk indisleri. Boş dizi kökü gösterir. */
export type Path = readonly number[];

/** Yolun gösterdiği düğüm. Yol geçersizse `undefined`. */
export function nodeAtPath(tree: Node, path: Path): Node | undefined {
	let current: Node = tree;
	for (const index of path) {
		if (!isParent(current)) return undefined;
		const child: Node | undefined = (current.children as readonly Node[])[index];
		if (child === undefined) return undefined;
		current = child;
	}
	return current;
}

/**
 * Bir düğümün ağaçtaki yolu. Bulunamazsa `undefined`.
 *
 * Karşılaştırma **referans kimliğiyle** (`===`) yapılır, derin eşitlikle
 * değil: aynı içeriğe sahip iki paragraf farklı düğümlerdir ve editörde
 * ayrı ayrı yaşarlar.
 */
export function pathToNode(tree: Node, target: Node): Path | undefined {
	if (tree === target) return [];

	const ara = (node: Node, path: number[]): Path | undefined => {
		if (!isParent(node)) return undefined;
		for (const [i, child] of (node.children as readonly Node[]).entries()) {
			if (child === target) return [...path, i];
			const found = ara(child, [...path, i]);
			if (found !== undefined) return found;
		}
		return undefined;
	};

	return ara(tree, []);
}

/** Yolun ebeveynine giden yol. Kök için `undefined`. */
export function parentPath(path: Path): Path | undefined {
	return path.length === 0 ? undefined : path.slice(0, -1);
}

/** Yolun gösterdiği düğümün ebeveyni. Kök ya da geçersiz yol için `undefined`. */
export function parentAtPath(tree: Node, path: Path): ParentNode | undefined {
	const ustYol = parentPath(path);
	if (ustYol === undefined) return undefined;
	const node = nodeAtPath(tree, ustYol);
	return node !== undefined && isParent(node) ? node : undefined;
}

/** İki yol aynı düğümü mü gösteriyor. */
export function pathEquals(a: Path, b: Path): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
