/**
 * @kalem/plugin-find-replace — Eşleşmeleri boyama  (İş listesi: F4-03)
 *
 * ## DOM'a hiç dokunulmuyor
 *
 * Eşleşmeler CSS Özel Vurgu API'siyle (`CSS.highlights`) boyanıyor:
 * `Range` nesneleri kaydediliyor, tarayıcı onları `::highlight()` kuralıyla
 * çiziyor. Belgeye tek bir düğüm eklenmiyor.
 *
 * Alternatif, kod vurgulamada (F4-02) olduğu gibi `<span>` sarmaktı ve
 * burada daha pahalıya gelirdi:
 *
 * - Kullanıcı arama kutusuna yazarken imleç **editörde**; her tuşta
 *   `<code>` değil bir paragrafın içi baştan kurulacak, imleci ölçüp geri
 *   koymak gerekecekti.
 * - Bir eşleşme biçim sınırını aşabiliyor (`**ka**lın` içinde `kalın`);
 *   `Range.surroundContents` böyle bir aralıkta çalışmıyor, yani metin
 *   düğümlerini elle bölmek gerekirdi — `contenteditable` içinde, üstelik
 *   kullanıcı yazarken.
 * - `<span>` eklemek belgeyi değiştirmiyor (editör bilinmeyen etiketi
 *   şeffaf okuyor) ama seçim, IME ve geri alma ile kesişen üç ayrı yol
 *   açıyordu.
 *
 * Üç motorda da (Chromium, Firefox, WebKit) destekleniyor; olmayan bir
 * tarayıcıda boyama **sessizce** düşüyor ve geçerli eşleşme yine
 * görünüyor (görünür alana kaydırılıyor). Aramanın kendisi çalışmaya
 * devam ediyor — bu, kaybedilmesi kabul edilebilir tek parça.
 *
 * ## Vurgu adları belge geneli
 *
 * `::highlight(kalem-find)` bir CSS seçicisi, yani ad **statik** olmak
 * zorunda ve kayıt defteri belge genelinde tek. Aynı sayfada iki editör
 * varsa ikisinin eşleşmeleri aynı adı paylaşıyor; ikinci bir panel
 * açıldığında birincisinin boyaması siliniyor. Bunu düzeltmek her editöre
 * ayrı bir `<style>` yazmak demekti — aynı sayfada iki arama panelini
 * birden açık tutmanın bedeli olarak fazla.
 */
import { blockElementOf, holderIn, pointAt } from "@kalem/editor";
import type { Match } from "./search.js";

/** Bütün eşleşmeler. */
const TUM = "kalem-find";
/** Geçerli eşleşme — ötekinin üstünde çizilmesi için ayrı kayıt. */
const GECERLI = "kalem-find-current";

/**
 * `CSS.highlights` kayıt defteri — tarayıcıda yoksa `null`.
 *
 * Tip tanımı elle yazıldı: `lib.dom` sürümüne göre var ya da yok ve
 * eksik olduğu bir TypeScript sürümünde derleme kırılırdı.
 */
interface VurguKaydi {
	set(name: string, highlight: unknown): void;
	delete(name: string): void;
}

type VurguKurucu = new (...ranges: Range[]) => unknown;

function kayitDefteri(view: Window | null): VurguKaydi | null {
	if (view === null) return null;
	const css = (view as unknown as { CSS?: { highlights?: VurguKaydi } }).CSS;
	return css?.highlights ?? null;
}

export interface Decorator {
	/** Eşleşmeleri boyar; `current` geçerli eşleşmenin indisi (yoksa -1). */
	paint(matches: readonly Match[], current: number): void;
	/** Geçerli eşleşmeyi görünür alana getirir. */
	reveal(match: Match): void;
	/** Boyamayı kaldırır. */
	clear(): void;
}

export function createDecorator(root: HTMLElement, getBlockId: (index: number) => string | null) {
	const doc = root.ownerDocument;

	/** Eşleşmenin DOM aralığı; eleman bulunamazsa `null`. */
	function aralik(match: Match): Range | null {
		const id = getBlockId(match.blockIndex);
		if (id === null) return null;
		const blok = blockElementOf(root, id);
		if (blok === null) return null;

		const holder = holderIn(blok, match.path);
		if (holder === null) return null;

		try {
			const bas = pointAt(holder, match.from);
			const bit = pointAt(holder, match.to);
			const range = doc.createRange();
			range.setStart(bas.node, bas.offset);
			range.setEnd(bit.node, bit.offset);
			return range;
		} catch {
			// Belge boyama ile arama arasında değişmiş olabilir; kırık bir
			// aralık üretmektense o eşleşmeyi atlıyoruz.
			return null;
		}
	}

	const decorator: Decorator = {
		paint(matches, current) {
			const kayit = kayitDefteri(doc.defaultView);
			if (kayit === null) return;
			const Kurucu = (doc.defaultView as unknown as { Highlight?: VurguKurucu }).Highlight;
			if (Kurucu === undefined) return;

			const hepsi: Range[] = [];
			let gecerli: Range | null = null;
			for (const [i, match] of matches.entries()) {
				const range = aralik(match);
				if (range === null) continue;
				if (i === current) gecerli = range;
				else hepsi.push(range);
			}

			kayit.set(TUM, new Kurucu(...hepsi));
			kayit.set(GECERLI, gecerli === null ? new Kurucu() : new Kurucu(gecerli));
		},

		reveal(match) {
			const range = aralik(match);
			const hedef = range?.startContainer;
			const el = hedef instanceof Element ? hedef : (hedef?.parentElement ?? null);
			// `nearest`: eşleşme zaten ekrandaysa sayfa kıpırdamıyor. Uzun bir
			// belgede her tuş vuruşunda ortalanan bir görünüm okumayı
			// imkânsızlaştırır.
			el?.scrollIntoView({ block: "nearest", inline: "nearest" });
		},

		clear() {
			const kayit = kayitDefteri(doc.defaultView);
			if (kayit === null) return;
			kayit.delete(TUM);
			kayit.delete(GECERLI);
		},
	};

	return decorator;
}
