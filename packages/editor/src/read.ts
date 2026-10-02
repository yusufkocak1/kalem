/**
 * @kalem-editor/editor — DOM → satır içi AST  (İş listesi: F2-05, F2-07)
 *
 * ## Neden bu yön var
 *
 * Blok yapısı modelden DOM'a akar, satır içi içerik ters yönde. Sebep IME:
 * Japonca/Çince/Korece yazımda tarayıcı, tuş vuruşlarıyla son karakter
 * arasında bir **bileşim** durumu tutar. O sırada DOM'a müdahale etmek —
 * içeriği modele göre yeniden kurmak — bileşimi bozar, harfleri kaybettirir.
 * Bu yüzden satır içinde tarayıcı serbest bırakılıyor; model her `input`
 * olayında DOM'dan okunuyor.
 *
 * ## Ne okunuyor
 *
 * `render.ts`'in ürettiği yapının aynısı, artı tarayıcının kendiliğinden
 * ürettiği şeyler: doldurucu `<br>`, `&nbsp;`, iç içe aynı biçim etiketleri
 * (`<b><b>x</b></b>`), boş etiketler. Bunlar burada normalleştiriliyor.
 *
 * Bilinmeyen etiket **şeffaf** sayılıyor: içeriği yukarı taşınır. Kullanıcı
 * bir yerden `<span style=…>` yapıştırırsa metni kalır, çöp gitmez.
 */
import type { Inline } from "@kalem-editor/core";
import { COLOR_ATTR } from "./render.js";

const ELEMENT = 1;
const TEXT = 3;

/** Satır içi biçim etiketleri → AST düğüm türü. */
const MARKS: Record<string, "strong" | "emphasis" | "delete"> = {
	STRONG: "strong",
	B: "strong",
	EM: "emphasis",
	I: "emphasis",
	DEL: "delete",
	S: "delete",
	STRIKE: "delete",
};

const NBSP = String.fromCharCode(0xa0);

/**
 * Bölünmez boşluğu sıradan boşluğa çevirir.
 *
 * Tarayıcı, `contenteditable` içinde art arda boşluk yazıldığında ikincisini
 * `&nbsp;` yapar — yoksa HTML onu yutardı. Bu, kullanıcının kararı değil
 * tarayıcının hilesi; Markdown kaynağına sızarsa görünmez bir karakter
 * bırakır ve `git diff` okunmaz hâle gelir.
 *
 * Bedeli: belgede **kasten** bulunan bir U+00A0, o blok düzenlenirse
 * sıradan boşluğa döner. Düzenlenmeyen bloklar etkilenmez.
 */
function normalizeText(value: string): string {
	return value.split(NBSP).join(" ");
}

/** Bir elemanın çocuklarını satır içi AST'ye çevirir. */
export function readInline(element: Element): Inline[] {
	const out: Inline[] = [];
	readChildren(element, out);
	return normalize(out);
}

function readChildren(parent: Node, out: Inline[]): void {
	for (const child of Array.from(parent.childNodes)) readNode(child, out);
}

function readNode(node: Node, out: Inline[]): void {
	if (node.nodeType === TEXT) {
		const value = normalizeText(node.nodeValue ?? "");
		if (value !== "") out.push({ type: "text", value });
		return;
	}
	if (node.nodeType !== ELEMENT) return;

	const element = node as Element;
	const name = element.nodeName;

	if (name === "BR") {
		out.push({ type: "break" });
		return;
	}

	if (name === "CODE") {
		const value = normalizeText(element.textContent ?? "");
		if (value !== "") out.push({ type: "inlineCode", value });
		return;
	}

	if (name === "IMG") {
		const url = element.getAttribute("src");
		// `src`'siz görsel bir şey göstermez; modele girmesinin anlamı yok.
		if (url === null) return;
		const title = element.getAttribute("title");
		out.push({ type: "image", url, alt: element.getAttribute("alt") ?? "", title });
		return;
	}

	if (name === "A") {
		const url = element.getAttribute("href");
		const children = normalize(collect(element));
		// `href`'siz bağlantı bağlantı değil; metni korunur.
		if (url === null) {
			out.push(...children);
			return;
		}
		out.push({ type: "link", url, title: element.getAttribute("title"), children });
		return;
	}

	if (name === "INPUT") {
		// Görev kutusu içeriğin parçası değil, maddenin durumu.
		return;
	}

	const color = name === "SPAN" ? element.getAttribute(COLOR_ATTR) : null;
	if (color !== null) {
		const children = normalize(collect(element));
		if (children.length > 0) out.push({ type: "color", color, children });
		return;
	}

	const mark = MARKS[name];
	if (mark !== undefined) {
		const children = normalize(collect(element));
		if (children.length === 0) return;
		out.push({ type: mark, children } as Inline);
		return;
	}

	// Bilinmeyen etiket şeffaf: içeriği yukarı taşınır.
	readChildren(element, out);
}

function collect(element: Element): Inline[] {
	const out: Inline[] = [];
	readChildren(element, out);
	return out;
}

/**
 * Normalleştirme.
 *
 * Üç iş yapıyor ve üçü de tarayıcının ürettiği gerçek durumlar:
 *
 * 1. **Bitişik metinleri birleştirir.** Tarayıcı yazarken metni sık sık
 *    parçalara böler; birleştirilmezse AST her tuşta değişir ve gereksiz
 *    geçmiş kaydı üretir.
 * 2. **Aynı biçimin iç içesini düzler.** `<b>a<b>b</b></b>` Ctrl+B'nin
 *    doğal sonucu; modelde tek bir `strong` olmalı.
 * 3. **Sondaki `<br>`'yi atar.** Boş satırın yüksekliğini korumak için
 *    tarayıcının koyduğu doldurucu; Markdown'da karşılığı yok.
 */
function normalize(nodes: readonly Inline[]): Inline[] {
	const merged = normalizeInline(nodes);
	// **Tek** bir sondaki satır sonu atılıyor, hepsi değil: `render.ts`
	// gerçek bir sondaki satır sonunun arkasına bir doldurucu koyuyor, o
	// yüzden ikisi arasındaki fark tam olarak bir düğüm.
	if (merged[merged.length - 1]?.type === "break") merged.pop();
	return merged;
}

/**
 * Satır içi listeyi sadeleştirir.
 *
 * DOM'dan okurken de (F2-05) biçim uygularken de (F2-07) aynı düzeltmeler
 * gerekiyor, o yüzden dışa açık. Sondaki doldurucu `<br>` **burada
 * atılmıyor**: o yalnızca DOM'dan okumaya özgü bir tarayıcı artığı, model
 * üzerinde çalışan biçimlendirmenin ona dokunma hakkı yok.
 */
export function normalizeInline(nodes: readonly Inline[]): Inline[] {
	const flat: Inline[] = [];
	for (const node of nodes) flattenInto(flat, node, null, null);
	return mergeAdjacent(flat);
}

/** Bitişik metinleri ve bitişik aynı biçimleri tek düğüme indirir. */
function mergeAdjacent(nodes: readonly Inline[]): Inline[] {
	const out: Inline[] = [];
	for (const node of nodes) {
		const last = out[out.length - 1];

		if (node.type === "text" && last?.type === "text") {
			out[out.length - 1] = { ...last, value: last.value + node.value };
			continue;
		}
		// `**a****b**` değil `**ab**`. Bölünmüş kalınlık, biçim uygulandıktan
		// sonra doğal olarak oluşuyor ve serileştirilince gerçekten bozuk
		// Markdown üretiyor.
		if (node.type === "color" && last?.type === "color" && node.color === last.color) {
			out[out.length - 1] = {
				type: "color",
				color: last.color,
				children: mergeAdjacent([...last.children, ...node.children]),
			};
			continue;
		}
		if (isMark(node) && isMark(last) && node.type === last.type) {
			out[out.length - 1] = {
				...last,
				children: mergeAdjacent([...last.children, ...node.children]),
			} as Inline;
			continue;
		}
		out.push(node);
	}
	return out;
}

type MarkNode = Extract<Inline, { type: "strong" | "emphasis" | "delete" }>;

function isMark(node: Inline | undefined): node is MarkNode {
	return node?.type === "strong" || node?.type === "emphasis" || node?.type === "delete";
}

/**
 * İç içe aynı biçimi tek seviyeye indirir.
 *
 * Düzleştirme yeni komşuluklar üretiyor: `<b>a<b>b</b></b>` içindeki iki
 * metin, iç seviye kalkınca yan yana geliyor. Bu yüzden birleştirme
 * **her seviyede** tekrar çalışmak zorunda; yalnızca en dışta yapılsaydı
 * modelde `text(a), text(b)` kalır ve her tuşta gereksiz fark üretirdi.
 */
function flattenInto(
	out: Inline[],
	node: Inline,
	insideMark: string | null,
	insideColor: string | null,
): void {
	if (node.type === "strong" || node.type === "emphasis" || node.type === "delete") {
		if (node.type === insideMark) {
			// Aynı biçim zaten dışarıda: bu seviye anlamsız, çocuklar yukarı.
			for (const child of node.children) flattenInto(out, child, insideMark, insideColor);
			return;
		}
		const inner: Inline[] = [];
		for (const child of node.children) flattenInto(inner, child, node.type, insideColor);
		const merged = mergeAdjacent(inner);
		if (merged.length === 0) return;
		out.push(...liftColors(node, merged));
		return;
	}
	if (node.type === "color") {
		if (node.color === insideColor) {
			for (const child of node.children) flattenInto(out, child, insideMark, insideColor);
			return;
		}
		const inner: Inline[] = [];
		for (const child of node.children) flattenInto(inner, child, insideMark, node.color);
		const merged = mergeAdjacent(inner);
		// The serializer drops a break at either edge of a wrapper, so it moves outside.
		let start = 0;
		let end = merged.length;
		while (start < end && merged[start]?.type === "break") start++;
		while (end > start && merged[end - 1]?.type === "break") end--;
		out.push(...merged.slice(0, start));
		if (end > start) out.push({ ...node, children: merged.slice(start, end) });
		out.push(...merged.slice(end));
		return;
	}
	out.push(node);
}

/**
 * Keeps color outside marks: `**<span>x</span>**` next to a letter is not
 * emphasis in CommonMark (the `<` makes the run non-flanking), while
 * `<span>**x**</span>` always is.
 */
function liftColors(mark: MarkNode, children: readonly Inline[]): Inline[] {
	if (!children.some((child) => child.type === "color"))
		return [{ ...mark, children: [...children] }];
	const out: Inline[] = [];
	let run: Inline[] = [];
	const flush = (): void => {
		if (run.length > 0) out.push({ ...mark, children: run });
		run = [];
	};
	for (const child of children) {
		if (child.type !== "color") {
			run.push(child);
			continue;
		}
		flush();
		out.push({ ...child, children: liftColors(mark, child.children) });
	}
	flush();
	return out;
}

/**
 * Kod bloğunun metnini okur.
 *
 * `textContent` yeterli: `<pre>` içinde biçimlendirme yok. Tarayıcının
 * satır sonu için koyduğu `<br>`'ler `textContent`'te kaybolur, o yüzden
 * elle çevriliyor.
 */
export function readCode(element: Element): string {
	// Sondaki tek satır sonu atılıyor: tarayıcı `<pre>` içinde son satırı
	// göstermek için kendiliğinden ekler, kaynağın parçası değil.
	return textOf(element).replace(/\n$/, "");
}

function textOf(node: Node): string {
	if (node.nodeType === TEXT) return node.nodeValue ?? "";
	if (node.nodeType !== ELEMENT) return "";
	if (node.nodeName === "BR") return "\n";
	let out = "";
	for (const child of Array.from(node.childNodes)) out += textOf(child);
	return out;
}
