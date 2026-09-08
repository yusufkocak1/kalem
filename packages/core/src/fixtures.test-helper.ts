/**
 * Testler için ortak örnek ağaç.
 *
 * `.test-helper.ts` uzantısı bilinçli: Vitest yalnızca `*.test.ts` dosyalarını
 * koşar, bu dosya bir test değil. Kapsam raporundan da böyle dışlanır.
 */
import type { Heading, List, Paragraph, Root, Text } from "./ast.js";

/**
 * Bir örnek belge:
 *
 * ```md
 * # Işıklı Başlık
 *
 * Bir paragraf.
 *
 * - ilk madde
 * - ikinci madde
 * ```
 *
 * Yollar:
 * - `[]`        kök
 * - `[0]`       başlık
 * - `[0, 0]`    başlığın metni
 * - `[1]`       paragraf
 * - `[2]`       liste
 * - `[2, 0]`    ilk madde
 * - `[2, 0, 0]` ilk maddenin paragrafı
 */
export function ornekBelge(): Root {
	return {
		type: "root",
		children: [
			{
				type: "heading",
				depth: 1,
				children: [{ type: "text", value: "Işıklı Başlık" }],
				syntax: { style: "atx" },
			},
			{ type: "paragraph", children: [{ type: "text", value: "Bir paragraf." }] },
			{
				type: "list",
				ordered: false,
				start: null,
				spread: false,
				syntax: { marker: "-" },
				children: [
					{
						type: "listItem",
						checked: null,
						spread: false,
						children: [{ type: "paragraph", children: [{ type: "text", value: "ilk madde" }] }],
					},
					{
						type: "listItem",
						checked: null,
						spread: false,
						children: [{ type: "paragraph", children: [{ type: "text", value: "ikinci madde" }] }],
					},
				],
			},
		],
	};
}

/** Kısa yoldan düğüm kurucular — testlerin okunurluğu için. */
export const metin = (value: string): Text => ({ type: "text", value });

export const paragraf = (value: string): Paragraph => ({
	type: "paragraph",
	children: [metin(value)],
});

export const baslik = (depth: Heading["depth"], value: string): Heading => ({
	type: "heading",
	depth,
	children: [metin(value)],
});

export const bosListe = (): List => ({
	type: "list",
	ordered: false,
	start: null,
	spread: false,
	children: [],
});
