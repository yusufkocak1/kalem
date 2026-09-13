/**
 * Belge dilinin tek kaynağı  (İş listesi: F6-10)
 *
 * ## Neden ayrı bir fonksiyon
 *
 * F6-10'a kadar bu karar **yedi yerde** ayrı ayrı veriliyordu — arayüz,
 * özel eleman ve beş eklenti aynı satırı kopyalamıştı:
 *
 * ```ts
 * element.closest("[lang]")?.getAttribute("lang") ?? "en"
 * ```
 *
 * Kopyaların ikisi aynı sonucu verdiği sürece bu zararsız görünüyor. Ama
 * iş listesinin istediği zincirin son halkası — tarayıcının dili —
 * hiçbirinde yoktu, ve eklemek yedi dosyaya dokunmak demekti. Bir sonraki
 * değişiklikte kopyalardan birinin geride kalması an meselesiydi; o gün
 * arayüz Türkçe konuşurken bul-değiştir İngilizce kasa kuralıyla arardı.
 *
 * ## Zincir
 *
 * 1. Elemanın **kendisi ya da en yakın atası** — `lang` seçeneği elemana
 *    yazılıyor, yani seçenek de buradan geliyor. Gömen sayfanın bir
 *    bölümü farklı dildeyse doğru cevabı veren tek halka bu.
 * 2. `<html lang>` — eleman henüz belgeye bağlanmadıysa `closest` onu
 *    göremiyor.
 * 3. `navigator.language` — sayfa dil beyan etmiyorsa kullanıcının
 *    tarayıcısı en iyi tahmin.
 * 4. `"en"`.
 *
 * ## Boş `lang`
 *
 * HTML'de `lang=""` "dil bilinmiyor" demek. `closest("[lang]")` onu da
 * buluyor ve zincir orada boş bir dizeyle bitiyordu; her karşılaştırma
 * sessizce köke düşüyordu. Boş değerler atlanıyor.
 */

/** `resolveLang`in dokunduğu alanlar — testte düz nesneyle beslenebilsin. */
export interface LangSource {
	closest(selectors: string): { getAttribute(name: string): string | null } | null;
	readonly ownerDocument: {
		readonly documentElement: { readonly lang: string } | null;
		readonly defaultView: { readonly navigator: { readonly language: string } } | null;
	} | null;
}

/** Boş olmayan en yakın `lang` — `lang=""` "bilinmiyor" demek, dil değil. */
const DOLU_LANG = '[lang]:not([lang=""])';

/**
 * Elemanın belge dilini çözer.
 *
 * Her çağrıda yeniden çözülüyor, önbelleğe alınmıyor: eleman DOM'da
 * taşınabilir ya da gömen sayfa `<html lang>`ı değiştirebilir. Maliyeti
 * bir `closest` çağrısı.
 */
export function resolveLang(element: LangSource): string {
	const ata = element.closest(DOLU_LANG)?.getAttribute("lang");
	if (ata !== null && ata !== undefined && ata !== "") return ata;

	const belge = element.ownerDocument;
	const kok = belge?.documentElement?.lang;
	if (kok !== undefined && kok !== "") return kok;

	const tarayici = belge?.defaultView?.navigator?.language;
	if (tarayici !== undefined && tarayici !== "") return tarayici;

	return "en";
}
