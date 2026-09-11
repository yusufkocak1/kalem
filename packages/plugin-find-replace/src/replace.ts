/**
 * @kalem/plugin-find-replace — Değiştirme  (İş listesi: F4-03)
 *
 * ## Neden sondan başa
 *
 * Bir eşleşmeyi değiştirmek, ondan sonraki bütün ofsetleri kaydırıyor:
 * "kedi" → "köpek" iki karakter ekliyor ve aynı paragraftaki sonraki
 * eşleşme artık iki ileride. Baştan başlayan bir döngü ya her adımda
 * belgeyi yeniden taramak (uzun belgede eşleşme sayısı kadar tarama) ya
 * da ofsetleri elle kaydırmak zorunda kalırdı.
 *
 * Sondan başa gidildiğinde ikisine de gerek yok: değişmeyen kısım hep
 * **solda** kalıyor, yani henüz kullanılmamış ofsetler geçerliliğini
 * koruyor. Blok yapısı değişmediği için yollar da sabit.
 *
 * ## Tek düzenleme, tek geri alma
 *
 * "Tümünü değiştir" belgeyi baştan sona tek bir `EditResult` olarak
 * üretiyor. Eşleşme başına bir düzenleme uygulamak, geçmişe yüzlerce adım
 * yazardı ve kullanıcı Ctrl+Z'ye basınca değişikliğin tamamı değil
 * sonuncusu geri alınırdı — istediği şey bu değil.
 */
import type { Root } from "@kalem/core";
import type { EditResult } from "@kalem/editor";
import type { Region } from "./regions.js";
import { caretAt, replaceInRegion } from "./regions.js";
import type { Match } from "./search.js";

/**
 * Tek bir eşleşmeyi değiştirir.
 *
 * İmleç, yerine konan metnin sonuna gidiyor: kullanıcı "değiştir"e basıp
 * yazmaya devam edebilsin.
 */
export function replaceOne(
	doc: Root,
	regions: readonly Region[],
	match: Match,
	value: string,
): EditResult | null {
	const region = regions[match.regionIndex];
	if (region === undefined) return null;
	return replaceInRegion(doc, region, match.from, match.to, value);
}

/**
 * Bütün eşleşmeleri değiştirir.
 *
 * Eşleşme yoksa `null` — çağıran "değişiklik olmadı" ile "boş belge
 * üretildi"yi ayırabilsin.
 */
export function replaceAll(
	doc: Root,
	regions: readonly Region[],
	matches: readonly Match[],
	value: string,
): EditResult | null {
	if (matches.length === 0) return null;

	let sonuc = doc;
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i] as Match;
		const region = regions[match.regionIndex];
		if (region === undefined) continue;
		const adim = replaceInRegion(sonuc, region, match.from, match.to, value);
		if (adim === null) continue;
		sonuc = adim.doc;
	}

	if (sonuc === doc) return null;

	// İmleç ilk değiştirilen yerin sonunda: kullanıcı belgenin neresinin
	// değiştiğini görmeli ve ilk eşleşme, aradığı şeyin ilk geçtiği yer.
	const ilk = matches[0] as Match;
	const region = regions[ilk.regionIndex];
	return {
		doc: sonuc,
		caret: region === undefined ? null : caretAt(region, ilk.from + value.length),
	};
}
