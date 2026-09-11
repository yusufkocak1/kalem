/**
 * Dil paketi — Python  (İş listesi: F4-02)
 *
 * Üç tırnaklı dize kuralı, tek tırnaklıdan **önce** geliyor: sıra ters
 * olsaydı `"""` bir boş dize (`""`) artı bir tırnak olarak okunurdu ve
 * belge sonuna kadar her şey kayardı.
 */
import type { Grammar } from "../token.js";

export const grammar: Grammar = {
	name: "python",
	rules: [
		{ type: "comment", pattern: /#.*/ },
		{
			type: "string",
			pattern:
				/[rbfuRBFU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*')/,
		},
		{ type: "boolean", pattern: /\b(?:True|False|None)\b/ },
		{
			type: "keyword",
			pattern:
				/\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/,
		},
		{ type: "attr", pattern: /@[\w.]+/ },
		{ type: "number", pattern: /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?j?\b/ },
		{ type: "function", pattern: /\b[A-Za-z_]\w*(?=\s*\()/ },
		{ type: "type", pattern: /\b[A-Z]\w*\b/ },
		{ type: "operator", pattern: /[+\-*/%=<>!&|^~]+/ },
		{ type: "punctuation", pattern: /[{}[\]();,.:]/ },
	],
};
