/**
 * @kalem-editor/core — Güvenlik katmanı  (İş listesi: F1-10)
 *
 * ## Neden burada, viewer'da değil
 *
 * Render **AST'den DOM API ile** yapılır (`createElement` + `textContent`),
 * ham HTML string'den değil. Bu, XSS yüzeyinin büyük kısmını yapısal olarak
 * ortadan kaldırır ve DOMPurify (~9 kB) bağımlılığını gereksiz kılar
 * (analiz §5.6). Geriye üç yüzey kalır ve üçü de **AST düzeyinde**
 * çözülebilir — yani DOM'suz, sunucuda da geçerli:
 *
 * 1. **URL protokolleri.** `javascript:` bir metin değeridir; `createElement`
 *    onu güvenli kılmaz.
 * 2. **Ham HTML düğümleri.** Kullanıcı `<script>` yazdıysa AST'de `html`
 *    düğümü olarak durur.
 * 3. **Yapıştırma.** Dışarıdan gelen HTML (F1-09) aynı kurallardan geçer.
 *
 * Bu dosya bu üçünün **politikasını** tanımlar. Uygulaması render tarafında
 * ama karar burada — SSR ve istemci aynı kararı verir.
 */

/**
 * İzin verilen URL şemaları.
 *
 * Beyaz liste, kara liste değil: yeni bir tehlikeli şema (`vbscript:`,
 * `livescript:`, `data:text/html`) icat edildiğinde kara liste geride kalır,
 * beyaz liste kalmaz.
 */
export const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:", "mailto:", "tel:", "ftp:"];

/**
 * Görsellerde ayrıca izin verilen `data:` MIME türleri.
 *
 * `data:image/svg+xml` **kasten dışarıda**: SVG içinde script çalışır ve
 * `<img>` üzerinden bile bazı bağlamlarda tehlikelidir.
 */
export const ALLOWED_IMAGE_DATA_TYPES: readonly string[] = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
];

export interface UrlPolicy {
	/** Görsel `src`'si mi (o zaman `data:` görselleri de kabul edilir). */
	image?: boolean;
}

/**
 * URL'nin şemasını çıkarır.
 *
 * `URL` sınıfı kullanılmıyor: göreli yollar için taban gerektirir ve
 * `@kalem-editor/core` tarayıcı API'lerine dayanmamalı. Şema ayrıştırma RFC 3986'da
 * basit bir dil bilgisi.
 */
function schemeOf(url: string): string | null {
	// Şema: harf, ardından harf/rakam/+/-/. dizisi, sonra iki nokta.
	const match = /^([A-Za-z][A-Za-z0-9+\-.]*):/.exec(url);
	if (match === null) return null;
	// kalem-locale-ok: URL şemaları ASCII'dir; Türkçe kuralı burada zarar verir
	const scheme = (match[1] as string).toLowerCase();
	return `${scheme}:`;
}

/**
 * Kontrol karakterlerini ve boşlukları temizler.
 *
 * `java\tscript:alert(1)` ve `java&#x0A;script:` gibi vektörler tam olarak
 * bu adım atlandığı için çalışır: tarayıcı şemayı çözerken bu karakterleri
 * yok sayar, saf bir `startsWith` kontrolü ise yok saymaz.
 */
function normalizeForScheme(url: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: tam olarak bunlar temizleniyor
	return url.replace(/[\u0000- \u007f-\u009f]/g, "");
}

/**
 * URL güvenli mi.
 *
 * Şemasız (göreli) URL'ler güvenli sayılır: `/sayfa`, `./resim.png`,
 * `#bolum` bir şema taşımaz ve script çalıştıramaz.
 */
export function isSafeUrl(url: string, policy: UrlPolicy = {}): boolean {
	const scheme = schemeOf(normalizeForScheme(url));
	if (scheme === null) return true;
	if (ALLOWED_PROTOCOLS.includes(scheme)) return true;

	if (policy.image === true && scheme === "data:") {
		const mime = /^data:([^;,]+)/i.exec(normalizeForScheme(url))?.[1];
		// kalem-locale-ok: MIME türleri ASCII'dir, locale kuralı uygulanmaz
		return mime !== undefined && ALLOWED_IMAGE_DATA_TYPES.includes(mime.toLowerCase());
	}
	return false;
}

/**
 * Güvenli olmayan URL'nin yerine konacak değer.
 *
 * Bağlantıyı **silmek yerine etkisizleştirmek** tercih edildi: kullanıcı
 * metnin orada bir bağlantı olduğunu görmeli, ama tıklayınca bir şey
 * olmamalı. Sessizce yok etmek, içeriğin kaybolduğu izlenimi verir.
 */
export const NEUTRALIZED_URL = "#";

/** URL'yi güvenliyse olduğu gibi, değilse etkisizleştirilmiş hâlde verir. */
export function sanitizeUrl(url: string, policy: UrlPolicy = {}): string {
	return isSafeUrl(url, policy) ? url : NEUTRALIZED_URL;
}

// ---------------------------------------------------------------------------
// Ham HTML politikası
// ---------------------------------------------------------------------------

/** Ham HTML düğümlerinin nasıl ele alınacağı. */
export type HtmlPolicy =
	/** Varsayılan: metin olarak göster, çalıştırma. En güvenli. */
	| "escape"
	/** Tamamen at. */
	| "strip"
	/** HTML olarak render et. **Sorumluluk çağırana geçer.** */
	| "allow";

export interface SecurityOptions {
	/** Ham HTML düğümlerine ne yapılacağı (varsayılan `escape`). */
	html?: HtmlPolicy;
	/** `allow` seçildiğinde HTML'i temizlemek için kanca. */
	sanitizeHtml?: (html: string) => string;
}

/**
 * Metni HTML bağlamında güvenli hâle getirir.
 *
 * Render `textContent` kullandığı için üretim yolunda buna **gerek yoktur**;
 * bu fonksiyon `renderToString` (SSR) tarafı ve `escape` politikası için var.
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Ham HTML değerini politikaya göre dönüştürür. */
export function applyHtmlPolicy(value: string, options: SecurityOptions = {}): string {
	const policy = options.html ?? "escape";
	if (policy === "strip") return "";
	if (policy === "escape") return escapeHtml(value);
	return options.sanitizeHtml?.(value) ?? value;
}
