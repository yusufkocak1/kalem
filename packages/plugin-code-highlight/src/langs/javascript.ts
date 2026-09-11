/**
 * Dil paketi — JavaScript ailesi  (İş listesi: F4-02)
 *
 * `js`, `jsx`, `ts`, `tsx` aynı gramerle karşılanıyor. TypeScript'e özel
 * sözcükler (`interface`, `type`, `satisfies`, `readonly`) listeye dâhil:
 * ayrı bir gramer, iki dosyanın %95'ini kopyalamak olurdu ve düz
 * JavaScript'te `interface` görülmesi zaten bir hata değil, yalnızca
 * gereksiz bir renk.
 *
 * ## Düzenli ifade ayrılmıyor
 *
 * `/.../` kalıbı bilerek boyanmıyor. Bölme işlemiyle ayırt etmek
 * sözdizimini bilmeyi gerektiriyor (`a / b / c` iki bölme, `x = /a/` bir
 * ifade); tahmin eden bir kural, düz aritmetikte satırın yarısını dize
 * rengine boyar. Yanlış vurgulama, hiç vurgulamamaktan kötü.
 */
import type { Grammar } from "../token.js";

export const grammar: Grammar = {
	name: "javascript",
	rules: [
		{ type: "comment", pattern: /\/\*[\s\S]*?\*\/|\/\/.*/ },
		{
			type: "string",
			pattern: /`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'/,
		},
		{ type: "boolean", pattern: /\b(?:true|false|null|undefined|NaN|Infinity)\b/ },
		{
			type: "keyword",
			pattern:
				/\b(?:as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|keyof|let|new|of|private|protected|public|readonly|return|satisfies|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/,
		},
		{
			type: "number",
			pattern: /\b0[xXbBoO][\da-fA-F_]+n?\b|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?n?\b/,
		},
		{ type: "function", pattern: /\b[A-Za-z_$][\w$]*(?=\s*\()/ },
		// PascalCase = tür ya da sınıf; JavaScript'in tek yerleşik kuralı bu.
		{ type: "type", pattern: /\b[A-Z][\w$]*\b/ },
		{ type: "operator", pattern: /=>|\.{3}|[+\-*/%=<>!&|^~?]+/ },
		{ type: "punctuation", pattern: /[{}[\]();,.:]/ },
	],
};
