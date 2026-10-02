/**
 * @kalem-editor/editor — Satır içi aralık düzenleme  (İş listesi: F2-07)
 *
 * ## Ne yapıyor
 *
 * `Inline[]` listesini karakter ofsetlerine göre kesiyor. Biçimlendirmenin
 * tamamı buna dayanıyor: seçili aralığı kes, `toggleMark`'tan geçir, geri
 * yapıştır.
 *
 * Kesme **sarmalayıcıları koruyor**: `strong[text("abc")]` listesinin
 * `[1,2)` dilimi `strong[text("b")]` veriyor, çıplak `text("b")` değil.
 * Bu şart, çünkü `hasMark` "seçimin tamamı bu biçimde mi" diye soruyor —
 * sarmalayıcı düşerse kalın bir metnin ortasını seçip Ctrl+B'ye basmak
 * kalınlığı kaldırmak yerine bir kat daha kalın yapardı.
 *
 * ## Uzunluk kuralı
 *
 * `offsets.ts` ile **birebir aynı** olmak zorunda: metin karakteri 1,
 * `break` 1, görsel 1. Ayrışırlarsa seçim kayar ve hata, yanlış yeri
 * kalınlaştırmak olarak görünür — bulması zor bir hata.
 *
 * Görsel eskiden 0'dı; imleç görselin iki yanında aynı ofsete düştüğü için
 * görsel seçilemiyor ve silinemiyordu (F4-01). Bkz. `offsets.ts`.
 */
import type { Inline } from "@kalem-editor/core";
import { sanitizeColor } from "@kalem-editor/core";
import type { MarkType } from "@kalem-editor/core/commands";
import { hasMark, toggleMark } from "@kalem-editor/core/commands";
import { normalizeInline } from "./read.js";

/** Bir düğümün ofset uzunluğu. */
export function inlineLength(node: Inline): number {
	switch (node.type) {
		case "text":
		case "inlineCode":
		case "html":
			return node.value.length;
		case "break":
			return 1;
		case "image":
		case "imageReference":
			// Tek karakterlik atomik öğe: yanına imleç konabiliyor, seçilip
			// silinebiliyor.
			return 1;
		default:
			return listLength(node.children);
	}
}

export function listLength(nodes: readonly Inline[]): number {
	let out = 0;
	for (const node of nodes) out += inlineLength(node);
	return out;
}

/**
 * Listenin `[from, to)` aralığını verir.
 *
 * Kısmen kapsanan **atomik** düğümler (görsel, referans) atlanıyor: bir
 * görselin yarısı diye bir şey yok. Tamamı kapsanıyorsa aynen geçiyor.
 *
 * ## Sıfır uzunluklu düğümler
 *
 * Sıfır uzunluklu bir düğüm hiçbir aralıkla **çakışmıyor**, yani
 * `bit <= from || bas >= to` kuralı onu her iki taraftan da eler. Görsel
 * eskiden 0 uzunluktaydı ve sonuç veri kaybıydı: imleci görselin yanına
 * koyup bir şey yapıştırmak görseli sessizce siliyordu (F4-01).
 *
 * Görsel artık 1 uzunlukta, ama kural duruyor: içi boş bir biçim düğümü
 * (`strong[]`) hâlâ 0 uzunlukta olabilir. Sıfır uzunluklu düğüm
 * `from <= bas < to` ise aralığa ait; böylece her düğüm **tam olarak
 * bir** dilime düşüyor.
 */
export function sliceInline(nodes: readonly Inline[], from: number, to: number): Inline[] {
	const out: Inline[] = [];
	let pos = 0;
	for (const node of nodes) {
		const len = inlineLength(node);
		const bas = pos;
		const bit = pos + len;
		pos = bit;

		if (len === 0) {
			if (bas >= from && bas < to) out.push(node);
			continue;
		}
		if (bit <= from || bas >= to) continue;
		out.push(...sliceNode(node, Math.max(from, bas) - bas, Math.min(to, bit) - bas));
	}
	return out;
}

function sliceNode(node: Inline, from: number, to: number): Inline[] {
	const len = inlineLength(node);
	if (from <= 0 && to >= len) return [node];

	if (node.type === "text" || node.type === "html") {
		const value = node.value.slice(from, to);
		return value === "" ? [] : [{ ...node, value }];
	}
	if (node.type === "inlineCode") {
		const value = node.value.slice(from, to);
		// Kesilen kod parçası kaynaktaki çit uzunluğunu taşımamalı; içerik
		// değişti, çit yeniden hesaplanmalı.
		return value === "" ? [] : [{ type: "inlineCode", value }];
	}
	if ("children" in node) {
		const kids = sliceInline(node.children, from, to);
		return kids.length === 0 ? [] : [{ ...node, children: kids } as Inline];
	}
	// Atomik düğümün parçası alınamaz.
	return [];
}

/**
 * Aralığı verilen düğümlerle değiştirir.
 *
 * Sonuç normalleştiriliyor: kesme, komşu hâle gelmiş aynı biçimleri ve
 * bölünmüş metinleri üretir; birleştirilmezse model her işlemde biraz
 * daha parçalanır.
 */
export function spliceInline(
	nodes: readonly Inline[],
	from: number,
	to: number,
	replacement: readonly Inline[],
): Inline[] {
	return normalizeInline([
		...sliceInline(nodes, 0, from),
		...replacement,
		// Kuyruğun üst sınırı `Infinity`: listenin **tam sonunda** duran
		// sıfır uzunluklu bir düğüm (son karakterden sonraki görsel)
		// `bas < to` koşuluna takılıp düşerdi.
		...sliceInline(nodes, to, Number.POSITIVE_INFINITY),
	]);
}

/**
 * Aralığa bir biçim uygular ya da kaldırır.
 *
 * Karar `@kalem-editor/core/commands`'ın `toggleMark`'ına ait: aralığın tamamı o
 * biçimdeyse kaldırıyor, değilse uyguluyor — Word'ün kalın düğmesiyle aynı
 * davranış. Kararın çekirdekte olması, aynı mantığın başsız kullanımda
 * (SSR, betik) da geçerli olmasını sağlıyor.
 */
export function applyMark(
	nodes: readonly Inline[],
	from: number,
	to: number,
	mark: MarkType,
): Inline[] {
	if (from >= to) return [...nodes];
	const secili = sliceInline(nodes, from, to);
	return spliceInline(nodes, from, to, toggleMark(secili, mark));
}

/**
 * Aralığın tamamı bu biçimde mi — araç çubuğunun basılı durumu için.
 *
 * **Boş aralıkta imlecin solundaki karaktere bakılıyor.** Sabit araç
 * çubuğu (F3-06) seçim olmadan da duruyor ve kullanıcı imleci kalın bir
 * kelimenin içine koyunca B'nin yanmasını bekliyor. Sol taraf seçiliyor
 * çünkü yazmaya devam eden kullanıcı soldaki biçimi sürdürüyor; sağdaki
 * karakter henüz girilmemiş bir metnin biçimi değil.
 *
 * Bloğun başında (`from === 0`) sol komşu yok; oradaki tek makul cevap
 * sağdaki karakter.
 */
export function markActive(
	nodes: readonly Inline[],
	from: number,
	to: number,
	mark: MarkType,
): boolean {
	const [bas, bit] = from >= to ? (from > 0 ? [from - 1, from] : [0, 1]) : [from, to];
	return hasMark(sliceInline(nodes, bas, bit), mark);
}

/** Colors the range; `null` (or an unsafe value) removes the color instead. */
export function applyColor(
	nodes: readonly Inline[],
	from: number,
	to: number,
	color: string | null,
): Inline[] {
	if (from >= to) return [...nodes];
	const plain = stripColor(sliceInline(nodes, from, to));
	const safe = color === null ? null : sanitizeColor(color);
	if (safe === null) return spliceInline(nodes, from, to, plain);
	return spliceInline(nodes, from, to, [{ type: "color", color: safe, children: plain }]);
}

function stripColor(nodes: readonly Inline[]): Inline[] {
	return nodes.flatMap((node): Inline[] => {
		if (node.type === "color") return stripColor(node.children);
		if ("children" in node) return [{ ...node, children: stripColor(node.children) } as Inline];
		return [node];
	});
}

/**
 * The color of the whole range, or `null` when it is uncolored or mixed.
 * An empty range reports the character before the caret, like `markActive`.
 */
export function colorAt(nodes: readonly Inline[], from: number, to: number): string | null {
	const [start, end] = from >= to ? (from > 0 ? [from - 1, from] : [0, 1]) : [from, to];
	const colors = new Set<string | null>();
	collectColors(sliceInline(nodes, start, end), null, colors);
	const [only] = colors;
	return colors.size === 1 && only !== undefined ? only : null;
}

function collectColors(
	nodes: readonly Inline[],
	inherited: string | null,
	out: Set<string | null>,
): void {
	for (const node of nodes) {
		if (node.type === "break") continue;
		if ("children" in node) {
			collectColors(node.children, node.type === "color" ? node.color : inherited, out);
		} else out.add(inherited);
	}
}

/**
 * Aralığı bağlantıya çevirir; `url` boşsa bağlantıyı kaldırır.
 *
 * Bağlantı `toggleMark`'a girmiyor çünkü işaret değil: bir URL taşıyor ve
 * "aç/kapa" yerine "kur/kaldır" davranıyor. Çekirdekteki `MarkType` de bu
 * yüzden bağlantıyı içermiyor.
 */
export function applyLink(
	nodes: readonly Inline[],
	from: number,
	to: number,
	url: string,
): Inline[] {
	if (from >= to) return [...nodes];
	const secili = sliceInline(nodes, from, to);

	// Var olan bağlantıları önce aç: iç içe bağlantı Markdown'da yok.
	const duz = secili.flatMap((node) => (node.type === "link" ? [...node.children] : [node]));
	if (url === "") return spliceInline(nodes, from, to, duz);

	return spliceInline(nodes, from, to, [
		{ type: "link", url, title: null, children: normalizeInline(duz) },
	]);
}

/**
 * Ofsetteki bağlantıyı ve sınırlarını bulur.
 *
 * İmleç bir bağlantının **içinde** duruyorsa (seçim boş olsa bile) o
 * bağlantı bulunuyor: kullanıcı bağlantıya tıklayıp düzenlemek istediğinde
 * seçim yapmak zorunda kalmamalı.
 *
 * Sınırlar da dönüyor çünkü düzenleme akışı bağlantının tamamını
 * değiştiriyor — yalnızca imlecin durduğu karakteri değil.
 */
export function linkAt(
	nodes: readonly Inline[],
	offset: number,
): {
	readonly url: string;
	readonly title: string | null;
	readonly from: number;
	readonly to: number;
} | null {
	let pos = 0;
	for (const node of nodes) {
		const len = inlineLength(node);
		const bas = pos;
		const bit = pos + len;
		pos = bit;
		if (node.type === "link" && offset >= bas && offset <= bit) {
			return { url: node.url, title: node.title, from: bas, to: bit };
		}
		// İç içe düğümlerde de aranıyor: `**[a](/y)**` gibi bir yapıda
		// bağlantı bir seviye aşağıda.
		if ("children" in node && offset >= bas && offset <= bit) {
			const ic = linkAt(node.children, offset - bas);
			if (ic !== null) return { ...ic, from: ic.from + bas, to: ic.to + bas };
		}
	}
	return null;
}
