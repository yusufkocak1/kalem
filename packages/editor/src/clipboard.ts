/**
 * @kalem-editor/editor — Panoya yazma  (İş listesi: F2-11)
 *
 * ## Üç biçim, tek kaynak
 *
 * Panoya üç biçim yazılıyor ve üçü de **aynı AST parçasından** üretiliyor:
 *
 * - `text/html` → Word, Google Docs, e-posta istemcisi bunu okur; biçim
 *   korunur.
 * - `text/plain` → **düz metin**: biçim işaretleri olmadan, ekranda
 *   görüldüğü gibi. Not defterine, sohbet kutusuna ya da bir forma
 *   yapıştıran kullanıcı "kalın" görür, `**kalın**` değil. Liste öğeleri
 *   `•`/numarayla, tablo hücreleri sekmeyle ayrılır (Excel'e yapışır).
 * - `text/markdown` → **Markdown**: belgenin asıl kaynağı. Kalem'e geri
 *   yapıştırmak bunu okur, yani hiçbir şey kaybolmaz. `clipboardText:
 *   "markdown"` seçeneği düz metin yerine de Markdown yazar (eski
 *   davranış).
 *
 * HTML tarafı `@kalem-editor/viewer`'dan geliyor. Editör render'ı için viewer
 * kullanılmıyordu (farklı ihtiyaç, bkz. `render.ts`) ama pano için
 * **tam olarak** viewer'ın ürettiği şey gerekiyor: sunum amaçlı, kimliksiz,
 * düzenleme özniteliği taşımayan HTML.
 *
 * ## Tarayıcıya ne zaman bırakılıyor
 *
 * Hiç. Blok içi seçimde bile devralınıyor: Markdown biçimi yalnızca
 * buradan çıkabiliyor.
 */
import type { Block, Inline, ListItem, Root } from "@kalem-editor/core";
import { serialize } from "@kalem-editor/core";
import { renderToString } from "@kalem-editor/viewer";

/** The clipboard type the Markdown goes under; Kalem reads it back first when pasting. */
export const MARKDOWN_TYPE = "text/markdown";

export interface ClipboardPayload {
	readonly html: string;
	/** Plain text, without Markdown's marks. */
	readonly text: string;
	/** The Markdown; written under `text/markdown` when set. */
	readonly markdown?: string;
}

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, "");

/** An inline run as read on screen: marks dropped, links as their text, images as their description. */
function inlineText(nodes: readonly Inline[]): string {
	let out = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
			case "inlineCode":
				out += node.value;
				break;
			case "break":
				out += "\n";
				break;
			case "html":
				out += stripTags(node.value);
				break;
			case "image":
			case "imageReference":
				out += node.alt ?? "";
				break;
			default:
				out += inlineText(node.children);
		}
	}
	return out;
}

/** A block's lines; list items are marked with `•` or their number, nested ones indented by a tab. */
function blockLines(block: Block, indent: string): string[] {
	switch (block.type) {
		case "paragraph":
		case "heading":
			return inlineText(block.children)
				.split("\n")
				.map((line) => indent + line);
		case "code":
			return block.value
				.replace(/\n+$/, "")
				.split("\n")
				.map((line) => indent + line);
		case "html":
			return stripTags(block.value)
				.split("\n")
				.map((line) => indent + line);
		case "blockquote":
			return blocksText(block.children, indent);
		case "list":
			return block.children.flatMap((item, index) =>
				itemLines(
					item,
					indent,
					block.ordered ? `${(block.start ?? 1) + index}. ` : item.checked === null ? "• " : "",
				),
			);
		case "table":
			return block.children.map(
				(row) => indent + row.children.map((cell) => inlineText(cell.children)).join("\t"),
			);
		case "thematicBreak":
		case "definition":
			return [];
	}
}

function itemLines(item: ListItem, indent: string, marker: string): string[] {
	const box = item.checked === null ? "" : item.checked ? "☑ " : "☐ ";
	const [first, ...rest] = item.children;
	const head = first === undefined ? [""] : blockLines(first, "");
	const lines = [
		`${indent}${marker}${box}${head[0] ?? ""}`,
		...head.slice(1).map((l) => `${indent}\t${l}`),
	];
	for (const block of rest) lines.push(...blockLines(block, `${indent}\t`));
	return lines;
}

/** Blocks as plain text: one line between paragraphs, none between list items. */
function blocksText(blocks: readonly Block[], indent: string): string[] {
	const lines: string[] = [];
	for (const block of blocks) {
		const own = blockLines(block, indent);
		if (own.length === 0) continue;
		if (lines.length > 0) lines.push("");
		lines.push(...own);
	}
	return lines;
}

/** A fragment as plain text, as it reads on screen. */
export function plainText(fragment: Root): string {
	const blocks = fragment.children.filter(
		(child): child is Block => child.type !== "yaml" && child.type !== "toml",
	);
	return blocksText(blocks, "").join("\n");
}

/**
 * Blok parçasını panoya uygun iki biçime çevirir.
 *
 * Sondaki satır sonu atılıyor: pano içeriği bir belge değil, bir parça.
 */
export function blocksPayload(fragment: Root): ClipboardPayload {
	return {
		html: renderToString(fragment),
		text: plainText(fragment),
		markdown: serialize(fragment).replace(/\n$/, ""),
	};
}

/**
 * Satır içi parçayı panoya uygun iki biçime çevirir.
 *
 * Paragraf sarmalayıcısı **çıkarılıyor**: bir cümlenin ortasından kopyalanan
 * metin, yapıştırıldığında yeni bir paragraf açmamalı. Serileştirici ve
 * render'ın ikisi de blok bekliyor, o yüzden geçici bir paragrafa sarılıp
 * sonuç kırpılıyor — iki ayrı "satır içi" giriş noktası açmaktan ucuz.
 */
export function inlinePayload(nodes: readonly Inline[]): ClipboardPayload {
	const fragment: Root = {
		type: "root",
		children: [{ type: "paragraph", children: [...nodes] }],
	};
	const html = renderToString(fragment);
	return {
		html: html.startsWith("<p>") && html.endsWith("</p>") ? html.slice(3, -4) : html,
		text: inlineText(nodes),
		markdown: serialize(fragment).replace(/\n$/, ""),
	};
}
