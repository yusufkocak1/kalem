/**
 * Dil paketi — SQL  (İş listesi: F4-02)
 *
 * Anahtar sözcükler büyük/küçük harf duyarsız (`i` bayrağı). Bu, projenin
 * locale kuralıyla çelişmiyor: düzenli ifadenin `i` bayrağı Unicode
 * katlaması yapıyor, `toLowerCase()` gibi çalışma zamanı locale'ine
 * bakmıyor — Türkçe bir tarayıcıda `IN` yine `in` ile eşleşiyor.
 */
import type { Grammar } from "../token.js";

export const grammar: Grammar = {
	name: "sql",
	rules: [
		{ type: "comment", pattern: /--.*|\/\*[\s\S]*?\*\// },
		// SQL'de dize içindeki tırnak iki tırnakla kaçırılıyor: 'it''s'.
		{ type: "string", pattern: /'(?:''|[^'])*'/ },
		{ type: "boolean", pattern: /\b(?:true|false|null)\b/i },
		{
			type: "keyword",
			pattern:
				/\b(?:add|all|alter|and|as|asc|between|by|case|cascade|check|column|constraint|create|cross|default|delete|desc|distinct|drop|else|end|exists|foreign|from|full|group|having|in|index|inner|insert|into|is|join|key|left|like|limit|not|offset|on|or|order|outer|primary|references|returning|right|select|set|table|then|union|unique|update|using|values|view|when|where|with)\b/i,
		},
		{ type: "function", pattern: /\b[A-Za-z_]\w*(?=\s*\()/ },
		{ type: "number", pattern: /\b\d+(?:\.\d+)?\b/ },
		{ type: "operator", pattern: /[+\-*/%=<>!|]+/ },
		{ type: "punctuation", pattern: /[(),;.]/ },
	],
};
