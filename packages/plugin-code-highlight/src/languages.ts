/**
 * @kalem-editor/plugin-code-highlight — Dil kayıt defteri  (İş listesi: F4-02)
 *
 * ## Neden `import()`
 *
 * Kabul kriteri: "vurgulama kullanılmadığında ana bundle'a 0 byte
 * ekliyor". Bunun ilk yarısını paket ayrımı çözüyor — eklentiyi
 * kurmayan hiçbir şey indirmiyor. İkinci yarısı burada: eklentiyi kuran
 * kullanıcı da **yalnızca belgesinde geçen dilleri** indiriyor. Sekiz
 * gramer statik olarak içeri alınsaydı, tek bir JSON bloğu için Python
 * ve SQL de inerdi.
 *
 * Yükleyici haritası dışarıdan verilebiliyor (`languages` seçeneği); yani
 * kendi dilini eklemek için bu paketi değiştirmek gerekmiyor:
 *
 *     codeHighlightPlugin({
 *       languages: { ...builtinLanguages, rust: () => import("./rust.js") },
 *     })
 *
 * ## Takma adlar
 *
 * `ts`, `tsx`, `typescript` aynı yükleyiciye bakıyor. Aynı fonksiyon
 * nesnesi paylaşıldığı için üçü tek bir `import()` çağrısına düşüyor ve
 * gramer bir kez yükleniyor.
 */
import type { Grammar } from "./token.js";

/** Bir dilin gramerini getiren fonksiyon. */
export type LanguageLoader = () => Promise<Grammar>;

const javascript: LanguageLoader = () => import("./langs/javascript.js").then((m) => m.grammar);
const json: LanguageLoader = () => import("./langs/json.js").then((m) => m.grammar);
const css: LanguageLoader = () => import("./langs/css.js").then((m) => m.grammar);
const html: LanguageLoader = () => import("./langs/html.js").then((m) => m.grammar);
const python: LanguageLoader = () => import("./langs/python.js").then((m) => m.grammar);
const shell: LanguageLoader = () => import("./langs/shell.js").then((m) => m.grammar);
const sql: LanguageLoader = () => import("./langs/sql.js").then((m) => m.grammar);
const markdown: LanguageLoader = () => import("./langs/markdown.js").then((m) => m.grammar);

/**
 * Kutudan çıkan diller.
 *
 * Liste kasten kısa: bir Markdown editöründe kod blokları çoğunlukla
 * yapılandırma, kabuk komutu ve örnek kod oluyor. Eksik olan dil, kendi
 * yükleyicisiyle ekleniyor (yukarıya bakın) — uzun bir liste taşımak,
 * bakımını da üstlenmek demek.
 */
export const builtinLanguages: Readonly<Record<string, LanguageLoader>> = {
	javascript,
	js: javascript,
	jsx: javascript,
	typescript: javascript,
	ts: javascript,
	tsx: javascript,
	mjs: javascript,
	cjs: javascript,
	json,
	jsonc: json,
	css,
	html,
	xml: html,
	svg: html,
	vue: html,
	python,
	py: python,
	shell,
	sh: shell,
	bash: shell,
	zsh: shell,
	sql,
	markdown,
	md: markdown,
};

/**
 * Dil adını kayıt defteri anahtarına çevirir.
 *
 * Ad kullanıcının yazdığı çit bilgisinden geliyor (```` ```JS ````), yani
 * büyük harfli ve boşluklu olabiliyor.
 */
export function normalizeLang(lang: string): string {
	// kalem-locale-ok: dil adları ASCII; Türkçe kuralı "TITLE"ı bozardı
	return lang.trim().toLowerCase();
}

/** Bir elemanın `language-…` sınıfındaki dil adı. */
export function langOf(element: Element): string | null {
	const eslesme = /(?:^|\s)language-([\w+#.-]+)/.exec(element.className);
	return eslesme === null ? null : normalizeLang(eslesme[1] as string);
}
