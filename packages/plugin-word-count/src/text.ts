/**
 * @kalem/plugin-word-count — Belgenin metni  (İş listesi: F4-05)
 *
 * Sayılacak metni belgeden çıkarıyor.
 *
 * ## Ne sayılıyor
 *
 * Kullanıcının **ekranda gördüğü** metin: paragraflar, başlıklar, liste
 * maddeleri, alıntılar, tablo hücreleri. Markdown işaretleri (`**`, `#`,
 * `|`) sayılmıyor — onlar biçim, içerik değil. Görselin alt metni de
 * sayılmıyor: ekranda görünmüyor ve bir alt metin yazmak belgeyi
 * uzatmamalı.
 *
 * Kod blokları **varsayılan olarak sayılıyor**. Bu tartışmalı ve o yüzden
 * seçenek: bir teknik belgede kod, yazının parçası ve okuma süresine
 * giriyor; bir romanda kod bloğu zaten yok. Dışarıda bırakmayı varsayılan
 * yapmak, "500 kelime yazdım" diyen kullanıcının kodunu görünmez kılardı.
 *
 * Bağlantı tanımları (`[etiket]: adres`) sayılmıyor: belgenin sonunda
 * duran, okunmayan üstveri.
 */
import type { Block, Inline, Root } from "@kalem/core";

export interface TextOptions {
	/** Kod ve ham HTML bloklarını da say (varsayılan: evet). */
	readonly includeCode?: boolean;
}

/** Bloklar arası ayraç; kelimeler birbirine yapışmasın. */
const AYRAC = String.fromCharCode(10);

const KAYNAK = new Set(["code", "html"]);
/** Hiç sayılmayanlar: okunmayan üstveri. */
const ATLANAN = new Set(["definition", "yaml", "toml", "thematicBreak"]);

/** Belgenin sayılacak metni. */
export function textOf(doc: Root, options: TextOptions = {}): string {
	const kod = options.includeCode ?? true;
	const parcalar: string[] = [];

	const gez = (node: Block): void => {
		if (ATLANAN.has(node.type)) return;

		if (KAYNAK.has(node.type)) {
			if (kod) parcalar.push((node as { value?: string }).value ?? "");
			return;
		}

		if (node.type === "paragraph" || node.type === "heading") {
			parcalar.push(satirIci((node as { children: readonly Inline[] }).children));
			return;
		}

		if (node.type === "table") {
			for (const row of node.children) {
				for (const cell of row.children) parcalar.push(satirIci(cell.children));
			}
			return;
		}

		const children = (node as { children?: readonly unknown[] }).children;
		if (!Array.isArray(children)) return;
		for (const child of children) gez(child as Block);
	};

	for (const block of doc.children) gez(block as Block);
	return parcalar.join(AYRAC);
}

/** Satır içi düğümlerin görünen metni. */
function satirIci(nodes: readonly Inline[]): string {
	let out = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
			case "inlineCode":
				out += node.value;
				break;
			case "break":
				out += AYRAC;
				break;
			case "html":
			// Ham satır içi HTML etiket, metin değil: `<br>` bir kelime değil.
			case "image":
			case "imageReference":
				break;
			default:
				out += satirIci((node as { children: readonly Inline[] }).children);
		}
	}
	return out;
}
