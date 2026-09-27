/**
 * @kalem-editor/plugin-code-highlight — DOM boyama  (İş listesi: F4-02)
 *
 * Belirteç listesini `<code>` elemanına yazan katman. Eklentiden ayrı
 * duruyor çünkü tek başına da işi var: `@kalem-editor/viewer` çıktısı da aynı
 * yapıyı üretiyor (`<pre><code class="language-…">`) ve salt okunur bir
 * sayfa editörü hiç yüklemeden vurgulama alabiliyor (`highlightAll`).
 *
 * ## `innerHTML` yok
 *
 * Her belirteç `createElement` + `textContent` ile yazılıyor. Kod
 * bloğunun içeriği kullanıcının yazdığı metin; HTML olarak
 * ayrıştırılsaydı `<img onerror=…>` yazan herkes betik çalıştırırdı.
 *
 * ## İmleç
 *
 * Boyama, kullanıcı **kod bloğunun içinde yazarken** oluyor: her tuş
 * vuruşundan sonra elemanın çocukları baştan kuruluyor ve imleç silinen
 * düğümlerle birlikte kayboluyor. Bu yüzden karakter ofseti boyamadan
 * önce ölçülüyor, sonra geri kuruluyor.
 *
 * Ofset matematiği `@kalem-editor/editor`den geliyor, kopyalanmadı: kural
 * (`<br>` = 1 karakter, `<input>` = 0) editörün seçim koduyla **aynı**
 * olmak zorunda, ayrışırlarsa imleç kayar. İçe aktarılan iki fonksiyon
 * saf ve yan etkisiz; ağaç sallayan bir paketleyicide editörün geri
 * kalanı bu yüzden gelmiyor.
 *
 * ## Metin neden `textContent` ile okunmuyor
 *
 * `textContent`, `<br>` elemanını **görmüyor**: `<code>a<br>b</code>` için
 * "ab" veriyor. Tarayıcı `contenteditable` içinde Enter'a basıldığında
 * `<br>` üretebiliyor ve o hâlde boyama satır sonunu yutardı — kullanıcı
 * yazdığı satırın kaybolduğunu görürdü. Editörün `readCode`u da aynı
 * sebeple kendi okuyucusunu yazıyor.
 */
import { offsetOf, pointAt } from "@kalem-editor/editor";
import type { LanguageLoader } from "./languages.js";
import { builtinLanguages, langOf } from "./languages.js";
import type { Grammar, Token } from "./token.js";
import { tokenize } from "./token.js";

/** Vurgulanacak elemanlar: hem editörün hem görüntüleyicinin ürettiği yapı. */
const SECICI = 'pre > code[class*="language-"]';

const ELEMENT = 1;
const TEXT = 3;
/** Kaçış dizisi yerine kod noktası (bkz. `adapters.ts`). */
const SATIR_SONU = String.fromCharCode(10);

export interface HighlighterOptions {
	/** Dil adı → gramer yükleyici. Varsayılan: `builtinLanguages`. */
	languages?: Readonly<Record<string, LanguageLoader>>;
	/**
	 * Kendi vurgulayıcın.
	 *
	 * Verilirse dil paketleri hiç yüklenmiyor; Prism/Shiki çıktısını
	 * `adapters.ts` ile `Token[]`e çevirmek çağıranın işi. `null` dönmek
	 * "bu dili bilmiyorum" demek ve blok boyanmadan kalıyor.
	 */
	highlight?: (code: string, lang: string) => readonly Token[] | null;
	/** CSS sınıf öneki (varsayılan `"kalem-"`, editörle aynı olmalı). */
	classPrefix?: string;
	/**
	 * Bu uzunluğun üstündeki bloklar boyanmıyor.
	 *
	 * Vurgulama bir okuma kolaylığı; kimsenin yazarken takılmasına değmez.
	 * Sınır, yapıştırılan devasa bir günlük dosyasının her tuş vuruşunda
	 * yeniden taranmasını engelliyor.
	 */
	maxLength?: number;
	/** Gramer yüklenemediğinde ya da vurgulayıcı hata verdiğinde. */
	onError?: (error: Error, lang: string) => void;
}

export interface Highlighter {
	/** Kökün altındaki kod bloklarını boyar; eksik gramerleri yükletir. */
	refresh(root: ParentNode): void;
	/** Süren gramer yüklemeleri bitene kadar bekler. */
	whenIdle(): Promise<void>;
	/** Boyamayı geri alır — eleman editörün bıraktığı hâline döner. */
	clear(root: ParentNode): void;
}

/** Elemanın en son hangi metin ve dille boyandığı. */
const sonBoyama = new WeakMap<Element, string>();

export function createHighlighter(options: HighlighterOptions = {}): Highlighter {
	const p = options.classPrefix ?? "kalem-";
	const diller = options.languages ?? builtinLanguages;
	const enFazla = options.maxLength ?? 40000;

	const gramerler = new Map<string, Grammar>();
	const yukleniyor = new Map<string, Promise<void>>();
	/** Yükleyicisi olmayan diller; her tazelemede yeniden denenmemeli. */
	const bilinmeyen = new Set<string>();
	/** Gramer geç geldiğinde hangi kökün tazeleneceği. */
	let sonKok: ParentNode | null = null;

	function gramer(lang: string): Grammar | null {
		const hazir = gramerler.get(lang);
		if (hazir !== undefined) return hazir;
		if (bilinmeyen.has(lang) || yukleniyor.has(lang)) return null;

		const yukleyici = diller[lang];
		if (yukleyici === undefined) {
			bilinmeyen.add(lang);
			return null;
		}

		const is = yukleyici()
			.then((g) => {
				gramerler.set(lang, g);
			})
			.catch((sebep: unknown) => {
				// Yüklenemeyen dil kalıcı olarak bilinmeyene düşüyor: her
				// tuş vuruşunda ağa gitmeyi denemek işe yaramaz.
				bilinmeyen.add(lang);
				options.onError?.(sebep instanceof Error ? sebep : new Error(String(sebep)), lang);
			})
			.finally(() => {
				yukleniyor.delete(lang);
				if (sonKok !== null) tazele(sonKok);
			});
		yukleniyor.set(lang, is);
		return null;
	}

	function belirtecler(kod: string, lang: string): readonly Token[] | null {
		if (options.highlight !== undefined) {
			try {
				return options.highlight(kod, lang);
			} catch (sebep) {
				options.onError?.(sebep instanceof Error ? sebep : new Error(String(sebep)), lang);
				return null;
			}
		}
		const g = gramer(lang);
		return g === null ? null : tokenize(kod, g);
	}

	function tazele(root: ParentNode): void {
		sonKok = root;
		for (const el of Array.from(root.querySelectorAll<HTMLElement>(SECICI))) {
			const lang = langOf(el);
			if (lang === null) continue;
			const kod = kodMetni(el);
			if (kod.length > enFazla) continue;
			const imza = `${lang}\u0000${kod}`;
			if (sonBoyama.get(el) === imza) continue;
			const tokens = belirtecler(kod, lang);
			if (tokens === null) continue;
			yaz(el, () => parcalar(el, tokens, p));
			sonBoyama.set(el, imza);
		}
	}

	return {
		refresh: tazele,

		async whenIdle() {
			// Bir gramerin yüklenmesi başka bir dili tetikleyebiliyor
			// (tazeleme yeniden çalışıyor), o yüzden döngü.
			while (yukleniyor.size > 0) await Promise.all(Array.from(yukleniyor.values()));
		},

		clear(root) {
			sonKok = null;
			for (const el of Array.from(root.querySelectorAll<HTMLElement>(SECICI))) {
				if (!sonBoyama.has(el)) continue;
				sonBoyama.delete(el);
				const kod = kodMetni(el);
				yaz(el, () => [el.ownerDocument.createTextNode(kod)]);
			}
		},
	};
}

/**
 * Bir kod bloğunu tek seferde boyar.
 *
 * Görüntüleyici çıktısı için: editör yok, olay yok, temizlik yok. Gramer
 * yüklemesi bittiğinde çözülüyor ki sunucu tarafında ekran görüntüsü alan
 * ya da yazdıran kod bekleyebilsin.
 */
export async function highlightAll(
	root: ParentNode,
	options: HighlighterOptions = {},
): Promise<void> {
	const vurgulayici = createHighlighter(options);
	vurgulayici.refresh(root);
	await vurgulayici.whenIdle();
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/** Elemanın kod metni; `<br>` satır sonu sayılıyor (dosya başına bakın). */
export function kodMetni(node: Node): string {
	if (node.nodeType === TEXT) return node.nodeValue ?? "";
	if (node.nodeType !== ELEMENT) return "";
	if (node.nodeName === "BR") return SATIR_SONU;
	let out = "";
	for (const child of Array.from(node.childNodes)) out += kodMetni(child);
	return out;
}

/** Belirteçleri DOM düğümlerine çevirir. */
function parcalar(el: HTMLElement, tokens: readonly Token[], p: string): Node[] {
	const doc = el.ownerDocument;
	const out: Node[] = [];
	for (const token of tokens) {
		if (token.text === "") continue;
		// Boyanmayan metin için eleman üretilmiyor: uzun bir dosyada
		// yüzlerce anlamsız `<span>` demek olurdu.
		if (token.type === "text" && token.color === undefined) {
			out.push(doc.createTextNode(token.text));
			continue;
		}
		const span = doc.createElement("span");
		if (token.type !== "text") span.className = `${p}tok-${token.type}`;
		if (token.color !== undefined) span.style.color = token.color;
		span.textContent = token.text;
		out.push(span);
	}
	return out;
}

/**
 * Elemanın içeriğini değiştirir, imleci yerinde bırakır.
 *
 * İçerik üretici bir fonksiyon: ofset ölçümü **eski** DOM üzerinde
 * yapılmalı, düğümler ondan sonra kurulmalı.
 */
function yaz(el: HTMLElement, uret: () => Node[]): void {
	const secim = olcu(el);
	el.replaceChildren(...uret());
	if (secim !== null) geriKur(el, secim);
}

interface Aralik {
	readonly from: number;
	readonly to: number;
}

/** Seçim bu elemanın içindeyse karakter aralığı, değilse `null`. */
function olcu(el: HTMLElement): Aralik | null {
	const selection = el.ownerDocument.getSelection();
	if (selection === null || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
	return {
		from: offsetOf(el, range.startContainer, range.startOffset),
		to: offsetOf(el, range.endContainer, range.endOffset),
	};
}

function geriKur(el: HTMLElement, aralik: Aralik): void {
	const doc = el.ownerDocument;
	const selection = doc.getSelection();
	if (selection === null) return;
	const bas = pointAt(el, aralik.from);
	const bit = pointAt(el, aralik.to);
	const range = doc.createRange();
	range.setStart(bas.node, bas.offset);
	range.setEnd(bit.node, bit.offset);
	selection.removeAllRanges();
	selection.addRange(range);
}
