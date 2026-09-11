/**
 * @kalem/plugin-outline — Başlık ağacı  (İş listesi: F4-04)
 *
 * Saf katman: belge girdi, içindekiler listesi çıktı. DOM yok.
 *
 * ## Derinlik ve seviye ayrı şeyler
 *
 * `depth` başlığın Markdown'daki derecesi (`##` → 2). `level` ise
 * **görsel girinti**: gerçek belgeler başlık derecelerini atlıyor ve
 * girintiyi doğrudan `depth`ten almak, `#` sonrası gelen bir `###`
 * yüzünden iki kat boşluk bırakıyor.
 *
 *     # Giriş          depth 1  level 1
 *     ### Alt bölüm    depth 3  level 2   ← üç değil iki
 *     ### Öteki        depth 3  level 2
 *     ## Sonuç         depth 2  level 1
 *
 * Kural: bir başlık, kendisinden **daha sığ** en yakın atanın bir altına
 * giriyor. Bu, belgenin ne demek istediğini koruyor ve kullanıcının
 * yazım hatasını cezalandırmıyor.
 *
 * ## Neden başlık metni düz metin
 *
 * `**kalın** başlık` içindekilerde `kalın başlık` olarak görünüyor.
 * Biçimi taşımak, panelde ikinci bir satır içi çizici gerektirirdi ve
 * içindekiler listesi biçim değil **yapı** gösteriyor.
 */
import type { Block, Heading, Inline, Root } from "@kalem/core";

/** İçindekiler listesindeki bir başlık. */
export interface OutlineItem {
	/** Üst düzey bloğun kimliği — DOM'da bulmak için. */
	readonly blockId: string;
	readonly blockIndex: number;
	/** Blok kökünden başlığa giden yol; üst düzey başlıkta boş. */
	readonly path: readonly number[];
	/** Markdown derecesi: 1–6. */
	readonly depth: number;
	/** Görsel girinti seviyesi: 1'den başlıyor, atlamaları düzeltiyor. */
	readonly level: number;
	readonly text: string;
}

/**
 * Belgedeki başlıklar, belge sırasında.
 *
 * Alıntı ve liste içindeki başlıklar da geliyor: Markdown onlara izin
 * veriyor ve içindekilerden düşen bir başlık, kullanıcının belgede
 * göremediği bir eksiklik olurdu.
 */
export function outlineOf(doc: Root): OutlineItem[] {
	const ham: Omit<OutlineItem, "level">[] = [];

	const gez = (node: Block, blockIndex: number, blockId: string, path: readonly number[]): void => {
		if (node.type === "heading") {
			const heading = node as Heading;
			ham.push({
				blockId,
				blockIndex,
				path,
				depth: heading.depth,
				text: duzMetin(heading.children),
			});
			return;
		}
		const children = (node as { children?: readonly unknown[] }).children;
		if (!Array.isArray(children)) return;
		// Tablo satırları blok değil; başlık taşıyamıyorlar.
		if (node.type === "table") return;
		for (const [i, child] of children.entries()) {
			gez(child as Block, blockIndex, blockId, [...path, i]);
		}
	};

	for (const [blockIndex, block] of doc.children.entries()) {
		gez(block as Block, blockIndex, block.id ?? "", []);
	}

	return seviyele(ham);
}

/**
 * Derinlikleri görsel seviyelere çeviriyor.
 *
 * Yığın, açık olan ataların derinliklerini tutuyor; yeni başlık,
 * kendisinden sığ olmayan bütün ataları kapatıyor.
 */
function seviyele(ham: readonly Omit<OutlineItem, "level">[]): OutlineItem[] {
	const yigin: number[] = [];
	return ham.map((item) => {
		while (yigin.length > 0 && (yigin[yigin.length - 1] as number) >= item.depth) yigin.pop();
		yigin.push(item.depth);
		return { ...item, level: yigin.length };
	});
}

/** Satır içi içeriğin düz metni. */
function duzMetin(nodes: readonly Inline[]): string {
	let out = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
			case "inlineCode":
			case "html":
				out += node.value;
				break;
			case "break":
				// İçindekilerde satır sonu yok; başlık tek satır görünmeli.
				out += " ";
				break;
			case "image":
			case "imageReference":
				break;
			default:
				out += duzMetin((node as { children: readonly Inline[] }).children);
		}
	}
	return out.trim();
}

/**
 * İki liste aynı mı — gereksiz yeniden çizimi engellemek için.
 *
 * Kullanıcı bir paragrafa harf eklediğinde belge değişiyor ama
 * içindekiler değişmiyor; her `change` olayında paneli baştan kurmak,
 * kullanıcının panelde tuttuğu odağı ve kaydırma konumunu kaybettirirdi.
 */
export function sameOutline(a: readonly OutlineItem[], b: readonly OutlineItem[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((item, i) => {
		const o = b[i] as OutlineItem;
		return (
			item.blockId === o.blockId &&
			item.depth === o.depth &&
			item.level === o.level &&
			item.text === o.text &&
			item.path.length === o.path.length &&
			item.path.every((n, k) => n === o.path[k])
		);
	});
}
