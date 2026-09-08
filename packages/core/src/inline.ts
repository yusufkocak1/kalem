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

/**
 * Açık bir `[` ya da `![` — bağlantı/görsel adayı.
 *
 * Vurgu sınırlayıcıları gibi bunlar da ileriye bakmadan karara bağlanamaz:
 * `[a` bir bağlantı başlangıcı da olabilir, düz metin de.
 */
interface BracketMark {
	/** Köşeli ayracın bulunduğu yuva indisi. */
	readonly index: number;
	/** Görsel mi (`![`) bağlantı mı (`[`). */
	readonly image: boolean;
	/** Ham metindeki konumu — kapanışta metni geri okumak için. */
	readonly rawStart: number;
	/** Hâlâ eşleşebilir mi. */
	active: boolean;
}

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

/**
 * `](hedef "başlık")` — bağlantının kapanış kısmı.
 *
 * Hedef ya açılı ayraç içindedir ya da boşluk/parantez içermeyen bir dizidir.
 */
const LINK_TAIL =
	/^\]\([ \t]*(?:<([^<>\n]*)>|([^\s()]*))(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^()]*)\)))?[ \t]*\)/;

/** `][etiket]`, `][]` ya da yalnızca `]` — başvurulu bağlantının kapanışı. */
const REFERENCE_TAIL = /^\](?:\[((?:[^\\[\]]|\\.)*)\])?/;

/**
 * GFM otomatik bağlantı literali: çıplak `https://…`, `www.…` ve e-posta.
 *
 * Açılı ayraç gerektirmez — kullanıcı URL'yi düz yazar, bağlantıya dönüşür.
 * Kelime sınırı kontrolü çağıranın işi (`isLiteralBoundary`).
 */
const LITERAL_URL = /^(?:https?:\/\/|www\.)[^\s<]+/;
const LITERAL_EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/** Metin düğümü kısayolu. */
const text = (value: string): Text => ({ type: "text", value });

/**
 * Bağlantı etiketini eşleştirme için normalleştirir.
 *
 * `blocks.ts`'teki tanım tarafıyla **aynı kuralı** uygulamak zorunda: ikisi
 * ayrışırsa tanımlar başvurularla eşleşmez. CommonMark bu katlamayı
 * locale'den bağımsız ister; Türkçe kuralı uygulansaydı aynı belge başka
 * araçlarda farklı çözülürdü.
 */
function normalizeLabel(label: string): string {
	const sadelestirilmis = label.trim().replace(/[ \t\r\n]+/g, " ");
	// kalem-locale-ok: CommonMark etiket eşleştirmesi locale'den bağımsız olmalı
	return sadelestirilmis.toLowerCase();
}

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
	/** Henüz kapanmamış `[` / `![` yığını. */
	const brackets: BracketMark[] = [];
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

		// --- GFM otomatik bağlantı literali -------------------------------------
		if ((ch === "h" || ch === "w" || isEmailChar(ch)) && isLiteralBoundary(raw, i, buffer)) {
			const literal = readLiteralAutolink(raw, i);
			if (literal !== null) {
				flush();
				nodes.push(literal.node);
				i = literal.next;
				continue;
			}
		}

		// --- Bağlantı / görsel açılışı ------------------------------------------
		if (ch === "[" || (ch === "!" && raw[i + 1] === "[")) {
			const image = ch === "!";
			const marker = image ? "![" : "[";
			flush();
			brackets.push({ index: slots.length, image, rawStart: i, active: true });
			nodes.push(text(marker));
			i += marker.length;
			continue;
		}

		// --- Bağlantı / görsel kapanışı -----------------------------------------
		if (ch === "]") {
			// Ayraç içindeki metin henüz tamponda; kapanışı denemeden önce
			// yuvalara geçmeli, yoksa bağlantının çocukları boş kalır.
			flush();
			const open = takeActiveBracket(brackets);
			if (open !== null) {
				const consumed = closeBracket(raw, i, slots, delimiters, brackets, open);
				if (consumed !== null) {
					i = consumed;
					continue;
				}
			}
			buffer += ch;
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

/** E-posta yerel kısmında geçebilecek karakter mi. */
function isEmailChar(ch: string): boolean {
	return /[A-Za-z0-9._+-]/.test(ch);
}

/**
 * Literal bağlantı ancak **kelime sınırında** başlayabilir.
 *
 * Aksi hâlde `bahttps://x` gibi metinlerin ortasından bağlantı çıkardı.
 * Önceki karakter tampondan okunur; tampon boşsa metnin başındayız.
 */
function isLiteralBoundary(raw: string, index: number, buffer: string): boolean {
	if (index === 0) return true;
	const previous =
		buffer === "" ? (raw[index - 1] as string) : (buffer[buffer.length - 1] as string);
	return UNICODE_WHITESPACE.test(previous) || "*_~([".includes(previous);
}

/**
 * Literal bağlantıyı okur ve sondaki noktalamayı kırpar.
 *
 * `Şuraya bak: https://ornek.com.` cümlesindeki nokta URL'ye ait değildir.
 * GFM ayrıca dengesiz kapanış parantezini de kırpar: `(https://a.com/b)`
 * içindeki `)` bağlantının parçası olmamalı.
 */
function readLiteralAutolink(raw: string, start: number): { node: Link; next: number } | null {
	const rest = raw.slice(start);

	const url = LITERAL_URL.exec(rest);
	if (url !== null) {
		const trimmed = trimTrailingPunctuation(url[0]);
		if (trimmed === "") return null;
		const href = trimmed.startsWith("www.") ? `http://${trimmed}` : trimmed;
		return {
			node: {
				type: "link",
				url: href,
				title: null,
				children: [text(trimmed)],
				syntax: { style: "literal" },
			},
			next: start + trimmed.length,
		};
	}

	const mail = LITERAL_EMAIL.exec(rest);
	if (mail !== null) {
		// E-postanın sonundaki nokta ve tire alan adına ait değildir.
		const trimmed = mail[0].replace(/[.\-_]+$/, "");
		return {
			node: {
				type: "link",
				url: `mailto:${trimmed}`,
				title: null,
				children: [text(trimmed)],
				syntax: { style: "literal" },
			},
			next: start + trimmed.length,
		};
	}

	return null;
}

/** URL sonundaki cümle noktalamasını ve dengesiz parantezi kırpar. */
function trimTrailingPunctuation(url: string): string {
	let out = url;
	for (;;) {
		const before = out;
		out = out.replace(/[?!.,:*_~'"]+$/, "");
		if (out.endsWith(")")) {
			const opens = (out.match(/\(/g) ?? []).length;
			const closes = (out.match(/\)/g) ?? []).length;
			if (closes > opens) out = out.slice(0, -1);
		}
		if (out === before) return out;
	}
}

/** Yığındaki en yakın açık köşeli ayracı verir. */
function takeActiveBracket(brackets: BracketMark[]): BracketMark | null {
	for (let i = brackets.length - 1; i >= 0; i--) {
		const mark = brackets[i] as BracketMark;
		if (mark.active) return mark;
	}
	return null;
}

/**
 * `]` görüldüğünde bağlantıyı/görseli kapatmayı dener.
 *
 * Başarılıysa tüketilen konumu, değilse `null` döndürür — o zaman `]` düz
 * metindir. Üç biçim denenir: satır içi `](url)`, başvurulu `][etiket]`,
 * ve kısayol `[etiket]`.
 */
function closeBracket(
	raw: string,
	closeIndex: number,
	slots: Slots,
	delimiters: Delimiter[],
	brackets: BracketMark[],
	open: BracketMark,
): number | null {
	const rest = raw.slice(closeIndex);

	// Ayraçlar arasındaki metin — başvurulu biçimde etiket olarak kullanılır.
	const innerRaw = raw.slice(open.rawStart + (open.image ? 2 : 1), closeIndex);

	const inlineTail = LINK_TAIL.exec(rest);
	const refTail = inlineTail === null ? REFERENCE_TAIL.exec(rest) : null;
	if (inlineTail === null && refTail === null) return null;

	// Ayraç içindeki vurguları çöz, sonra düğümleri topla.
	resolveEmphasis(
		slots,
		delimiters.filter((d) => d.index > open.index),
	);
	const children = mergeText(slots.slice(open.index + 1).flat());
	slots.length = open.index;
	slots.push([]);

	// Bu ayraçtan sonraki sınırlayıcılar tüketildi.
	for (const d of delimiters) if (d.index > open.index) d.active = false;
	// İç içe bağlantı olmaz: dışta kalan açık ayraçlar da kapatılır.
	for (const b of brackets) if (b.index >= open.index) b.active = false;

	if (inlineTail !== null) {
		const url = inlineTail[1] ?? inlineTail[2] ?? "";
		const title = inlineTail[3] ?? inlineTail[4] ?? inlineTail[5] ?? null;
		const syntax = { style: "inline" } as const;
		(slots[open.index] as Inline[]).push(
			open.image
				? { type: "image", url, alt: plainText(children), title, syntax }
				: { type: "link", url, title, children, syntax },
		);
		return closeIndex + inlineTail[0].length;
	}

	const tail = refTail as RegExpExecArray;
	const explicit = tail[1];
	// `[a][b]` tam · `[a][]` daraltılmış · `[a]` kısayol
	const referenceType =
		explicit === undefined ? "shortcut" : explicit === "" ? "collapsed" : "full";
	const label = explicit === undefined || explicit === "" ? innerRaw : explicit;
	const identifier = normalizeLabel(label);

	(slots[open.index] as Inline[]).push(
		open.image
			? {
					type: "imageReference",
					identifier,
					label,
					alt: plainText(children),
					syntax: { referenceType },
				}
			: { type: "linkReference", identifier, label, children, syntax: { referenceType } },
	);
	return closeIndex + tail[0].length;
}

/** Görselin `alt` metni: alt ağaçtaki düz metnin birleşimi. */
function plainText(nodes: readonly Inline[]): string {
	let out = "";
	for (const node of nodes) {
		if (node.type === "text" || node.type === "inlineCode") out += node.value;
		else if ("children" in node) out += plainText(node.children);
		else if (node.type === "image") out += node.alt ?? "";
	}
	return out;
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
			// Dolgu boşluğu atıldıysa kaydedilir; yoksa geri yazarken kaybolur.
			const padded =
				value.length >= 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "";
			if (padded) value = value.slice(1, -1);
			return {
				node: { type: "inlineCode", value, syntax: { fenceLength: openLength, padded } },
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
			? { type: "delete", children, syntax: { length: used === 2 ? 2 : 1 } }
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
