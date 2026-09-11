/**
 * Dil paketi — Kabuk (bash / sh / zsh)  (İş listesi: F4-02)
 *
 * Değişkenler ayrı bir renk alıyor; bir kabuk betiğinde okumayı en çok
 * kolaylaştıran ayrım o. Komut adları boyanmıyor: hangi sözcüğün komut
 * olduğunu bilmek için satırın neresinde olunduğunu takip etmek gerekir
 * ve sabit bir komut listesi (echo, git, npm…) keyfî olurdu — listede
 * olmayan her araç ikinci sınıf görünürdü.
 */
import type { Grammar } from "../token.js";

export const grammar: Grammar = {
	name: "shell",
	rules: [
		{ type: "comment", pattern: /#.*/ },
		// Tek tırnak kabukta kaçış tanımıyor; iki tırnak tanıyor.
		{ type: "string", pattern: /"(?:\\[\s\S]|[^"\\])*"|'[^']*'/ },
		{ type: "variable", pattern: /\$(?:\{[^}]*\}|[\w@#?*!$-]+)/ },
		{
			type: "keyword",
			pattern:
				/\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|local|export|readonly|source|alias|unset|shift|trap|exit)\b/,
		},
		// Seçenek: baştaki boşluk belirtece dâhil, görünür bir etkisi yok.
		{ type: "attr", pattern: /(?:^|\s)--?[A-Za-z][\w-]*/ },
		{ type: "number", pattern: /\b\d+\b/ },
		{ type: "operator", pattern: /[|&;<>]+|\\$/ },
		{ type: "punctuation", pattern: /[(){}[\]]/ },
	],
};
