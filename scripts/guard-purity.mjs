#!/usr/bin/env node
/**
 * KORUYUCU KAPI 1/3 — Saflık kapısı  (İş listesi: F0-07)
 *
 * Projenin iki vaadini otomatik korur:
 *   1. "Vue projene React sızmaz"  → çekirdek paketlerde 3rd-party bağımlılık yok,
 *      üretim bundle'ında react/vue/preact izi yok.
 *   2. "@kalem-editor/core SSR güvenlidir" → core bundle'ı DOM'a dokunmaz.
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
		if (!d.startsWith("@kalem-editor/")) {
			hata(
				ad,
				`3rd-party bağımlılık beyan edilmiş: "${d}"`,
				"Çekirdek paketlerde yalnızca @kalem-editor/* bağımlılığına izin var. Kodu içeri al ya da opsiyonel bir eklenti paketine taşı.",
			);
		}
	}
	for (const [d] of Object.entries(pkg.peerDependencies ?? {})) {
		hata(
			ad,
			`peerDependency beyan edilmiş: "${d}"`,
			"Çekirdek paketlerin peerDependencies'i boş olmalı. Framework bağı yalnızca @kalem-editor/react, @kalem-editor/vue gibi sarmalayıcılarda olur.",
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
			// Node yerleşikleri: core hem tarayıcıda hem sunucuda çalışmalı.
			// Test dosyaları `node:fs` kullanabilir (tipler açık) ama bunlar
			// dist'e girmez; kapı tam olarak bu ayrımı zorluyor.
			for (const hedef of importHedefleri(kod)) {
				if (hedef.startsWith("node:")) {
					hata(
						ad,
						`${kisa} → Node yerleşiği "${hedef}" import ediyor`,
						"@kalem-editor/core tarayıcıda da çalışmalı. Node'a özgü kod viewer/editor tarafına ya da ayrı bir pakete ait.",
					);
				}
			}

			for (const g of DOM_GLOBALLERI) {
				const re = new RegExp(String.raw`(^|[^\w$.])` + g + String.raw`\b`);
				if (re.test(kod)) {
					hata(
						ad,
						`${kisa} → DOM globali "${g}" kullanıyor`,
						"@kalem-editor/core sunucuda (SSR, Node, worker) çalışabilmeli. DOM'a dokunan kod @kalem-editor/viewer ya da @kalem-editor/editor'e ait.",
					);
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 3. Gömülebilirlik: yayımlanan çıktıda ham kontrol karakteri yok
//
// Ham bir NUL, dosya olarak servis edildiğinde sorun çıkarmıyor ama paketi
// bir HTML sayfasına **gömen** herkesi vuruyor: tarayıcının ayrıştırıcısı
// `<script>` içindeki NUL'u U+FFFD'ye çeviriyor ve o karakter bir regex
// sınıfının içindeyse sınıf geçersiz oluyor.
//
// Tam olarak bu yaşandı: `security.ts`in URL normalizasyon regex'i
// kaynakta ham kontrol karakterleriyle yazılmıştı; `kalem-editor.iife.js`
// bir sayfaya gömüldüğünde "Range out of order in character class" ile
// açılışta düşüyordu. Dosya olarak yüklendiğinde ise sorunsuz — yani
// mevcut testlerin hiçbiri yakalayamıyordu.
//
// Kaçış dizisi (`\u0000`) aynı anlamı taşıyor ve her bağlamda güvenli.
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noControlCharactersInRegex: aranan şey tam olarak bunlar
const HAM_KONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

for (const ad of readdirSync(join(KOK, "packages"))) {
	for (const dosya of distDosyalari(join(KOK, "packages", ad, "dist"))) {
		const kod = readFileSync(dosya, "utf8");
		const m = HAM_KONTROL.exec(kod);
		if (m === null) continue;
		const kodNo = m[0].charCodeAt(0).toString(16).padStart(4, "0");
		hata(
			ad,
			`${dosya.split(sep).slice(-2).join("/")} → ham kontrol karakteri U+${kodNo}`,
			"Kaynakta kaçış dizisi kullanın (backslash-u0000 gibi). Ham hâli, paket bir HTML sayfasına gömüldüğünde tarayıcı tarafından U+FFFD'ye çevriliyor.",
		);
	}
}

if (hatalar.length === 0) {
	if (!SESSIZ) {
		console.log(
			`✓ saflık kapısı: ${CEKIRDEK.length} paket temiz ` +
				"(0 framework izi, core DOM'suz, çıktıda ham kontrol karakteri yok)",
		);
	}
	process.exit(0);
}

if (!SESSIZ) {
	console.error(`\n✗ SAFLIK KAPISI — ${hatalar.length} ihlal\n`);
	for (const h of hatalar) {
		console.error(`  [@kalem-editor/${h.paket}] ${h.mesaj}`);
		if (h.ipucu) console.error(`      ${h.ipucu}`);
		console.error("");
	}
}
process.exit(1);
