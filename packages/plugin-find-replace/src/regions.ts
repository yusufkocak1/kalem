/**
 * @kalem/plugin-find-replace — Aranabilir bölgeler  (İş listesi: F4-03)
 *
 * Belgeyi, arama için **düz metin parçalarına** çeviriyor. Her parça bir
 * taşıyıcıya karşılık geliyor: paragraf ve başlık (satır içi) ya da
 * kod/HTML/frontmatter bloğu (kaynak metin).
 *
 * Ölçüt tek: **değiştirilebiliyor mu.** Bulunup değiştirilemeyen metin,
 * kullanıcı için kırık bir özellik; o yüzden değiştirilemeyen hiçbir şey
 * aranmıyor da (aşağıdaki iki not).
 *
 * ## Ofsetler editörün kuralına uyuyor
 *
 * Metin karakteri 1, `break` 1, görsel 1 — `inline-edit.ts` ve
 * `offsets.ts` ile **aynı** kural. Görsel arama metninde U+FFFC (nesne
 * yer tutucu) olarak duruyor: ofsetler hizalı kalıyor ve düz bir arama
 * görselin üstünden geçip onu eşleşmeye katamıyor. Uymak zorunda: bulunan aralık
 * doğrudan `spliceInline`a ve imleç konumuna gidiyor, bir karakter kayma
 * yanlış yeri değiştirmek demek.
 *
 * ## Bağlantı tanımları neden dışarıda
 *
 * `definition` bloğu (`[etiket]: adres`) ekranda kaynak metin gibi
 * görünüyor ama modelde üç ayrı alan (`label`, `url`, `title`).
 * Değiştirmek için o metni geri ayrıştırmak gerekirdi — yani bu eklentide
 * ikinci bir Markdown ayrıştırıcısı. Aranıyor ama **değiştirilemiyor**
 * demek de kullanıcıya yalan söylemek olurdu; bu yüzden hiç taranmıyor.
 *
 * ## Tablolar neden dışarıda
 *
 * Aynı gerekçenin daha sert hâli. Tablo modelde hücre hücre duruyor ama
 * serileştirici onu **ham metinden** geri yazıyor (`TableSyntax.raw`):
 * v1'de tablo düzenleme arayüzü yok (Karar #5) ve ayrıştırıcı, hücre
 * dolgusunu ve boru hizasını bozmamak için kaynağı saklıyor. Yani bir
 * hücrenin içeriğini değiştirmek modelde görünüyor, çıktıda görünmüyor.
 *
 * Üç seçenek vardı: (1) tabloda arayıp değiştirememek — kullanıcıya
 * yalan; (2) ham metni düşürüp tabloyu yeniden üretmek — kullanıcının
 * hizalamasını, bir kelime değiştirdiği için bozmak; (3) taramamak.
 * Üçüncüsü seçildi ve `@kalem/plugin-table` (v1.1) geldiğinde ilk
 * kaldırılacak sınır bu.
 */
import type { Block, Inline, Root } from "@kalem/core";
import { nodeAtPath, replaceAt } from "@kalem/core";
import type { Caret, EditResult } from "@kalem/editor";
import { inlineLength, normalizeInline, sliceInline } from "@kalem/editor";

/** `break` düğümünün arama metnindeki karşılığı (1 karakter, editörle aynı). */
const SATIR_SONU = String.fromCharCode(10);

/** Görselin arama metnindeki karşılığı: U+FFFC OBJECT REPLACEMENT CHARACTER. */
const NESNE = String.fromCharCode(0xfffc);

/**
 * Aranabilir bir metin parçası.
 *
 * `kind` değiştirmenin nasıl yapılacağını söylüyor: satır içi taşıyıcıda
 * `spliceInline`, kaynak blokta düz dize değişimi.
 */
export interface Region {
	readonly blockIndex: number;
	/** Blok kökünden taşıyıcıya giden yol — `Caret.path` ile aynı. */
	readonly path: readonly number[];
	readonly kind: "inline" | "source";
	/** Ofset hizalı düz metin. */
	readonly text: string;
	/**
	 * Atomik düğümlerin ofsetleri (görsel, görsel referansı).
	 *
	 * Arama metninde U+FFFC olarak duruyorlar. Düz bir arama onları hiç
	 * kapsamaz; yine de değiştirme bunları **koruyor** (`replaceInRegion`),
	 * çünkü düzenli ifade gibi geniş bir eşleşme onları kapsayabilir ve
	 * görselin sessizce silinmesi veri kaybı olurdu.
	 */
	readonly atomics: readonly number[];
}

/** Satır içi içerik taşıyan blok türleri — `render.ts` ile aynı küme. */
const SATIR_ICI = new Set(["paragraph", "heading"]);

/** İçeriği yapı değil kaynak metin olan bloklar (`definition` hariç, bkz. üst not). */
const KAYNAK = new Set(["code", "html", "yaml", "toml"]);

/**
 * Belgedeki bütün aranabilir bölgeler, **belge sırasında**.
 *
 * Sıra sözleşmenin parçası: "sonraki eşleşme" tuşu bu sıraya güveniyor ve
 * kullanıcı belgede yukarıdan aşağı ilerlemeyi bekliyor.
 */
export function regionsOf(doc: Root): Region[] {
	const out: Region[] = [];
	for (const [blockIndex, block] of doc.children.entries()) {
		topla(block as Block, blockIndex, [], out);
	}
	return out;
}

function topla(node: Block, blockIndex: number, path: readonly number[], out: Region[]): void {
	if (SATIR_ICI.has(node.type)) {
		const children = (node as { children: readonly Inline[] }).children;
		const { text, atomics } = duzMetin(children);
		out.push({ blockIndex, path, kind: "inline", text, atomics });
		return;
	}

	if (KAYNAK.has(node.type)) {
		const value = (node as { value?: string }).value ?? "";
		out.push({ blockIndex, path, kind: "source", text: value, atomics: [] });
		return;
	}

	// Tablo taranmıyor (dosya başındaki gerekçe): değiştirilemediği için
	// bulunması da kullanıcıyı yanıltırdı.
	if (node.type === "table") return;

	// Blockquote ve liste: çocuklar da blok, yol uzuyor.
	const children = (node as { children?: readonly unknown[] }).children;
	if (!Array.isArray(children)) return;
	for (const [i, child] of children.entries()) {
		topla(child as Block, blockIndex, [...path, i], out);
	}
}

/** Satır içi listenin ofset hizalı düz metni. */
function duzMetin(nodes: readonly Inline[]): { text: string; atomics: number[] } {
	let text = "";
	const atomics: number[] = [];

	const gez = (liste: readonly Inline[]): void => {
		for (const node of liste) {
			switch (node.type) {
				case "text":
				case "inlineCode":
				case "html":
					text += node.value;
					break;
				case "break":
					text += SATIR_SONU;
					break;
				case "image":
				case "imageReference":
					atomics.push(text.length);
					text += NESNE;
					break;
				default:
					gez((node as { children: readonly Inline[] }).children);
			}
		}
	};

	gez(nodes);
	return { text, atomics };
}

/** Bölgenin belge kökünden yolu. */
function yol(region: Region): number[] {
	return [region.blockIndex, ...region.path];
}

/** Bölgedeki bir konumun imleç karşılığı. */
export function caretAt(region: Region, offset: number): Caret {
	return { blockIndex: region.blockIndex, path: region.path, offset };
}

/**
 * Bölgenin `[from, to)` aralığını verilen metinle değiştirir.
 *
 * ## Biçim
 *
 * Eşleşme tek bir metin düğümünün içindeyse (yaygın durum) değişiklik
 * **yerinde** yapılıyor ve biçim korunuyor: `**kedi**` içinde "kedi"
 * değiştirilince kalınlık duruyor.
 *
 * Eşleşme biçim sınırını aşıyorsa (`**ka**lın` içinde `kalın`) o aralık
 * düz metne dönüyor. Alternatifi, eşleşmenin ilk karakterinin biçimini
 * devralmaktı; iki karakteri iki ayrı biçimde olan bir eşleşmede
 * hangisinin kazandığı keyfî kalıyor ve "değiştirdiğim kelime neden kalın
 * oldu" sorusu, düz metin sonucundan daha şaşırtıcı.
 */
export function replaceInRegion(
	doc: Root,
	region: Region,
	from: number,
	to: number,
	value: string,
): EditResult | null {
	const hedef = nodeAtPath(doc, yol(region));
	if (hedef === undefined) return null;

	if (region.kind === "source") {
		const mevcut = (hedef as { value?: string }).value ?? "";
		const yeniDeger = mevcut.slice(0, from) + value + mevcut.slice(to);
		return {
			doc: replaceAt(doc, yol(region), { ...(hedef as object), value: yeniDeger } as never),
			caret: caretAt(region, from + value.length),
		};
	}

	const children = (hedef as { children?: readonly Inline[] }).children;
	if (!Array.isArray(children)) return null;

	const yeni =
		yerindeDegistir(children, from, to, value) ?? spliceKoruyarak(children, from, to, value);
	return {
		doc: replaceAt(doc, yol(region), { ...(hedef as object), children: yeni } as never),
		caret: caretAt(region, from + value.length),
	};
}

/**
 * Eşleşme tek bir metin düğümünün içindeyse onu yerinde değiştirir.
 *
 * Asıl yol bu, `spliceKoruyarak` değil. Sebebi biçim: `**kedi**` içindeki
 * "kedi" aramasında aralık tam olarak `strong`un içeriğini kaplıyor ve
 * kesip yapıştıran yol sarmalayıcıyı da kesiyor — kullanıcı bir kelime
 * değiştirdiği için kalınlığın kaybolduğunu görüyor.
 *
 * Yerinde değişiklik, düğümün kendisini koruduğu için sarmalayıcılar da
 * duruyor; ayrıca `syntax` alanı (yani `*italik*` mi `_italik_` mi
 * yazıldığı) kayboluyor — bu istenen: metin değişince yazım tercihinin
 * korunması gerekiyor ve düğüm aynı kaldığı için korunuyor.
 *
 * Aralık birden çok düğüme yayılıyorsa `null` dönüyor ve çağıran kesme
 * yoluna düşüyor; orada biçim kaybı **kaçınılmaz**, çünkü iki farklı
 * biçimden hangisinin kazanacağı keyfî.
 */
function yerindeDegistir(
	nodes: readonly Inline[],
	from: number,
	to: number,
	value: string,
): Inline[] | null {
	let bulundu = false;

	const gez = (liste: readonly Inline[], taban: number): { nodes: Inline[]; uzunluk: number } => {
		const out: Inline[] = [];
		let offset = taban;

		for (const node of liste) {
			const uzunluk = inlineLength(node);
			const bas = offset;
			const bit = offset + uzunluk;
			offset = bit;

			if (bulundu) {
				out.push(node);
				continue;
			}

			const metinDugumu =
				node.type === "text" || node.type === "inlineCode" || node.type === "html";

			if (metinDugumu && bas <= from && to <= bit) {
				const deger = node.value;
				const yeniDeger = deger.slice(0, from - bas) + value + deger.slice(to - bas);
				// İçi boşalan bir düğüm listeden düşüyor: boş bir
				// `inlineCode` çıktıda `` `` `` üretir.
				if (yeniDeger !== "") out.push({ ...node, value: yeniDeger });
				bulundu = true;
				continue;
			}

			const children = (node as { children?: readonly Inline[] }).children;
			if (Array.isArray(children) && bas <= from && to <= bit) {
				const ic = gez(children, bas);
				out.push({ ...node, children: ic.nodes } as Inline);
				continue;
			}

			out.push(node);
		}

		return { nodes: out, uzunluk: offset - taban };
	};

	const sonuc = gez(nodes, 0);
	return bulundu ? normalizeInline(sonuc.nodes) : null;
}

/**
 * Aralığı değiştirirken sıfır uzunluklu düğümleri koruyor.
 *
 * `spliceInline` kullanılmıyor çünkü aralığın **içinde** kalan görseli
 * atardı. Kullanıcı görseli bir metin eşleşmesinin parçası saymıyor;
 * silinmesi veri kaybı olurdu. Yeni metnin **önüne** alınıyor.
 */
function spliceKoruyarak(
	children: readonly Inline[],
	from: number,
	to: number,
	value: string,
): Inline[] {
	const korunan = sliceInline(children, from, to).filter(
		(node) => node.type === "image" || node.type === "imageReference",
	);
	const ortadaki: Inline[] = [...korunan];
	if (value !== "") ortadaki.push({ type: "text", value });
	return normalizeInline([
		...sliceInline(children, 0, from),
		...ortadaki,
		// Kuyruğun üst sınırı `Infinity`: listenin tam sonunda duran sıfır
		// uzunluklu bir düğüm aksi hâlde düşerdi (`spliceInline` ile aynı
		// gerekçe).
		...sliceInline(children, to, Number.POSITIVE_INFINITY),
	]);
}
