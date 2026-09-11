/**
 * Dil paketi — CSS  (İş listesi: F4-02)
 *
 * ## Bilinen yanlış boyama
 *
 * Özellik adını bulan kural `[-\w]+(?=\s*:)`, yani "iki nokta üst üste
 * gelmeden önceki sözcük". Bu, `a:hover` seçicisindeki `a`yı da özellik
 * sayıyor. Doğrusu için bloğun içinde mi dışında mı olunduğunu bilmek,
 * yani durum tutan bir ayrıştırıcı gerekir; belirteçleyici bunu kasten
 * yapmıyor (`token.ts`). Renk kayması bir seçicide kalıyor, okunurluğu
 * bozmuyor — durum makinesinin bedeli buna değmiyor.
 */
import type { Grammar } from "../token.js";

export const grammar: Grammar = {
	name: "css",
	rules: [
		{ type: "comment", pattern: /\/\*[\s\S]*?\*\// },
		{ type: "string", pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/ },
		{ type: "keyword", pattern: /@[\w-]+/ },
		// Değişkenler ayrı: bir tema dosyasında satırların çoğu bunlar.
		{ type: "variable", pattern: /--[\w-]+/ },
		{ type: "number", pattern: /#[\da-fA-F]{3,8}\b/ },
		{ type: "property", pattern: /[-\w]+(?=\s*:)/ },
		{ type: "number", pattern: /-?\b\d+(?:\.\d+)?(?:%|[a-z]{1,4})?/ },
		{ type: "tag", pattern: /[.#][-\w]+|::?[-\w]+|\b[a-z][\w-]*(?=[\s.#,:[{])/ },
		{ type: "punctuation", pattern: /[{}();,]/ },
	],
};
