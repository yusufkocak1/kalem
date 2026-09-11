/**
 * Dil paketi — JSON  (İş listesi: F4-02)
 *
 * Anahtarlar dizelerden ayrı boyanıyor: `"ad": "değer"` satırında ikisi
 * aynı renk olursa JSON okunmuyor. Ayrımı yapan tek şey ileri bakış
 * (`(?=\s*:)`) — geri bakış kullanılmıyor (`token.ts`).
 *
 * Yorumlar da tanınıyor (`jsonc`): `tsconfig.json` ve `.vscode`
 * dosyalarında standart dışı ama yaygın.
 */
import type { Grammar } from "../token.js";

export const grammar: Grammar = {
	name: "json",
	rules: [
		{ type: "comment", pattern: /\/\*[\s\S]*?\*\/|\/\/.*/ },
		{ type: "property", pattern: /"(?:\\[\s\S]|[^"\\])*"(?=\s*:)/ },
		{ type: "string", pattern: /"(?:\\[\s\S]|[^"\\])*"/ },
		{ type: "boolean", pattern: /\b(?:true|false|null)\b/ },
		{ type: "number", pattern: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
		{ type: "punctuation", pattern: /[{}[\],:]/ },
	],
};
