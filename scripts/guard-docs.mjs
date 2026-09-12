#!/usr/bin/env node
/**
 * KORUYUCU KAPI 4/4 — Doküman kapısı  (İş listesi: F6-02)
 *
 * Doküman sitesindeki kod örnekleri **gerçekten var olan** API'yi
 * kullanıyor mu?
 *
 * Bu kapı bir tahminden doğmadı. Site Faz 0'da, kütüphane yazılmadan
 * yazılmıştı ve on beş görev boyunca kimse fark etmeden yanlış kaldı:
 * "beş satırda ilk editör" örneği `toolbar()`, `slashMenu()` ve
 * `dragHandle()` çağırıyordu — üçü de hiç var olmadı. Gerçek API
 * `mountUi(editor)`. Bir okuyucu o satırı kopyalasa `is not a function`
 * alırdı ve kütüphaneyi bir daha denemezdi.
 *
 * Denetlenen şey dar ve bu bilerek: her `import { … } from "@kalem/…"`
 * satırındaki her ad, o paketin gerçekten dışa aktardığı bir şey mi.
 * Tip denetimi değil — örnekler kısaltılmış ve bağlamsız olduğu için
 * derlenmeleri beklenmiyor; ama **yazılan adların** var olması
 * beklenebilir.
 *
 * ## İkinci denetim: API referansı eksiksiz mi
 *
 * F6-04 referansı TypeDoc'tan üretiyor, yani sapması mümkün değil — ama
 * bir girişin **listeden düşmesi** mümkün. Yeni bir paket eklenip
 * `astro.config.mjs`e yazılmazsa referans sessizce eksik kalır ve kimse
 * fark etmez.
 *
 * Bu yüzden her genel girişin dışa aktardığı her ad, üretilen markdown'da
 * geçiyor mu diye bakılıyor. Referans üretilmemişse (yalnızca
 * `pnpm docs:build` üretiyor) denetim **atlanıyor** ve rapor bunu
 * söylüyor.
 *
 * Kullanım: node scripts/guard-docs.mjs [--quiet]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = fileURLToPath(new URL("../", import.meta.url));
const ICERIK = join(KOK, "apps", "docs", "src", "content", "docs");
const PAKETLER = join(KOK, "packages");
const SESSIZ = process.argv.includes("--quiet");

const hatalar = [];

// ---------------------------------------------------------------------------
// Paketlerin dışa aktardığı adlar
// ---------------------------------------------------------------------------

/**
 * Bir giriş dosyasındaki dışa aktarma adlarını toplar.
 *
 * Kaynak okunuyor, derlenmiş çıktı değil: kapı `pnpm build` çalışmadan da
 * anlamlı olmalı. `export { a, b as c }` ve `export type { … }` biçimleri
 * yeterli — depodaki bütün giriş dosyaları bu iki kalıbı kullanıyor.
 */
function disaAktarilanlar(dosya) {
	const adlar = new Set();
	if (!existsSync(dosya)) return adlar;
	const kod = readFileSync(dosya, "utf8");

	for (const m of kod.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
		for (const parca of m[1].split(",")) {
			const ad = parca
				.trim()
				.split(/\s+as\s+/)
				.at(-1)
				?.trim();
			if (ad !== undefined && ad !== "") adlar.add(ad);
		}
	}
	// `export function x`, `export const x`, `export class x`
	for (const m of kod.matchAll(
		/export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
	)) {
		adlar.add(m[1]);
	}
	return adlar;
}

/** Paket adı → dışa aktardığı adlar. Alt girişler de ayrı anahtar. */
function paketHaritasi() {
	const harita = new Map();
	for (const dizin of readdirSync(PAKETLER)) {
		const pkgYolu = join(PAKETLER, dizin, "package.json");
		if (!existsSync(pkgYolu)) continue;
		const pkg = JSON.parse(readFileSync(pkgYolu, "utf8"));
		const src = join(PAKETLER, dizin, "src");

		for (const [alt, hedef] of Object.entries(pkg.exports ?? {})) {
			// `kalem-source` koşulu kaynağa işaret ediyor; kapının istediği de o.
			const kaynak = typeof hedef === "string" ? hedef : hedef["kalem-source"];
			if (typeof kaynak !== "string" || !kaynak.endsWith(".ts")) continue;
			const ad = alt === "." ? pkg.name : `${pkg.name}/${alt.slice(2)}`;
			harita.set(ad, disaAktarilanlar(join(PAKETLER, dizin, kaynak.replace(/^\.\//, ""))));
		}
		// Joker giriş (`./langs/*`) ve CSS girişleri denetlenmiyor.
		if (!harita.has(pkg.name) && existsSync(join(src, "index.ts"))) {
			harita.set(pkg.name, disaAktarilanlar(join(src, "index.ts")));
		}
	}
	return harita;
}

// ---------------------------------------------------------------------------
// Doküman taraması
// ---------------------------------------------------------------------------

function sayfalar(dizin) {
	const cikti = [];
	for (const giris of readdirSync(dizin, { withFileTypes: true })) {
		const yol = join(dizin, giris.name);
		if (giris.isDirectory()) cikti.push(...sayfalar(yol));
		else if (/\.mdx?$/.test(giris.name)) cikti.push(yol);
	}
	return cikti;
}

const harita = paketHaritasi();
const sayfaListesi = existsSync(ICERIK) ? sayfalar(ICERIK) : [];
let denetlenen = 0;

const API = join(ICERIK, "api");

for (const sayfa of sayfaListesi) {
	// Üretilen referans denetim dışı: kaynağın kendisinden üretiliyor,
	// import adlarını ona sormak dairesel olurdu.
	if (sayfa.startsWith(API)) continue;
	const kod = readFileSync(sayfa, "utf8");
	const kisaAd = sayfa.slice(ICERIK.length + 1).replaceAll("\\", "/");

	for (const m of kod.matchAll(
		/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](@kalem\/[^'"]+)['"]/g,
	)) {
		const paket = m[2];
		// CSS girişleri ve dil paketleri denetim dışı.
		if (paket.endsWith(".css") || paket.includes("/langs/")) continue;

		const bilinen = harita.get(paket);
		if (bilinen === undefined) {
			hatalar.push({ sayfa: kisaAd, mesaj: `bilinmeyen paket: ${paket}` });
			continue;
		}
		for (const parca of m[1].split(",")) {
			const ad = parca
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)[0]
				?.trim();
			if (ad === undefined || ad === "") continue;
			denetlenen++;
			if (!bilinen.has(ad)) {
				hatalar.push({ sayfa: kisaAd, mesaj: `${paket} → "${ad}" diye bir dışa aktarma yok` });
			}
		}
	}
}

// ---------------------------------------------------------------------------
// API referansı eksiksiz mi
// ---------------------------------------------------------------------------

const apiSayfalari = existsSync(API) ? sayfalar(API) : [];
const apiAtlandi = apiSayfalari.length === 0;
let kapsanan = 0;

if (!apiAtlandi) {
	// Bütün referans tek dizede aranıyor: bir adın hangi sayfada geçtiği
	// önemli değil, **geçip geçmediği** önemli.
	const tumu = apiSayfalari.map((y) => readFileSync(y, "utf8")).join("\n");
	for (const [paket, adlar] of harita) {
		for (const ad of adlar) {
			kapsanan++;
			// Sözcük sınırı: `parse` adı `parseBlocks` içinde geçmiş sayılmamalı.
			if (!new RegExp(`\\b${ad}\\b`).test(tumu)) {
				hatalar.push({ sayfa: "api/", mesaj: `${paket} → "${ad}" referansta yok` });
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Rapor
// ---------------------------------------------------------------------------

if (hatalar.length === 0) {
	if (!SESSIZ) {
		const api = apiAtlandi
			? "API referansı üretilmemiş (atlandı)"
			: `${kapsanan} genel ad referansta`;
		console.log(
			`✓ doküman kapısı: ${sayfaListesi.length - apiSayfalari.length} sayfa, ` +
				`${denetlenen} import adı doğrulandı · ${api}`,
		);
	}
	process.exit(0);
}

console.error(`\n✗ doküman kapısı: ${hatalar.length} sorun\n`);
for (const h of hatalar) console.error(`  [${h.sayfa}] ${h.mesaj}`);
console.error(
	"\nDoküman, var olmayan bir API'yi anlatıyor. Örneği düzeltin ya da\n" +
		"API'yi gerçekten ekleyin — okuyucu kopyaladığında çalışmalı.\n",
);
process.exit(1);
