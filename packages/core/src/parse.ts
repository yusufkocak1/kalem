/**
 * @kalem-editor/core — Genel ayrıştırıcı  (İş listesi: F1-03 + F1-04)
 *
 * Blok ve satır içi katmanlarını birleştirir. Kütüphanenin dış dünyaya
 * gösterdiği ayrıştırma girişi budur.
 *
 * İki katman bilerek ayrı tutuluyor: blok yapısı satır içi ayrıştırıcıdan
 * bağımsız test edilebiliyor ve satır içi katman ileride tembel yüklenebilir
 * (analiz §5.3 — ayrıştırma sıcak yolda değil).
 */
import type { Root } from "./ast.js";
import { parseBlocks } from "./blocks.js";
import { parseInline } from "./inline.js";

/** Markdown kaynağını AST'ye çevirir. */
export function parse(source: string): Root {
	return parseBlocks(source, { parseInline });
}
