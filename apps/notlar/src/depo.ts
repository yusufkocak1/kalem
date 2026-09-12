/**
 * Kalem Notlar — Yerel depo  (İş listesi: F5-05)
 *
 * Sunucu yok. Uygulamanın amacı Kalem'i **gerçekten kullanmak**; bir
 * arka uç eklemek dogfooding'e hiçbir şey katmaz ama kurulumu zorlaştırır
 * ve notların bir yere gitmesi endişesi yaratır. Her şey tarayıcıda.
 *
 * `Storage` dışarıdan veriliyor: testler sahte bir depo geçiriyor ve
 * `localStorage`ın erişilemediği durumlar (özel pencere, site verisi
 * kapalı) tek bir yerde ele alınıyor.
 */

export interface Not {
	readonly id: string;
	readonly metin: string;
	/** Son değişiklik zamanı (epoch ms). Liste buna göre sıralanıyor. */
	readonly guncellenme: number;
}

export const DEPO_ANAHTARI = "kalem:notlar:v1";

/** Otomatik kaydetmenin kurtarma anahtarı — not başına ayrı. */
export function taslakAnahtari(id: string): string {
	return `kalem:notlar:taslak:${id}`;
}

export function yeniKimlik(): string {
	// `crypto.randomUUID` her yerde yok (eski Safari, güvensiz köken).
	const rastgele = Math.random().toString(36).slice(2, 10);
	return `n${Date.now().toString(36)}${rastgele}`;
}

export function bosNot(metin = ""): Not {
	return { id: yeniKimlik(), metin, guncellenme: Date.now() };
}

/**
 * Depodan okur.
 *
 * Bozuk ya da başka bir sürümden kalmış veri **sessizce** atılıyor:
 * kullanıcıya JSON hatası göstermek yerine boş bir defterle açmak, not
 * uygulamasında daha az kötü olan sonuç. Kayıp veri riski yok — bozuk
 * kayıt zaten okunamıyordu.
 */
export function notlariOku(storage: Storage | null): Not[] {
	if (storage === null) return [];
	let ham: string | null = null;
	try {
		ham = storage.getItem(DEPO_ANAHTARI);
	} catch {
		return [];
	}
	if (ham === null) return [];
	try {
		const cozulen: unknown = JSON.parse(ham);
		if (!Array.isArray(cozulen)) return [];
		return cozulen.filter(gecerliNot).map((n) => ({
			id: n.id,
			metin: n.metin,
			guncellenme: n.guncellenme,
		}));
	} catch {
		return [];
	}
}

function gecerliNot(deger: unknown): deger is Not {
	if (typeof deger !== "object" || deger === null) return false;
	const n = deger as Record<string, unknown>;
	return (
		typeof n["id"] === "string" &&
		typeof n["metin"] === "string" &&
		typeof n["guncellenme"] === "number"
	);
}

/**
 * Depoya yazar; kota dolduğunda `false` dönüyor.
 *
 * Sessizce yutulmuyor: not uygulamasında "kaydedilmedi" bilgisi
 * kullanıcının görmesi gereken şey.
 */
export function notlariYaz(storage: Storage | null, notlar: readonly Not[]): boolean {
	if (storage === null) return false;
	try {
		storage.setItem(DEPO_ANAHTARI, JSON.stringify(notlar));
		return true;
	} catch {
		return false;
	}
}

/** En son değişen en üstte. */
export function sirala(notlar: readonly Not[]): Not[] {
	return [...notlar].sort((a, b) => b.guncellenme - a.guncellenme);
}

/** Bir notun metnini değiştirip zamanını tazeler; yoksa listeyi olduğu gibi döner. */
export function notuGuncelle(notlar: readonly Not[], id: string, metin: string): Not[] {
	return notlar.map((n) => (n.id === id ? { ...n, metin, guncellenme: Date.now() } : n));
}

/** `localStorage`a erişilemeyen ortamlarda `null` dönüyor. */
export function depoyuAc(): Storage | null {
	try {
		const d = window.localStorage;
		// Erişim değil **yazma** deneniyor: bazı tarayıcılarda nesne var ama
		// `setItem` atıyor (özel pencere, site verisi kapalı).
		const anahtar = "kalem:notlar:deneme";
		d.setItem(anahtar, "1");
		d.removeItem(anahtar);
		return d;
	} catch {
		return null;
	}
}
