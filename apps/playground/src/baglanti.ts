/**
 * Paylaşılabilir bağlantı  (İş listesi: F6-07)
 *
 * Belge, adresin **karma (hash) parçasında** sıkıştırılmış olarak
 * taşınıyor. Üç karar var ve üçünün de sebebi var.
 *
 * ## Neden karma, sorgu değil
 *
 * Karma parçası sunucuya **hiç gönderilmiyor**. Yani paylaşılan bir
 * belgenin metni, bağlantıyı barındıran sunucunun günlüklerine düşmüyor
 * ve bir ara vekil onu göremiyor. Bir yazma aracında bu, gizlilik
 * açısından en ucuz doğru karar.
 *
 * Yan fayda: sorgu dizesi için sunucuların uyguladığı uzunluk sınırları
 * (çoğu 8 kB) karmayı bağlamıyor.
 *
 * ## Neden `lz-string` değil
 *
 * İş listesi "LZ sıkıştırma" diyor ve akla ilk gelen paket `lz-string`.
 * Ama tarayıcı bunu zaten yapıyor: `CompressionStream("deflate-raw")`.
 * Yerleşik olan daha iyi sıkıştırıyor (deflate, LZ77 + Huffman) ve
 * uygulamaya tek bayt eklemiyor.
 *
 * Desteklemeyen tarayıcıda sıkıştırma **atlanıyor**, bağlantı yine
 * çalışıyor: sadece uzun oluyor. Ön ek (`1` / `0`) hangi biçim olduğunu
 * söylüyor, yani eski bağlantılar da açılmaya devam ediyor.
 *
 * ## Neden yalnızca belge
 *
 * Tema, araç çubuğu kipi ve anahtarlar **okuyucunun tercihi**, yazarın
 * içeriği değil. Bir bağlantının karşı tarafın temasını değiştirmesi
 * beklenmedik olurdu; kabul kriteri de "aynı **içeriği** açıyor" diyor.
 */

/** Sıkıştırılmış biçimin ön eki; sürüm değil, biçim işareti. */
const SIKISTIRILMIS = "1";
const DUZ = "0";

const destekli = (): boolean => typeof CompressionStream === "function";

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

/**
 * Baytları base64url'e çevirir.
 *
 * `btoa(String.fromCharCode(...bytes))` kestirmesi kullanılmıyor: uzun bir
 * belgede yayılan argüman sayısı çağrı yığınını taşırıyor.
 */
function base64url(bayt: Uint8Array<ArrayBufferLike>): string {
	let ikili = "";
	for (const b of bayt) ikili += String.fromCharCode(b);
	return btoa(ikili).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/*
 * Dönüş tipi açıkça `Uint8Array<ArrayBuffer>`.
 *
 * TypeScript'in yeni sürümlerinde `Uint8Array`in varsayılan genel
 * parametresi `ArrayBufferLike` ve o da `SharedArrayBuffer`ı kapsıyor;
 * `Blob` ise paylaşılan belleği kabul etmiyor. Burada üretilen dizi her
 * zaman sıradan bir `ArrayBuffer` üstünde.
 */
function base64urlCoz(metin: string): Uint8Array<ArrayBuffer> {
	const taban = metin.replaceAll("-", "+").replaceAll("_", "/");
	const ikili = atob(taban.padEnd(Math.ceil(taban.length / 4) * 4, "="));
	const bayt = new Uint8Array(new ArrayBuffer(ikili.length));
	for (let i = 0; i < ikili.length; i++) bayt[i] = ikili.charCodeAt(i);
	return bayt;
}

async function akistanBaytlar(
	akis: ReadableStream<Uint8Array<ArrayBufferLike>>,
): Promise<Uint8Array<ArrayBuffer>> {
	const parcalar: Uint8Array[] = [];
	let uzunluk = 0;
	const okuyucu = akis.getReader();
	for (;;) {
		const { done, value } = await okuyucu.read();
		if (done) break;
		parcalar.push(value);
		uzunluk += value.length;
	}
	const hepsi = new Uint8Array(new ArrayBuffer(uzunluk));
	let konum = 0;
	for (const p of parcalar) {
		hepsi.set(p, konum);
		konum += p.length;
	}
	return hepsi;
}

// ---------------------------------------------------------------------------
// Kodlama
// ---------------------------------------------------------------------------

/** Belgeyi adresin karma parçasına konacak biçime çevirir. */
export async function kodla(metin: string): Promise<string> {
	const ham = new Uint8Array(new TextEncoder().encode(metin));
	if (!destekli()) return DUZ + base64url(ham);

	const akis = new Blob([ham]).stream().pipeThrough(new CompressionStream("deflate-raw"));
	return SIKISTIRILMIS + base64url(await akistanBaytlar(akis));
}

/**
 * Karma parçasını belgeye çevirir; bozuksa `null`.
 *
 * Bozuk bağlamda **atmıyor**: kullanıcının eline bozulmuş bir bağlantı
 * geçmiş olabilir ve uygulamanın açılmaması bundan kötü. Çağıran boş
 * belgeyle devam ediyor.
 */
export async function coz(parca: string): Promise<string | null> {
	const temiz = parca.startsWith("#") ? parca.slice(1) : parca;
	if (temiz === "") return null;

	const isaret = temiz[0];
	const govde = temiz.slice(1);

	try {
		const bayt = base64urlCoz(govde);
		if (isaret === DUZ) return new TextDecoder().decode(bayt);
		if (isaret !== SIKISTIRILMIS) return null;
		if (!destekli()) return null;

		const akis = new Blob([bayt]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		return new TextDecoder().decode(await akistanBaytlar(akis));
	} catch {
		return null;
	}
}

/** Paylaşılabilir tam adres. */
export async function baglantiUret(metin: string, taban: string): Promise<string> {
	const kok = taban.split("#")[0] ?? taban;
	return `${kok}#${await kodla(metin)}`;
}

/**
 * Bağlantının paylaşılabilir sayıldığı üst sınır.
 *
 * Tarayıcılar çok daha uzununu taşıyor ama araya giren araçlar taşımıyor:
 * sohbet uygulamaları, e-posta istemcileri ve bağlantı kısaltıcılar
 * genelde 8–16 bin karakterde kesiyor. Sınır aşıldığında bağlantı yine
 * üretiliyor; kullanıcı yalnızca uyarılıyor.
 */
export const GUVENLI_UZUNLUK = 12_000;
