/**
 * @kalem-editor/editor — Yapıştırma boru hattı  (İş listesi: F3-07)
 *
 * Word'den, Google Docs'tan, bir web sayfasından ya da düz metin olarak
 * gelen içeriği modele çevirir. F1-09'daki `@kalem-editor/core/html`
 * dönüştürücüsünün editöre bağlandığı yer.
 *
 * ## Neden tarayıcıya bırakılamıyor
 *
 * `contenteditable`'ın kendi yapıştırması HTML'i olduğu gibi DOM'a
 * gömüyor: Word'ün `mso-*` stilleri, iç içe onlarca boş `<span>`, `<o:p>`
 * etiketleri, gizli `<style>` blokları. Sonra `readInline` bunları
 * okumaya çalışıyor ve elinde kalan ya çöp ya da hiç. Yapıştırmanın
 * tamamı bu yüzden **modelde** yapılıyor: HTML → AST → belge.
 *
 * ## Kaynak tespiti neden gerekli
 *
 * Hepsi "HTML" olsa da farklı şeyler istiyorlar:
 *
 * - **Word / Google Docs** — biçim taşınmalı ama çöpü atılmalı.
 * - **Kalem'in kendisi** — kendi ürettiğimiz HTML zaten temiz.
 * - **Düz metin** — HTML yok; burada asıl soru metnin *Markdown mı*
 *   olduğu.
 *
 * ## Düz metin Markdown olarak ayrıştırılsın mı
 *
 * Varsayılan **evet, ama yalnızca metin gerçekten Markdown'a benziyorsa**
 * (`looksLikeMarkdown`). Her düz metni ayrıştırmak, `2 * 3 * 4` yazan
 * kullanıcının `3` ünü italik yapıyor — sessiz ve kızdırıcı bir veri
 * kaybı. Hiç ayrıştırmamak ise bir Markdown dosyasını yapıştırınca
 * kullanıcının bütün başlıklarını düz metne çeviriyor. Sezgisel olan,
 * ikisinin arasındaki tek makul yer.
 */
import type { Block, Inline, Paragraph, Root } from "@kalem-editor/core";
import { nodeAtPath, parse, replaceAt } from "@kalem-editor/core";
import { fromHtml } from "@kalem-editor/core/html";
import type { Caret, EditResult } from "./block-edit.js";
import { komsulukTazele } from "./block-edit.js";
import { newId } from "./ids.js";
import { inlineLength, listLength, sliceInline, spliceInline } from "./inline-edit.js";

/** Yapıştırılan içeriğin geldiği yer. */
export type PasteSource = "word" | "gdocs" | "html" | "markdown" | "text";

export interface PasteInput {
	/** `text/html` — yoksa boş dize. */
	readonly html: string;
	/** `text/plain` — yoksa boş dize. */
	readonly text: string;
}

export interface PasteOptions {
	/** Biçimi at, yalnızca metni al (Ctrl+Shift+V). */
	readonly plainOnly?: boolean;
	/**
	 * Düz metni Markdown olarak ayrıştır (varsayılan açık).
	 *
	 * Kapatınca yapıştırılan `# Başlık` metni başlık olmuyor, `# Başlık`
	 * yazısı oluyor.
	 */
	readonly parseMarkdown?: boolean;
}

// ---------------------------------------------------------------------------
// Kaynak tespiti
// ---------------------------------------------------------------------------

/**
 * Word'ün imzaları.
 *
 * Word sürümden sürüme farklı çıktı veriyor ama bu üçünden en az biri her
 * sürümde var: ad alanı bildirimi, üretici etiketi ve `Mso` sınıfları.
 */
const WORD = /urn:schemas-microsoft-com:office|content=["']?Microsoft\s+Word|class=["']?Mso|mso-/i;
/** Google Docs yapıştırmanın tamamını bu kimlikle sarıyor. */
const GDOCS = /id=["']?docs-internal-guid-/i;

export function detectPasteSource(input: PasteInput): PasteSource {
	if (input.html !== "") {
		if (GDOCS.test(input.html)) return "gdocs";
		if (WORD.test(input.html)) return "word";
		return "html";
	}
	return looksLikeMarkdown(input.text) ? "markdown" : "text";
}

/**
 * Metin Markdown'a benziyor mu.
 *
 * Aranan şey **satır başındaki yapısal işaretler**: başlık, liste, alıntı,
 * kod çiti, yatay çizgi. Satır içi `*` ve `_` bilerek dışarıda: `2 * 3 * 4`
 * ya da `dosya_adi_burada` yazan kullanıcının metnini bozmak, kazanılan
 * kolaylıktan çok daha pahalı.
 *
 * Tek istisna satır içi kod ve bağlantı: ikisi de kendine özgü ve yanlışlıkla
 * yazılması zor.
 */
const MARKDOWN_ISARETLERI: readonly RegExp[] = [
	/^#{1,6}\s+\S/m, // başlık
	/^\s{0,3}[-*+]\s+\S/m, // madde imli liste
	/^\s{0,3}\d+[.)]\s+\S/m, // numaralı liste
	/^\s{0,3}>\s?\S/m, // alıntı
	/^\s{0,3}(?:```|~~~)/m, // kod çiti
	/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m, // yatay çizgi
	/\[[^\]\n]+\]\([^)\s]+\)/, // bağlantı
	/`[^`\n]+`/, // satır içi kod
];

export function looksLikeMarkdown(text: string): boolean {
	if (text.trim() === "") return false;
	return MARKDOWN_ISARETLERI.some((kalip) => kalip.test(text));
}

// ---------------------------------------------------------------------------
// Parçanın üretimi
// ---------------------------------------------------------------------------

/**
 * Yapıştırılacak içeriği belge parçasına çevirir.
 *
 * `parseHtml`, HTML metnini DOM'a çeviren fonksiyon; çağıran veriyor
 * çünkü `@kalem-editor/core/html` bilerek DOM tanımıyor (F1-09). Tarayıcıda
 * `DOMParser`, testte düz nesneler.
 */
export function pasteFragment(
	input: PasteInput,
	parseHtml: (html: string) => Parameters<typeof fromHtml>[0] | null,
	options: PasteOptions = {},
): Root {
	const kaynak = options.plainOnly === true ? "text" : detectPasteSource(input);

	if (kaynak === "word" || kaynak === "gdocs" || kaynak === "html") {
		const agac = parseHtml(input.html);
		if (agac !== null) {
			const parca = fromHtml(agac);
			// HTML'den hiçbir blok çıkmadıysa metne düşülüyor: boş bir
			// yapıştırma, kullanıcının kopyaladığı şeyin kaybolması demek.
			if (parca.children.length > 0) return parca;
		}
	}

	const metin = input.text;
	if (metin === "") return { type: "root", children: [] };

	const markdown =
		options.plainOnly !== true &&
		options.parseMarkdown !== false &&
		(kaynak === "markdown" || looksLikeMarkdown(metin));
	return markdown ? parse(metin) : duzMetinBelgesi(metin);
}

/**
 * Düz metni paragraflara çevirir.
 *
 * Boş satır paragrafı, tek satır sonu **sert satır sonu** oluyor: bir
 * e-postadan kopyalanan metin, satır yapısını koruyarak gelmeli.
 */
function duzMetinBelgesi(text: string): Root {
	const parcalar = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
	const children: Block[] = [];
	for (const parca of parcalar) {
		if (parca.trim() === "") continue;
		const satirlar = parca.split("\n");
		const inline: Inline[] = [];
		for (const [i, satir] of satirlar.entries()) {
			if (i > 0) inline.push({ type: "break" });
			inline.push({ type: "text", value: satir });
		}
		children.push({ type: "paragraph", children: inline });
	}
	return { type: "root", children };
}

// ---------------------------------------------------------------------------
// Belgeye yerleştirme
// ---------------------------------------------------------------------------

/** Bir bloğun satır içi içeriği — yoksa `null`. */
function inlineOf(node: unknown): readonly Inline[] | null {
	const children = (node as { children?: readonly unknown[] } | undefined)?.children;
	if (!Array.isArray(children)) return null;
	const tur = (node as { type?: string }).type;
	return tur === "paragraph" || tur === "heading" ? (children as Inline[]) : null;
}

/**
 * Parçayı imlece yerleştirir.
 *
 * İki durum var ve ikisi de kullanıcının beklediği şeyi yapıyor:
 *
 * - **Tek paragraflık parça** satır içi ekleniyor. Bir kelime kopyalayıp
 *   cümlenin ortasına yapıştıran kullanıcı yeni bir paragraf istemiyor.
 * - **Çok bloklu parça** imlecin bulunduğu bloğu bölüyor ve araya
 *   giriyor. İlk parça blok içine, son parça bölünmenin ikinci yarısının
 *   önüne kaynıyor; aradakiler olduğu gibi blok oluyor.
 *
 * `caret.offset` blok içi satır içi konumu; parça boşsa `null` dönüyor.
 */
export function insertFragment(doc: Root, caret: Caret, fragment: Root): EditResult | null {
	if (fragment.children.length === 0) return null;

	const blok = doc.children[caret.blockIndex];
	if (blok === undefined) return null;
	if (caret.path.length > 0) return icineYapistir(doc, caret, fragment);
	const mevcut = inlineOf(blok);

	// Metin taşımayan bloğa (yatay çizgi, kod) satır içi yapıştırma yok;
	// parça blok olarak araya giriyor.
	if (mevcut === null) {
		return bloklariAraSok(doc, caret.blockIndex + 1, fragment.children as Block[], caret);
	}

	const ilk = fragment.children[0];
	const ilkInline = inlineOf(ilk);

	// --- Boş bloğa yapıştırma: parça olduğu gibi yerine geçiyor ----------
	//
	// Boş bir belgeye doküman yapıştıran kullanıcı başlıklarını kaybetmemeli.
	// Aşağıdaki kaynaştırma, parçanın ilk bloğunu **hedefin** türüyle
	// birleştiriyor; hedef boş bir paragrafsa o tür bir bilgi taşımıyor ve
	// yapıştırılan `# Başlık` düz paragrafa dönüşüyordu.
	if (listLength(mevcut) === 0) {
		const yeni = fragment.children.map((b) => yeniKimlik(b as Block));
		const children = komsulukTazele(doc.children, [
			...doc.children.slice(0, caret.blockIndex),
			...yeni,
			...doc.children.slice(caret.blockIndex + 1),
		] as Block[]);
		const sonYeni = yeni[yeni.length - 1];
		const sonYeniInline = inlineOf(sonYeni);
		return {
			doc: { ...doc, children: children as Root["children"] },
			caret: {
				blockIndex: caret.blockIndex + yeni.length - 1,
				path: [],
				offset: sonYeniInline === null ? 0 : listLength(sonYeniInline),
			},
		};
	}

	// --- Tek paragraflık parça: satır içi ekleme -------------------------
	if (fragment.children.length === 1 && ilkInline !== null) {
		const yeni = spliceInline(mevcut, caret.offset, caret.offset, [...ilkInline]);
		const uzunluk = ilkInline.reduce((t, n) => t + inlineLength(n), 0);
		return {
			doc: {
				...doc,
				children: doc.children.map((c, i) =>
					i === caret.blockIndex ? ({ ...(c as object), children: yeni } as never) : c,
				) as Root["children"],
			},
			caret: { ...caret, offset: caret.offset + uzunluk },
		};
	}

	// --- Çok bloklu parça: bloğu böl, araya gir --------------------------
	//
	// Üretilen blok dizisi baştan sona tek geçişte kuruluyor. Önceki hâli
	// "baş + orta + kuyruk" ifadelerini ayrı ayrı hesaplıyordu ve tek
	// bloklu parçada ilk ile son aynı düğüm olduğu için onu **iki kez**
	// ekliyordu.
	const solda = sliceInline(mevcut, 0, caret.offset);
	const sagda = sliceInline(mevcut, caret.offset, listLength(mevcut));

	const adet = fragment.children.length;
	const son = fragment.children[adet - 1];
	const sonInline = inlineOf(son);
	const uretilen: Block[] = [];

	/*
	 * Kaynaştırma yalnızca **kaynaşacak bir şey varken** yapılıyor.
	 *
	 * Bir bloğun ortasına yapıştıran kullanıcı parçanın ilk cümlesini
	 * bulunduğu paragrafın içinde görmek istiyor. Ama imleç bloğun
	 * başındaysa hedefin katacağı hiçbir şey yok ve kaynaştırmak yalnızca
	 * parçanın **türünü** yok ediyor: yapıştırılan `# Başlık` hedef
	 * paragraf olduğu için düz metne dönüşüyor. Aynısı sonda da geçerli.
	 */
	const solBos = listLength(solda) === 0;
	const sagBos = listLength(sagda) === 0;

	// Baş
	if (solBos) {
		if (ilk !== undefined) uretilen.push(yeniKimlik(ilk as Block));
	} else if (ilkInline !== null) {
		uretilen.push(blokIcerikle(blok as Block, [...solda, ...ilkInline]));
	} else {
		// Liste ya da kod satır içine kaynayamaz; sol yarı kendi başına kalıyor.
		uretilen.push(blokIcerikle(blok as Block, solda));
		if (ilk !== undefined) uretilen.push(yeniKimlik(ilk as Block));
	}

	for (const orta of fragment.children.slice(1, adet - 1)) {
		uretilen.push(yeniKimlik(orta as Block));
	}

	// Kuyruk
	let sonOfset = 0;
	if (adet > 1) {
		if (son !== undefined && (sagBos || sonInline === null)) {
			uretilen.push(yeniKimlik(son as Block));
			if (!sagBos) uretilen.push(yeniPara(sagda));
		} else if (sonInline !== null) {
			uretilen.push(yeniPara([...sonInline, ...sagda]));
		}
		if (sonInline !== null) sonOfset = listLength(sonInline);
	} else if (!sagBos) {
		uretilen.push(yeniPara(sagda));
	}

	const children = komsulukTazele(doc.children, [
		...doc.children.slice(0, caret.blockIndex),
		...uretilen,
		...doc.children.slice(caret.blockIndex + 1),
	] as Block[]);

	// İmleç yapıştırılanın **sonuna** gidiyor: kullanıcı yazmaya oradan
	// devam ediyor.
	return {
		doc: { ...doc, children: children as Root["children"] },
		caret: {
			blockIndex: caret.blockIndex + uretilen.length - 1,
			path: [],
			offset: sonOfset,
		},
	};
}

/**
 * İç içe bir taşıyıcıya (tablo hücresi, liste maddesi, alıntı paragrafı)
 * yapıştırma: parça imlecin olduğu yere **satır içi** giriyor.
 *
 * Eskiden üst bloğa bakılıyordu; tablo metin taşımadığı için parça
 * tablonun **altına** blok olarak ekleniyordu ve kullanıcı hücreye
 * yapıştırdığı değeri belgenin başka bir yerinde buluyordu. Hücre blok
 * tutamıyor; çok bloklu parçanın her bloğu ayrı bir satır (sert satır
 * sonu) oluyor, liste maddeleri `• ` ile. Liste maddesi ve alıntıda da
 * aynısı: imlecin yerinden kaçmamak, yapıyı korumaktan önemli.
 */
function icineYapistir(doc: Root, caret: Caret, fragment: Root): EditResult | null {
	const yol = [caret.blockIndex, ...caret.path];
	const hedef = nodeAtPath(doc, yol) as { children?: readonly Inline[] } | undefined;
	if (hedef === undefined || !Array.isArray(hedef.children)) return null;

	const satirlar = fragment.children.flatMap((b) => satirlarOf(b as Block));
	const eklenen: Inline[] = satirlar.flatMap((satir, i) =>
		i === 0 ? satir : [{ type: "break" } as Inline, ...satir],
	);
	if (eklenen.length === 0) return null;

	const yeni = spliceInline(hedef.children, caret.offset, caret.offset, eklenen);
	return {
		doc: replaceAt(doc, yol, { ...(hedef as object), children: yeni } as never),
		caret: { ...caret, offset: caret.offset + listLength(eklenen) },
	};
}

/** Bir bloğun satır içi satırları; kaplar kendi bloklarına iniyor. */
function satirlarOf(blok: Block): Inline[][] {
	const satirIci = inlineOf(blok);
	if (satirIci !== null) return satirIci.length === 0 ? [] : [[...satirIci]];
	switch (blok.type) {
		case "code":
		case "html":
			return blok.value === ""
				? []
				: blok.value.split("\n").map((v): Inline[] => [{ type: "text", value: v }]);
		case "list":
			return blok.children.flatMap((madde) =>
				madde.children.flatMap((b, i) =>
					satirlarOf(b).map((satir, j): Inline[] =>
						i === 0 && j === 0 ? [{ type: "text", value: "• " }, ...satir] : satir,
					),
				),
			);
		case "blockquote":
			return blok.children.flatMap((b) => satirlarOf(b));
		case "table":
			// Satır başına bir satır, hücreler ` | ` ile.
			return blok.children.map((row) =>
				row.children.flatMap((cell, i): Inline[] =>
					i === 0 ? [...cell.children] : [{ type: "text", value: " | " }, ...cell.children],
				),
			);
		default:
			return [];
	}
}

/** Bloğun türünü ve kimliğini koruyup içeriğini değiştirir. */
function blokIcerikle(blok: Block, children: readonly Inline[]): Block {
	// Konum düşüyor: içeriği değişen bloğun eski satır aralığı yalan.
	const { position: _atilan, ...kalan } = blok as Block & { position?: unknown };
	return { ...kalan, children: [...children] } as Block;
}

function yeniKimlik(blok: Block): Block {
	// Konum düşürülüyor: yapıştırılan bloğun kaynak belgedeki satır numarası
	// bu belgede yalan (F3-04'teki kuralın aynısı).
	const { position: _atilan, ...kalan } = blok as Block & { position?: unknown };
	return { ...kalan, id: newId() } as Block;
}

function yeniPara(children: readonly Inline[]): Paragraph & { id: string } {
	return { type: "paragraph", children: [...children], id: newId() } as Paragraph & { id: string };
}

function bloklariAraSok(
	doc: Root,
	at: number,
	bloklar: readonly Block[],
	caret: Caret,
): EditResult {
	const yeni = bloklar.map(yeniKimlik);
	return {
		doc: {
			...doc,
			children: [
				...doc.children.slice(0, at),
				...yeni,
				...doc.children.slice(at),
			] as Root["children"],
		},
		caret: { blockIndex: at + yeni.length - 1, path: caret.path, offset: 0 },
	};
}
