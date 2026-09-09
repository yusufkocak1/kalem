/**
 * @kalem/editor — Panoya yazma  (İş listesi: F2-11)
 *
 * ## İki biçim, tek kaynak
 *
 * Panoya hem `text/html` hem `text/plain` yazılıyor ve ikisi de **aynı
 * AST parçasından** üretiliyor:
 *
 * - `text/html` → Word, Google Docs, e-posta istemcisi bunu okur; biçim
 *   korunur.
 * - `text/plain` → **Markdown**. Not defterine yapıştıran kullanıcı
 *   `**kalın**` görür, düz "kalın" değil. Bu, projenin "doğru kaynak
 *   Markdown metnidir" kararının panoya yansıması.
 *
 * HTML tarafı `@kalem/viewer`'dan geliyor. Editör render'ı için viewer
 * kullanılmıyordu (farklı ihtiyaç, bkz. `render.ts`) ama pano için
 * **tam olarak** viewer'ın ürettiği şey gerekiyor: sunum amaçlı, kimliksiz,
 * düzenleme özniteliği taşımayan HTML.
 *
 * ## Tarayıcıya ne zaman bırakılıyor
 *
 * Hiç. Blok içi seçimde bile devralınıyor, çünkü asıl kazanç orada:
 * tarayıcının `text/plain`'i biçim işaretlerini atar, bizimki atmaz.
 */
import type { Inline, Root } from "@kalem/core";
import { serialize } from "@kalem/core";
import { renderToString } from "@kalem/viewer";

export interface ClipboardPayload {
	readonly html: string;
	readonly text: string;
}

/**
 * Blok parçasını panoya uygun iki biçime çevirir.
 *
 * Sondaki satır sonu atılıyor: pano içeriği bir belge değil, bir parça.
 */
export function blocksPayload(fragment: Root): ClipboardPayload {
	return {
		html: renderToString(fragment),
		text: serialize(fragment).replace(/\n$/, ""),
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
		text: serialize(fragment).replace(/\n$/, ""),
	};
}
