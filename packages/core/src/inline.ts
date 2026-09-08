/**
 * @kalem/core — Satır içi ayrıştırıcı  (İş listesi: F1-04)
 *
 * Blok ayrıştırıcının verdiği ham metni satır içi düğümlere çevirir.
 *
 * ## İki geçiş
 *
 * 1. **Belirteçleme.** Metin soldan sağa taranır; kod span, autolink, ham
 *    HTML, kaçış ve sert satır sonu doğrudan düğüme dönüşür. Vurgu
 *    adayları (`*`/`_`/`~` dizileri) ise şimdilik **sınırlayıcı** olarak
 *    kaydedilir, karar verilmez.
 * 2. **Sınırlayıcı eşleştirme.** CommonMark'ın "delimiter run" algoritması
 *    hangi sınırlayıcının hangisiyle eşleştiğine karar verir.
 *
 * Tek geçişte çözülemez: `*a **b* c**` gibi girdilerde bir yıldızın açış mı
 * kapanış mı olduğu **ancak sonrasını gördükten sonra** bellidir.
 *
 * ## Öncelik
 *
 * Kod span, autolink ve ham HTML vurgudan **önce** gelir: `` `*a*` `` içindeki
 * yıldızlar vurgu değildir. Bu yüzden bunlar birinci geçişte kesinleşir ve
 * ikinci geçiş onların içine bakmaz.
 */
import type { Inline, InlineCode, Link, Text } from "./ast.js";

/** Ayrıştırma sırasında kullanılan, henüz karara bağlanmamış sınırlayıcı. */
interface Delimiter {
	/** Sınırlayıcı karakteri. */
	readonly marker: "*" | "_" | "~";
	/** Dizideki karakter sayısı. */
	length: number;
	/** Düğüm listesindeki metin düğümünün indisi. */
	index: number;
	/** Açış olabilir mi (CommonMark: can open emphasis). */
	readonly canOpen: boolean;
	/** Kapanış olabilir mi. */
	readonly canClose: boolean;
	/** Eşleştirme sırasında tüketildi mi. */
	active: boolean;
}

/**
 * Unicode boşluk (CommonMark tanımı: boşluk, sekme, satır sonu ve Zs sınıfı).
 *
 * `\s` bunların hepsini kapsar. Karakterleri düz yazmak yerine sınıf
 * kullanılıyor: ham Unicode boşluklar kaynak dosyada görünmez olduğu için
 * gözden kaçan hatalara — ve bu dosyada bir derleme hatasına — yol açtı.
 */
const UNICODE_WHITESPACE = /\s/;

/**
 * CommonMark'ın noktalama tanımı — Unicode `P` (noktalama) ve `S` (simge)
 * sınıfları. Vurgu kenar kurallarında kullanılır.
 */
const PUNCTUATION = /[\p{P}\p{S}]/u;

/** Markdown'da ters bölü ile kaçırılabilen karakterler. */
const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/** `<https://...>` ve `<posta@ornek.com>` biçimli otomatik bağlantılar. */
const AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/;
const AUTOLINK_EMAIL =
	/^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;

/** Satır içi ham HTML etiketi, yorumu, talimatı. */
const INLINE_HTML =
	/^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][\s\S]*?>|<!\[CDATA\[[\s\S]*?]]>)/;

/** Metin düğümü kısayolu. */
const text = (value: string): Text => ({ type: "text", value });

/**
 * Ham satır içi metni düğümlere çevirir.
 *
 * Blok ayrıştırıcıya `parseBlocks(src, { parseInline })` ile takılır.
 */
export function parseInline(raw: string): Inline[] {
	const { slots, delimiters } = tokenize(raw);
	resolveEmphasis(slots, delimiters);
	return compact(slots);
}

// ---------------------------------------------------------------------------
// 1. geçiş — belirteçleme
// ---------------------------------------------------------------------------

/**
 * Düğümler **yuvalarda** tutulur: her yuva sıfır ya da daha çok düğüm taşır.
 *
 * Sebebi vurgu eşleştirmesi: oluşan `strong`/`emphasis` düğümü, açış
 * sınırlayıcısının **hemen ardına** girmelidir. Düz bir dizide bu araya
 * ekleme demek olurdu ve sınırlayıcıların sakladığı indisler kayardı.
 * Yuvalar sayesinde ekleme, ilgili yuvanın sonuna itmekten ibaret.
 */
type Slots = Inline[][];

interface TokenizeResult {
	readonly slots: Slots;
	readonly delimiters: Delimiter[];
}

function tokenize(raw: string): TokenizeResult {
	const slots: Slots = [];
	const delimiters: Delimiter[] = [];
	let buffer = "";
	let i = 0;

	const nodes = {
		push(node: Inline): void {
			slots.push([node]);
		},
		get length(): number {
			return slots.length;
		},
	};

	/** Biriken düz metni düğüm olarak boşaltır. */
	const flush = (): void => {
		if (buffer !== "") {
			nodes.push(text(buffer));
			buffer = "";
		}
	};

	while (i < raw.length) {
		const ch = raw[i] as string;

		// --- Ters bölü kaçışı ---------------------------------------------------
		if (ch === "\\") {
			const next = raw[i + 1];
			if (next !== undefined && ESCAPABLE.includes(next)) {
				buffer += next;
				i += 2;
				continue;
			}
			if (next === "\n") {
				// Ters bölü + satır sonu = sert satır sonu.
				flush();
				nodes.push({ type: "break", syntax: { marker: "backslash" } });
				i += 2;
				continue;
			}
			buffer += ch;
			i++;
			continue;
		}

		// --- Kod span -----------------------------------------------------------
		if (ch === "`") {
			const span = readCodeSpan(raw, i);
			if (span !== null) {
				flush();
				nodes.push(span.node);
				i = span.next;
				continue;
			}
			buffer += ch;
			i++;
			continue;
		}

		// --- Autolink ve ham HTML -----------------------------------------------
		if (ch === "<") {
			const rest = raw.slice(i);
			const auto = AUTOLINK.exec(rest);
			if (auto !== null) {
				flush();
				const url = auto[1] as string;
				nodes.push(makeAutolink(url, url));
				i += auto[0].length;
				continue;
			}
			const mail = AUTOLINK_EMAIL.exec(rest);
			if (mail !== null) {
				flush();
				const address = mail[1] as string;
				nodes.push(makeAutolink(`mailto:${address}`, address));
				i += mail[0].length;
				continue;
			}
			const html = INLINE_HTML.exec(rest);
			if (html !== null) {
				flush();
				nodes.push({ type: "html", value: html[0] });
				i += html[0].length;
				continue;
			}
			buffer += ch;
			i++;
			continue;
		}

		// --- Sert satır sonu (iki+ boşluk + satır sonu) --------------------------
		if (ch === "\n") {
			const trailing = /[ \t]+$/.exec(buffer);
			if (trailing !== null && trailing[0].length >= 2) {
				buffer = buffer.slice(0, -trailing[0].length);
				flush();
				nodes.push({ type: "break", syntax: { marker: "spaces" } });
			} else {
				// Yumuşak satır sonu: metin içinde satır sonu olarak kalır.
				buffer = buffer.replace(/[ \t]+$/, "");
				buffer += "\n";
			}
			i++;
			continue;
		}

		// --- Vurgu sınırlayıcıları ----------------------------------------------
		if (ch === "*" || ch === "_" || ch === "~") {
			const run = readDelimiterRun(raw, i, ch);
			flush();
			delimiters.push({
				marker: ch,
				length: run.length,
				index: nodes.length,
				canOpen: run.canOpen,
				canClose: run.canClose,
				active: true,
			});
			nodes.push(text(ch.repeat(run.length)));
			// Her sınırlayıcının ardına boş bir yuva açılıyor: eşleşme sonucu
			// oluşan vurgu düğümü buraya girecek. Böylece iç içe vurgularda
			// (`***a***`) dıştaki eşleşme, içteki düğümü aradaki yuvada bulur.
			slots.push([]);
			i += run.length;
			continue;
		}

		buffer += ch;
		i++;
	}

	flush();
	return { slots, delimiters };
}

function makeAutolink(url: string, label: string): Link {
	return {
		type: "link",
		url,
		title: null,
		children: [text(label)],
		syntax: { style: "autolink" },
	};
}

/**
 * Kod span okur: açılış ters tırnak dizisi, aynı uzunlukta kapanışla eşleşir.
 *
 * İçerikte tek boşluk kırpması CommonMark kuralı: `` ` `a` ` `` → `` `a` ``,
 * böylece ters tırnakla başlayan kod yazılabilir.
 */
function readCodeSpan(raw: string, start: number): { node: InlineCode; next: number } | null {
	let openLength = 0;
	while (raw[start + openLength] === "`") openLength++;

	let i = start + openLength;
	while (i < raw.length) {
		if (raw[i] !== "`") {
			i++;
			continue;
		}
		let closeLength = 0;
		while (raw[i + closeLength] === "`") closeLength++;

		if (closeLength === openLength) {
			let value = raw.slice(start + openLength, i);
			// Satır sonları boşluğa dönüşür; baştaki ve sondaki tek boşluk atılır.
			value = value.replace(/\n/g, " ");
			if (
				value.length >= 2 &&
				value.startsWith(" ") &&
				value.endsWith(" ") &&
				value.trim() !== ""
			) {
				value = value.slice(1, -1);
			}
			return {
				node: { type: "inlineCode", value, syntax: { fenceLength: openLength } },
				next: i + closeLength,
			};
		}
		i += closeLength;
	}
	// Kapanış yoksa ters tırnaklar düz metindir.
	return null;
}

/**
 * Sınırlayıcı dizisinin açış/kapanış olabilirliğini belirler.
 *
 * CommonMark'ın kuralı komşu karakterlerin türüne bakar: boşluk, noktalama,
 * ya da diğer. `_` için ek kısıt vardır — kelime içindeki alt çizgi vurgu
 * açmaz, böylece `dosya_adi_uzun` bozulmaz.
 */
function readDelimiterRun(
	raw: string,
	start: number,
	marker: string,
): { length: number; canOpen: boolean; canClose: boolean } {
	let length = 0;
	while (raw[start + length] === marker) length++;

	const before = start === 0 ? "\n" : (raw[start - 1] as string);
	const afterIndex = start + length;
	const after = afterIndex >= raw.length ? "\n" : (raw[afterIndex] as string);

	const beforeWhitespace = UNICODE_WHITESPACE.test(before);
	const afterWhitespace = UNICODE_WHITESPACE.test(after);
	const beforePunctuation = PUNCTUATION.test(before);
	const afterPunctuation = PUNCTUATION.test(after);

	// "Sol taraflı" ve "sağ taraflı" dizi tanımları — CommonMark 6.2.
	const leftFlanking =
		!afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
	const rightFlanking =
		!beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);

	if (marker === "_") {
		// Alt çizgi kelime ortasında vurgu açmaz/kapatmaz: `dosya_adi_uzun`.
		return {
			length,
			canOpen: leftFlanking && (!rightFlanking || beforePunctuation),
			canClose: rightFlanking && (!leftFlanking || afterPunctuation),
		};
	}
	return { length, canOpen: leftFlanking, canClose: rightFlanking };
}

// ---------------------------------------------------------------------------
// 2. geçiş — sınırlayıcı eşleştirme
// ---------------------------------------------------------------------------

/**
 * CommonMark'ın vurgu algoritması.
 *
 * Kapanış adaylarını soldan sağa gezer; her biri için **en yakın** uygun açışı
 * geriye doğru arar. Eşleşince aradaki düğümler `strong` (iki karakter) ya da
 * `emphasis` (bir karakter) içine alınır ve sınırlayıcılar tüketilir.
 *
 * "Üçün kuralı": açış ve kapanış dizilerinden biri hem açış hem kapanış
 * olabiliyorsa, uzunlukları toplamı 3'ün katı olduğunda eşleşme reddedilir.
 * `*foo**bar*` gibi girdilerin doğru çözülmesi buna bağlı.
 */
function resolveEmphasis(slots: Slots, delimiters: Delimiter[]): void {
	for (let closerIndex = 0; closerIndex < delimiters.length; closerIndex++) {
		const closer = delimiters[closerIndex] as Delimiter;
		if (!closer.active || !closer.canClose || closer.length === 0) continue;

		const openerIndex = findOpener(delimiters, closerIndex, closer);
		if (openerIndex === -1) continue;

		const opener = delimiters[openerIndex] as Delimiter;
		const useTwo = closer.marker !== "~" && opener.length >= 2 && closer.length >= 2;
		const used = closer.marker === "~" ? Math.min(opener.length, closer.length) : useTwo ? 2 : 1;

		wrap(slots, opener, closer, used);

		opener.length -= used;
		closer.length -= used;
		if (opener.length === 0) opener.active = false;
		if (closer.length === 0) closer.active = false;

		// Aradaki eşleşmemiş sınırlayıcılar artık kullanılamaz.
		for (let k = openerIndex + 1; k < closerIndex; k++) {
			(delimiters[k] as Delimiter).active = false;
		}

		// Kapanışta karakter kaldıysa aynı kapanışla tekrar denenir.
		if (closer.length > 0) closerIndex--;
	}
}

/** Kapanışa en yakın uygun açışı geriye doğru arar. */
function findOpener(delimiters: Delimiter[], closerIndex: number, closer: Delimiter): number {
	for (let i = closerIndex - 1; i >= 0; i--) {
		const candidate = delimiters[i] as Delimiter;
		if (!candidate.active || !candidate.canOpen || candidate.length === 0) continue;
		if (candidate.marker !== closer.marker) continue;

		// Üçün kuralı — CommonMark 6.2, "multiple of 3" kısıtı.
		if (
			(closer.canOpen || candidate.canClose) &&
			(candidate.length + closer.length) % 3 === 0 &&
			!(candidate.length % 3 === 0 && closer.length % 3 === 0)
		) {
			continue;
		}
		return i;
	}
	return -1;
}

/**
 * Açış ve kapanış arasındaki düğümleri vurgu düğümüne sarar.
 *
 * Sonuç düğümü **açış yuvasının sonuna** eklenir; kapanış yuvasında
 * tüketilmemiş sınırlayıcı karakterleri kalabilir ve onlar sarmalanan
 * düğümden sonra gelmelidir.
 */
function wrap(slots: Slots, opener: Delimiter, closer: Delimiter, used: number): void {
	trimOpener(slots, opener, used);
	trimCloser(slots, closer, used);

	const inner: Inline[] = [];
	for (let i = opener.index + 1; i < closer.index; i++) {
		const slot = slots[i];
		if (slot !== undefined) {
			inner.push(...slot);
			slots[i] = [];
		}
	}

	const marker = opener.marker;
	const children = mergeText(inner);
	const wrapped: Inline =
		marker === "~"
			? { type: "delete", children }
			: used === 2
				? { type: "strong", children, syntax: { marker } }
				: { type: "emphasis", children, syntax: { marker } };

	// Açış sınırlayıcısının hemen ardındaki yuvaya konur — kapanış yuvasına
	// değil: kapanışta tüketilmemiş karakterler kalabilir ve onlar sarmalanan
	// düğümden SONRA gelmelidir.
	(slots[opener.index + 1] as Inline[]).push(wrapped);
}

/** Açışta tüketilen sınırlayıcı karakterlerini sondan düşürür. */
function trimOpener(slots: Slots, delimiter: Delimiter, used: number): void {
	const slot = slots[delimiter.index];
	if (slot === undefined) return;
	const node = slot[slot.length - 1];
	if (node === undefined || node.type !== "text") return;
	node.value = node.value.slice(0, node.value.length - used);
	if (node.value === "") slot.pop();
}

/** Kapanışta tüketilen sınırlayıcı karakterlerini baştan düşürür. */
function trimCloser(slots: Slots, delimiter: Delimiter, used: number): void {
	const slot = slots[delimiter.index];
	if (slot === undefined) return;
	const node = slot[0];
	if (node === undefined || node.type !== "text") return;
	node.value = node.value.slice(used);
	if (node.value === "") slot.shift();
}

// ---------------------------------------------------------------------------
// Toparlama
// ---------------------------------------------------------------------------

/** Yuvaları düzleştirip metinleri birleştirir. */
function compact(slots: Slots): Inline[] {
	return mergeText(slots.flat());
}

/**
 * Boş metinleri atar, ardışık metin düğümlerini tek düğümde birleştirir.
 *
 * Hem en dış listede hem her vurgu düğümünün çocuklarında uygulanır:
 * `*foo**bar*` içinde `foo`, `**` ve `bar` ayrı belirteçlerden gelir ama
 * sonuçta tek bir metin düğümü olmalıdır.
 */
function mergeText(nodes: readonly Inline[]): Inline[] {
	const out: Inline[] = [];
	for (const node of nodes) {
		if (node.type === "text" && node.value === "") continue;

		const last = out[out.length - 1];
		if (last !== undefined && last.type === "text" && node.type === "text") {
			last.value += node.value;
			continue;
		}
		out.push(node);
	}
	return out;
}
