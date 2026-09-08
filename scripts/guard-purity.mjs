#!/usr/bin/env node
/**
 * KORUYUCU KAPI 1/3 — Saflık kapısı  (İş listesi: F0-07)
 *
 * Projenin iki vaadini otomatik korur:
 *   1. "Vue projene React sızmaz"  → çekirdek paketlerde 3rd-party bağımlılık yok,
 *      üretim bundle'ında react/vue/preact izi yok.
 *   2. "@kalem/core SSR güvenlidir" → core bundle'ı DOM'a dokunmaz.
 *
 * Bu kapı olmadan vaatler zamanla erir: birisi "sadece şu ufak yardımcıyı
 * çekeyim" der, altı ay sonra kütüphane 3 bağımlılıklı olur.
 *
 * Kullanım: node scripts/guard-purity.mjs [--root DIR]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

const kokIdx = process.argv.indexOf("--root");
const KOK = kokIdx === -1 ? process.cwd() : process.argv[kokIdx + 1];
const SESSIZ = process.argv.includes("--quiet");

const CEKIRDEK = ["core", "viewer", "editor", "ui"];
const YASAK_FRAMEWORK = [
	"react",
	"react-dom",
	"preact",
	"vue",
	"@vue/runtime-dom",
	"svelte",
	"solid-js",
];
const DOM_GLOBALLERI = [
	"document",
	"window",
	"navigator",
	"localStorage",
	"sessionStorage",
	"HTMLElement",
];

const hatalar = [];
const hata = (paket, mesaj, ipucu) => hatalar.push({ paket, mesaj, ipucu });

/** Bundle'daki import/require hedeflerini çıkarır. */
function importHedefleri(kod) {
	const hedefler = new Set();
	const desenler = [
		/\bfrom\s*["']([^"']+)["']/g,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
		/\bimport\s*["']([^"']+)["']/g,
		/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
	];
	for (const re of desenler) {
		let m = re.exec(kod);
		while (m !== null) {
			hedefler.add(m[1]);
			m = re.exec(kod);
		}
	}
	return hedefler;
}

function distDosyalari(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => /\.(js|cjs|mjs)$/.test(f))
		.map((f) => join(dir, f));
}

for (const ad of CEKIRDEK) {
	const dir = join(KOK, "packages", ad);
	const pkgYolu = join(dir, "package.json");
	if (!existsSync(pkgYolu)) {
		hata(ad, "package.json bulunamadı", `beklenen yol: ${pkgYolu}`);
		continue;
	}
	const pkg = JSON.parse(readFileSync(pkgYolu, "utf8"));

	// --- 1. Bağımlılık beyanı -------------------------------------------------
	for (const [d] of Object.entries(pkg.dependencies ?? {})) {
		if (!d.startsWith("@kalem/")) {
			hata(
				ad,
				`3rd-party bağımlılık beyan edilmiş: "${d}"`,
				"Çekirdek paketlerde yalnızca @kalem/* bağımlılığına izin var. Kodu içeri al ya da opsiyonel bir eklenti paketine taşı.",
			);
		}
	}
	for (const [d] of Object.entries(pkg.peerDependencies ?? {})) {
		hata(
			ad,
			`peerDependency beyan edilmiş: "${d}"`,
			"Çekirdek paketlerin peerDependencies'i boş olmalı. Framework bağı yalnızca @kalem/react, @kalem/vue gibi sarmalayıcılarda olur.",
		);
	}

	// --- 2. Yayın hijyeni -----------------------------------------------------
	if (pkg.sideEffects !== false)
		hata(ad, "sideEffects: false eksik", "Tree-shaking bunsuz çalışmaz; boyut bütçesi tutmaz.");
	if (!pkg.exports?.["."])
		hata(ad, "exports haritası eksik", "exports['.'] types/import/require üçlüsünü içermeli.");
	if (pkg.license !== "MIT") hata(ad, `license "${pkg.license}" — MIT bekleniyordu`, "");

	// --- 3. Bundle içeriği ----------------------------------------------------
	const dist = join(dir, "dist");
	const dosyalar = distDosyalari(dist);
	if (dosyalar.length === 0) {
		hata(
			ad,
			"dist/ boş veya yok",
			"Önce `pnpm build` çalıştır — saflık kapısı derlenmiş bundle'ı denetler.",
		);
		continue;
	}
	for (const dosya of dosyalar) {
		const kod = readFileSync(dosya, "utf8");
		const kisa = dosya
			.slice(KOK.length + 1)
			.split(sep)
			.join("/");

		for (const hedef of importHedefleri(kod)) {
			const kokPaket = hedef.startsWith("@")
				? hedef.split("/").slice(0, 2).join("/")
				: hedef.split("/")[0];
			if (YASAK_FRAMEWORK.includes(kokPaket)) {
				hata(
					ad,
					`${kisa} → "${hedef}" import ediyor`,
					"Framework sızıntısı. Kullanıcının Vue projesine React girmesinin tam olarak bu şekilde önlenmesi gerekiyordu.",
				);
			}
		}

		if (ad === "core") {
			for (const g of DOM_GLOBALLERI) {
				const re = new RegExp(String.raw`(^|[^\w$.])` + g + String.raw`\b`);
				if (re.test(kod)) {
					hata(
						ad,
						`${kisa} → DOM globali "${g}" kullanıyor`,
						"@kalem/core sunucuda (SSR, Node, worker) çalışabilmeli. DOM'a dokunan kod @kalem/viewer ya da @kalem/editor'e ait.",
					);
				}
			}
		}
	}
}

if (hatalar.length === 0) {
	if (!SESSIZ)
		console.log(`✓ saflık kapısı: ${CEKIRDEK.length} paket temiz (0 framework izi, core DOM'suz)`);
	process.exit(0);
}

if (!SESSIZ) {
	console.error(`\n✗ SAFLIK KAPISI — ${hatalar.length} ihlal\n`);
	for (const h of hatalar) {
		console.error(`  [@kalem/${h.paket}] ${h.mesaj}`);
		if (h.ipucu) console.error(`      ${h.ipucu}`);
		console.error("");
	}
}
process.exit(1);
