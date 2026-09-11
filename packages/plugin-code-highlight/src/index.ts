/**
 * `@kalem/plugin-code-highlight` — Kod bloğu vurgulama  (İş listesi: F4-02)
 *
 * Editördeki ve görüntüleyicideki `<pre><code class="language-…">`
 * bloklarını boyar. Belgeye dokunmuyor; vurgulama tamamen bir DOM
 * süslemesi.
 *
 *     import { codeHighlightPlugin } from "@kalem/plugin-code-highlight";
 *     import "@kalem/themes/plugin-code.css";
 *
 *     const editor = createEditor(el, { plugins: [codeHighlightPlugin()] });
 *
 * Salt okunur bir sayfada eklentiye gerek yok:
 *
 *     import { highlightAll } from "@kalem/plugin-code-highlight";
 *     await highlightAll(document.body);
 *
 * Gramerler `import()` ile geliyor: belgede yalnızca JSON varsa yalnızca
 * JSON grameri iniyor. Bu paketi kurmayan bir uygulama ise hiçbir şey
 * indirmiyor — kabul kriterinin istediği "ana bundle'a 0 byte".
 */
export type { PrismToken, ShikiToken } from "./adapters.js";
export { prismTokens, shikiTokens } from "./adapters.js";
export type { Highlighter, HighlighterOptions } from "./highlighter.js";
export { createHighlighter, highlightAll } from "./highlighter.js";
export type { LanguageLoader } from "./languages.js";
export { builtinLanguages, langOf, normalizeLang } from "./languages.js";
export type { CodeHighlightOptions, CodeHighlightPlugin } from "./plugin.js";
export { codeHighlightPlugin } from "./plugin.js";
export type { Grammar, Rule, Token, TokenType } from "./token.js";
export { tokenize } from "./token.js";
