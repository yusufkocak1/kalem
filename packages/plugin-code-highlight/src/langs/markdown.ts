/**
 * Dil paketi — Markdown  (İş listesi: F4-02)
 *
 * Bir Markdown editöründe en olası kod bloğu Markdown'ın kendisi: belge
 * yazan herkes er geç sözdizimini göstermek istiyor.
 *
 * Kod çiti kuralı **ilk** sırada: içindeki `**` yıldızları biçim değil
 * içerik ve çit önce yakalanmazsa kalın metin gibi boyanırdı.
 */
import type { Grammar } from "../token.js";

export const grammar: Grammar = {
	name: "markdown",
	rules: [
		{ type: "string", pattern: /```[\s\S]*?(?:```|$)|`[^`\n]+`/ },
		{ type: "comment", pattern: /<!--[\s\S]*?-->/ },
		{ type: "keyword", pattern: /^#{1,6} .*/m },
		{ type: "comment", pattern: /^ {0,3}> ?.*/m },
		{ type: "attr", pattern: /!?\[[^\]\n]*\]\([^)\n]*\)/ },
		{ type: "type", pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
		{ type: "variable", pattern: /\*[^*\n]+\*|_[^_\n]+_/ },
		{
			type: "punctuation",
			pattern: /^ {0,3}(?:[-*+]|\d{1,9}[.)]) |^ {0,3}(?:-{3,}|\*{3,}|_{3,})$/m,
		},
	],
};
