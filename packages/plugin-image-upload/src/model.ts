/**
 * @kalem/plugin-image-upload — Model düzenlemeleri  (İş listesi: F4-01)
 *
 * Yüklemenin DOM'a ve ağa dokunmayan yarısı: dosyanın kabul edilip
 * edilmediği ve görsel düğümünün belgeye nasıl girip nasıl güncellendiği.
 *
 * Ayrı dosya olmasının sebebi test edilebilirlik: aşağıdaki her fonksiyon
 * girdi alıp çıktı veriyor, `File` ya da `fetch` taklit etmek gerekmiyor.
 */
import type { Image, Inline, Root } from "@kalem/core";
import type { Caret, EditResult } from "@kalem/editor";
import { spliceInline } from "@kalem/editor";

/** Yüklenecek dosyanın reddedilme sebebi. */
export type RejectReason = "type" | "size";

export interface AcceptOptions {
	/**
	 * Kabul edilen MIME önekleri (varsayılan `["image/"]`).
	 *
	 * Önek karşılaştırması yapılıyor, tam eşleşme değil: `image/` bütün
	 * görsel türlerini kapsıyor ve yarın çıkacak bir biçim için listeyi
	 * güncellemek gerekmiyor.
	 */
	readonly accept?: readonly string[];
	/** Bayt cinsinden üst sınır; verilmezse sınır yok. */
	readonly maxSize?: number;
}

/** Dosya kabul ediliyor mu; edilmiyorsa sebebi. */
export function rejectionOf(
	file: { type: string; size: number },
	options: AcceptOptions = {},
): RejectReason | null {
	const accept = options.accept ?? ["image/"];
	// kalem-locale-ok: MIME türleri ASCII; Türkçe kuralı burada zarar verir
	const tur = file.type.toLowerCase();
	if (!accept.some((onek) => tur.startsWith(onek))) return "type";
	if (options.maxSize !== undefined && file.size > options.maxSize) return "size";
	return null;
}

/**
 * Dosya adından alt metin üretir.
 *
 * Uzantı ve ayraçlar atılıyor: `tatil-fotografi_2.jpg` → `tatil fotografi 2`.
 * Bu iyi bir alt metin **değil** ve olduğunu iddia etmiyor; boş bırakmaktan
 * iyi olduğu için var. Kullanıcı görsele tıklayıp düzeltebiliyor ve arayüz
 * onu buna teşvik ediyor.
 */
export function altFromFilename(name: string): string {
	const uzantisiz = name.replace(/\.[^.]+$/, "");
	return uzantisiz.replace(/[_-]+/g, " ").trim();
}

/**
 * Görseli imlece ekler.
 *
 * İmleç yoksa (odak dışarıda, ya da metin taşımayan bir blokta) görsel
 * belgenin **sonuna kendi paragrafında** giriyor: sürüklenen bir dosyanın
 * sessizce kaybolması, yanlış yere düşmesinden kötü.
 */
export function insertImage(doc: Root, caret: Caret | null, image: Image): EditResult {
	const hedef = caret === null ? null : holderAt(doc, caret);

	if (hedef === null) {
		const children = [...doc.children, { type: "paragraph" as const, children: [image as Inline] }];
		return {
			doc: { ...doc, children: children as Root["children"] },
			caret: { blockIndex: children.length - 1, path: [], offset: 1 },
		};
	}

	const yeni = spliceInline(hedef.children, (caret as Caret).offset, (caret as Caret).offset, [
		image as Inline,
	]);
	return {
		doc: replaceInline(doc, caret as Caret, yeni),
		caret: { ...(caret as Caret), offset: (caret as Caret).offset + 1 },
	};
}

/**
 * Bir görselin adresini değiştirir.
 *
 * Eşleştirme **adres üzerinden**: yükleme sürerken kullanıcı yazmaya
 * devam ediyor ve düğümün yolu değişmiş olabiliyor. Geçici adres
 * (`blob:`) benzersiz olduğu için güvenilir bir anahtar.
 *
 * Görsel bulunamazsa `null` dönüyor — kullanıcı yükleme biterken onu
 * silmiş olabilir ve bu bir hata değil.
 */
export function replaceImageUrl(doc: Root, from: string, to: Partial<Image>): Root | null {
	let bulundu = false;
	const yeni = mapImages(doc, (image) => {
		if (image.url !== from) return image;
		bulundu = true;
		return { ...image, ...to };
	});
	return bulundu ? yeni : null;
}

/**
 * Adresi verilen görseli belgeden çıkarır.
 *
 * Görsel bir bağlantının içindeyse bağlantı da düşüyor: hedefsiz kalan
 * boş bir bağlantı, kullanıcının göremediği bir artık olurdu.
 */
export function removeImage(doc: Root, url: string): Root | null {
	let bulundu = false;
	const sil = (nodes: readonly Inline[]): readonly Inline[] => {
		let degisti = false;
		const out: Inline[] = [];
		for (const node of nodes) {
			if (node.type === "image" && node.url === url) {
				bulundu = true;
				degisti = true;
				continue;
			}
			const children = (node as { children?: readonly Inline[] }).children;
			if (!Array.isArray(children)) {
				out.push(node);
				continue;
			}
			const ic = sil(children);
			if (ic === children) {
				out.push(node);
				continue;
			}
			degisti = true;
			// İçi boşalan sarmalayıcı da düşüyor.
			if (ic.length > 0) out.push({ ...node, children: [...ic] } as Inline);
		}
		return degisti ? out : nodes;
	};
	const yeni = mapInlineLists(doc, sil);
	return bulundu ? yeni : null;
}

/**
 * Belge sırasına göre n. görselin alt metnini değiştirir.
 *
 * İndeksle çalışıyor, adresle değil: alt metni düzenlenen görsel henüz
 * yükleniyor olabiliyor ve o sırada adresi geçici. Render görselleri
 * belgedeki sırayla ürettiği için indeks ikisi arasında güvenilir bir
 * köprü (aynı eşleme ilerleme süslemesinde de kullanılıyor).
 */
export function setImageAlt(doc: Root, index: number, alt: string): Root | null {
	let i = -1;
	let bulundu = false;
	const yeni = mapImages(doc, (image) => {
		i += 1;
		if (i !== index || image.alt === alt) return image;
		bulundu = true;
		return { ...image, alt };
	});
	return bulundu ? yeni : null;
}

/** Belge sırasına göre n. görselin alt metni. */
export function imageAltAt(doc: Root, index: number): string | null {
	let i = -1;
	let out: string | null = null;
	mapImages(doc, (image) => {
		i += 1;
		if (i === index) out = image.alt;
		return image;
	});
	return out;
}

/** Belgedeki bütün görsel adresleri. */
export function imageUrls(doc: Root): string[] {
	const out: string[] = [];
	mapImages(doc, (image) => {
		out.push(image.url);
		return image;
	});
	return out;
}

// ---------------------------------------------------------------------------
// Ağaç yardımcıları
// ---------------------------------------------------------------------------

interface Holder {
	readonly children: readonly Inline[];
}

/** İmlecin bulunduğu satır içi taşıyıcı — yoksa `null`. */
function holderAt(doc: Root, caret: Caret): Holder | null {
	let node: unknown = doc.children[caret.blockIndex];
	for (const index of caret.path) {
		const children = (node as { children?: readonly unknown[] } | undefined)?.children;
		node = Array.isArray(children) ? children[index] : undefined;
	}
	const tur = (node as { type?: string } | undefined)?.type;
	if (tur !== "paragraph" && tur !== "heading") return null;
	const children = (node as { children?: readonly Inline[] }).children;
	return Array.isArray(children) ? { children } : null;
}

/** Taşıyıcının içeriğini değiştirmiş yeni bir belge. */
function replaceInline(doc: Root, caret: Caret, children: readonly Inline[]): Root {
	const yol = [caret.blockIndex, ...caret.path];
	const kokCocuklar = doc.children.map((child, i) =>
		i === yol[0] ? degistir(child, yol.slice(1), children) : child,
	);
	return { ...doc, children: kokCocuklar as Root["children"] };
}

function degistir(node: unknown, yol: readonly number[], children: readonly Inline[]): unknown {
	if (yol.length === 0) return { ...(node as object), children: [...children] };
	const mevcut = (node as { children?: readonly unknown[] }).children ?? [];
	const yeni = mevcut.map((child, i) =>
		i === yol[0] ? degistir(child, yol.slice(1), children) : child,
	);
	return { ...(node as object), children: yeni };
}

/**
 * Belgedeki her satır içi listeye bir dönüşüm uygular.
 *
 * Değişmeyen dallar **aynı nesne** olarak dönüyor: editörün hedefli DOM
 * yaması bu kimlik karşılaştırmasına dayanıyor (F2-05) ve her düğümü
 * kopyalamak, yükleme biterken bütün belgeyi yeniden çizdirirdi.
 */
function mapInlineLists(doc: Root, fn: (nodes: readonly Inline[]) => readonly Inline[]): Root {
	const gez = (node: unknown): unknown => {
		const children = (node as { children?: readonly unknown[] }).children;
		if (!Array.isArray(children)) return node;

		const tur = (node as { type?: string }).type;
		if (tur === "paragraph" || tur === "heading") {
			const yeni = fn(children as Inline[]);
			return yeni === children ? node : { ...(node as object), children: [...yeni] };
		}

		let degisti = false;
		const yeniCocuklar = children.map((child) => {
			const y = gez(child);
			if (y !== child) degisti = true;
			return y;
		});
		return degisti ? { ...(node as object), children: yeniCocuklar } : node;
	};

	let degisti = false;
	const kok = doc.children.map((child) => {
		const y = gez(child);
		if (y !== child) degisti = true;
		return y;
	});
	return degisti ? { ...doc, children: kok as Root["children"] } : doc;
}

/**
 * Belgedeki her görsele bir dönüşüm uygular.
 *
 * Satır içi ağacın **derinliğine** iniyor: görsel bir bağlantının ya da
 * kalın metnin içinde de olabiliyor (`[![alt](a.png)](hedef)` sık bir
 * kalıp) ve yalnızca üst düzeye bakmak onu kaçırırdı.
 */
function mapImages(doc: Root, fn: (image: Image) => Image): Root {
	const gez = (nodes: readonly Inline[]): readonly Inline[] => {
		let degisti = false;
		const yeni = nodes.map((node) => {
			if (node.type === "image") {
				const y = fn(node);
				if (y !== node) degisti = true;
				return y;
			}
			const children = (node as { children?: readonly Inline[] }).children;
			if (!Array.isArray(children)) return node;
			const ic = gez(children);
			if (ic === children) return node;
			degisti = true;
			return { ...node, children: [...ic] } as Inline;
		});
		return degisti ? yeni : nodes;
	};
	return mapInlineLists(doc, gez);
}
