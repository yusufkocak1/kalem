/**
 * @kalem-editor/plugin-code-highlight — Dış vurgulayıcı adaptörleri  (F4-02)
 *
 * İçerideki belirteçleyici (`token.ts`) küçük olmayı seçiyor ve bunun bir
 * tavanı var: iç içe gramerler, sözdizimine bağlı ayrımlar, yüzlerce dil.
 * Bu tavana çarpan kullanıcı Prism ya da Shiki takabilmeli — ama **bizim
 * bağımlılığımız olmadan**, iş listesinin dediği gibi.
 *
 * Buradaki iki fonksiyon o araçların çıktısını `Token[]`e çeviriyor.
 * Hiçbiri `prismjs` ya da `shiki` import etmiyor: parametreler yapısal
 * olarak yazılmış, yani paket kurulu olmadan da derleniyor ve
 * kurulduğunda çıktısı doğrudan geçiyor.
 *
 *     import Prism from "prismjs";
 *     codeHighlightPlugin({
 *       highlight: (kod, dil) =>
 *         prismTokens(Prism.tokenize(kod, Prism.languages[dil])),
 *     });
 *
 * ## Neden HTML almıyoruz
 *
 * İki aracın da en kolay arayüzü HTML dizesi döndürüyor
 * (`Prism.highlight`, `codeToHtml`). Onu ekrana koymanın tek yolu
 * `innerHTML`; kod bloğunun içeriği kullanıcının yazdığı metin olduğu
 * için o kapı doğrudan bir XSS yüzeyi. Belirteç arayüzleri
 * (`Prism.tokenize`, `codeToTokens`) ikisinde de halka açık.
 */
import type { Token, TokenType } from "./token.js";

/** Prism'in belirteç türü → bizimki. Bilinmeyen tür düz metin sayılıyor. */
const PRISM: Readonly<Record<string, TokenType>> = {
	comment: "comment",
	prolog: "comment",
	doctype: "comment",
	cdata: "comment",
	string: "string",
	char: "string",
	"attr-value": "string",
	number: "number",
	boolean: "boolean",
	constant: "boolean",
	symbol: "boolean",
	keyword: "keyword",
	atrule: "keyword",
	important: "keyword",
	function: "function",
	"class-name": "type",
	builtin: "type",
	property: "property",
	tag: "tag",
	selector: "tag",
	"attr-name": "attr",
	variable: "variable",
	regex: "variable",
	url: "variable",
	operator: "operator",
	entity: "operator",
	punctuation: "punctuation",
};

/** Prism belirteci — `prismjs` import edilmeden yapısal olarak yazıldı. */
export interface PrismToken {
	readonly type: string;
	readonly content: string | PrismToken | readonly (string | PrismToken)[];
	readonly alias?: string | readonly string[];
}

/**
 * `Prism.tokenize()` çıktısını `Token[]`e çevirir.
 *
 * Prism iç içe belirteç üretiyor (bir dizenin içindeki kaçış dizisi gibi);
 * çıktı **düz** bir liste: iç içe boyama bizim belirteç modelimizde yok ve
 * kod bloğunda gözle ayırt edilen bir fark üretmiyor.
 *
 * Düzleştirirken iç düğüm **kendi türünü** koruyor; tanımadığımız bir tür
 * ise dışarıdakine düşüyor. Tersi de düşünülmüştü (her şeyi dış türle
 * boyamak) ama bilgi atmak oluyordu: Prism `template-string` içindeki
 * `interpolation`ı ayırıyor ve onu dize rengine boyamak, kullanıcının
 * Prism takmasının sebebini —daha ince ayrım— geri alırdı.
 */
export function prismTokens(input: readonly (string | PrismToken)[]): Token[] {
	const out: Token[] = [];
	for (const parca of input) topla(parca, "text", out);
	return out;
}

function topla(parca: string | PrismToken, ustTur: TokenType, out: Token[]): void {
	if (typeof parca === "string") {
		if (parca !== "") out.push({ type: ustTur, text: parca });
		return;
	}
	const tur = cevir(parca) ?? ustTur;
	const icerik = parca.content;
	if (typeof icerik === "string") {
		if (icerik !== "") out.push({ type: tur, text: icerik });
		return;
	}
	if (Array.isArray(icerik)) {
		for (const alt of icerik as readonly (string | PrismToken)[]) topla(alt, tur, out);
		return;
	}
	topla(icerik as PrismToken, tur, out);
}

/** Türü, yoksa takma adlarını dener. */
function cevir(token: PrismToken): TokenType | null {
	const dogrudan = PRISM[token.type];
	if (dogrudan !== undefined) return dogrudan;
	const adlar = token.alias;
	if (adlar === undefined) return null;
	for (const ad of typeof adlar === "string" ? [adlar] : adlar) {
		const bulunan = PRISM[ad];
		if (bulunan !== undefined) return bulunan;
	}
	return null;
}

/** Shiki'nin renklendirilmiş belirteci — `shiki` import edilmeden. */
export interface ShikiToken {
	readonly content: string;
	readonly color?: string;
}

/**
 * `codeToTokens()` çıktısını `Token[]`e çevirir.
 *
 * Shiki tür değil **renk** üretiyor: bir tema dosyasını okuyup her
 * belirtece bir hex değeri veriyor. Bu yüzden `Token.color` alanı var —
 * o renk doğrudan yazılıyor ve `Token.type` `text` kalıyor.
 *
 * Bedeli açık ve kullanıcının bilmesi gereken bir şey: Shiki'nin renkleri
 * kendi temasından geliyor, Kalem'in `tokens.css` sözlüğünden değil. Yani
 * kullanıcı koyu temaya geçtiğinde kod bloğu **geçmiyor**; Shiki'nin
 * çift tema desteğiyle kendisi çözmesi gerekiyor. Dâhili belirteçleyici
 * bu sorunu hiç yaşamıyor.
 *
 * Satırlar diziler hâlinde geliyor; aralarına satır sonu koyuluyor.
 */
export function shikiTokens(lines: readonly (readonly ShikiToken[])[]): Token[] {
	const out: Token[] = [];
	for (const [i, satir] of lines.entries()) {
		if (i > 0) out.push({ type: "text", text: SATIR_SONU });
		for (const token of satir) {
			if (token.content === "") continue;
			out.push(
				token.color === undefined
					? { type: "text", text: token.content }
					: { type: "text", text: token.content, color: token.color },
			);
		}
	}
	return out;
}

/**
 * Satır sonu.
 *
 * Kaçış dizisi yerine kod noktası: bu depoda yama betikleri ters bölüyü
 * bir kez yiyip kaynağı bozdu (bkz. `editor.ts`).
 */
const SATIR_SONU = String.fromCharCode(10);
