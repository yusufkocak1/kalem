#!/usr/bin/env node
/**
 * Yayın provası  (İş listesi: F6-12)
 *
 * "npm'e gidecek olan gerçekten çalışıyor mu" sorusunu, **gidecek olanın
 * kendisiyle** cevaplıyor: depodaki kaynakla değil, `pnpm pack`in ürettiği
 * paket dosyalarıyla.
 *
 * ## Neden depo içindeki testler yetmiyor
 *
 * Depodaki her test paketlere çalışma alanı bağlantısıyla (`workspace:`)
 * ulaşıyor. Yayımlanan paket ise başka bir şey: `files` listesinin
 * süzdüğü, `workspace:` yerine gerçek sürüm yazılmış, `exports` haritası
 * bir yabancının `node_modules`unda çözülen bir arşiv. Eksik bir dosya,
 * yanlış bir `exports` yolu ya da unutulmuş bir `workspace:` depoda hiçbir
 * testi kırmıyor — yalnızca ilk kullanıcıyı.
 *
 * ## Ne yapıyor
 *
 * 1. Her paketi `pnpm pack` ile paketliyor.
 * 2. Arşivin içeriğini denetliyor: `README.md`, `LICENSE`, derleme çıktısı
 *    var mı; `src/`, test dosyası, `workspace:` yok mu.
 * 3. `npm publish --dry-run` — kayıt defterinin göreceği şey.
 * 4. Depo **dışında** boş bir projeye yalnızca arşivlerden kuruyor.
 * 5. Node'da her girişi ESM ve CJS olarak yüklüyor; çekirdeği ve
 *    görüntüleyiciyi çalıştırıyor.
 * 6. Bir kullanıcının paketleyicisiyle (esbuild, npm'den) küçük bir
 *    uygulama derliyor ve tarayıcıda yazıyor.
 * 7. `<script>` etiketiyle düşen IIFE derlemesini tarayıcıda sınıyor.
 *
 * Önce `pnpm build`. Ağ gerekiyor (peer bağımlılıklar ve esbuild npm'den).
 *
 * Kullanım: node scripts/yayin-provasi.mjs [--tut]
 *   --tut  geçici projeyi silmiyor (inceleme için)
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const KOK = fileURLToPath(new URL("../", import.meta.url));
const PAKETLER = join(KOK, "packages");
const TUT = process.argv.includes("--tut");
const WIN = process.platform === "win32";

const hatalar = [];
const adim = (s) => console.log(`\n── ${s}`);
const tamam = (s) => console.log(`   ✓ ${s}`);
const hata = (s) => {
	hatalar.push(s);
	console.log(`   ✗ ${s}`);
};

function calistir(komut, argumanlar, cwd, sessiz = true) {
	const sonuc = spawnSync(komut, argumanlar, {
		cwd,
		encoding: "utf8",
		shell: WIN,
		stdio: sessiz ? "pipe" : "inherit",
	});
	if (sonuc.status !== 0) {
		throw new Error(
			`${komut} ${argumanlar.join(" ")} → ${sonuc.status}\n${sonuc.stderr ?? ""}${sonuc.stdout ?? ""}`,
		);
	}
	return sonuc.stdout ?? "";
}

/**
 * `.tgz` arşivini okur: ad → içerik.
 *
 * Harici `tar` kullanılmıyor: Windows'taki GNU tar `C:\…` yolunu uzak
 * sunucu adı sanıyor. Biçim basit — 512 baytlık başlık, ardından 512'ye
 * yuvarlanmış içerik — ve npm arşivleri uzun ad uzantısı kullanmıyor.
 */
function arsivOku(yol) {
	const veri = gunzipSync(readFileSync(yol));
	const dosyalar = new Map();
	const alan = (b, bas, bit) => {
		const ham = b.subarray(bas, bit);
		const son = ham.indexOf(0);
		return ham.subarray(0, son === -1 ? ham.length : son).toString("utf8");
	};
	for (let i = 0; i + 512 <= veri.length; ) {
		const baslik = veri.subarray(i, i + 512);
		const ad = alan(baslik, 0, 100);
		if (ad === "") break;
		const onek = alan(baslik, 345, 500);
		const boyut = Number.parseInt(alan(baslik, 124, 136).trim() || "0", 8);
		dosyalar.set(onek === "" ? ad : `${onek}/${ad}`, veri.subarray(i + 512, i + 512 + boyut));
		i += 512 + Math.ceil(boyut / 512) * 512;
	}
	return dosyalar;
}

const GECICI = mkdtempSync(join(tmpdir(), "kalem-prova-"));
const ARSIV = join(GECICI, "arsiv");
const PROJE = join(GECICI, "proje");
mkdirSync(ARSIV);
mkdirSync(PROJE);

try {
	// -----------------------------------------------------------------------
	adim("1 · Paketleme");
	const paketler = readdirSync(PAKETLER)
		.map((d) => ({
			dizin: join(PAKETLER, d),
			pkg: JSON.parse(readFileSync(join(PAKETLER, d, "package.json"), "utf8")),
		}))
		.filter((p) => p.pkg.private !== true);

	const arsivler = new Map();
	for (const { dizin, pkg } of paketler) {
		calistir("pnpm", ["pack", "--pack-destination", ARSIV], dizin);
		const ad = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;
		const yol = join(ARSIV, ad);
		if (!existsSync(yol)) throw new Error(`arşiv bulunamadı: ${ad}`);
		arsivler.set(pkg.name, yol);
	}
	tamam(`${arsivler.size} paket`);

	// -----------------------------------------------------------------------
	adim("2 · Arşiv içeriği");
	for (const [ad, yol] of arsivler) {
		const icerik = arsivOku(yol);
		const liste = [...icerik.keys()];
		const varMi = (d) => icerik.has(`package/${d}`);
		const pkgMetni = icerik.get("package/package.json")?.toString("utf8") ?? "{}";
		const pkg = JSON.parse(pkgMetni);

		const eksik = ["package.json", "README.md", "LICENSE"].filter((d) => !varMi(d));
		if (eksik.length > 0) hata(`${ad}: eksik ${eksik.join(", ")}`);
		const cikti = liste.filter(
			(d) => d.startsWith("package/dist/") || d.startsWith("package/css/"),
		);
		if (cikti.length === 0) hata(`${ad}: derleme çıktısı yok`);
		const fazla = liste.filter((d) => /\/src\/|\.test\.|\.spec\.|tsconfig|\.tsbuild/.test(d));
		if (fazla.length > 0)
			hata(`${ad}: yayımlanmaması gereken dosyalar: ${fazla.slice(0, 3).join(", ")}`);
		if (pkgMetni.includes("workspace:")) hata(`${ad}: package.json içinde "workspace:" kalmış`);
		if (pkgMetni.includes("catalog:")) hata(`${ad}: package.json içinde "catalog:" kalmış`);
		if (pkg.repository?.url === undefined) hata(`${ad}: repository yok (provenance için gerekli)`);

		// `exports` haritasının gösterdiği her dosya arşivde mi.
		const yollar = new Set();
		const topla = (d) => {
			if (typeof d === "string") yollar.add(d);
			else if (d !== null && typeof d === "object") for (const v of Object.values(d)) topla(v);
		};
		topla(pkg.exports);
		for (const hedef of yollar) {
			if (!hedef.startsWith("./") || hedef.includes("*")) continue;
			// Depo içi geliştirme koşulu; yayımlanan pakette çözülmesi beklenmiyor.
			if (hedef.startsWith("./src/")) continue;
			if (!varMi(hedef.slice(2))) hata(`${ad}: exports "${hedef}" arşivde yok`);
		}
	}
	if (hatalar.length === 0)
		tamam("README, LICENSE, çıktı, exports yolları tamam; src/test/workspace yok");

	// -----------------------------------------------------------------------
	adim("3 · npm publish --dry-run");
	for (const [ad, yol] of arsivler) {
		const sonuc = spawnSync(
			"npm",
			["publish", yol, "--dry-run", "--access", "public", "--ignore-scripts"],
			{
				encoding: "utf8",
				shell: WIN,
			},
		);
		const cikti = `${sonuc.stdout}${sonuc.stderr}`;
		if (sonuc.status !== 0)
			hata(`${ad}: npm publish --dry-run → ${sonuc.status}: ${cikti.trim().split("\n").at(-1)}`);
	}
	if (!hatalar.some((h) => h.includes("dry-run")))
		tamam(`${arsivler.size} paket kayıt defterine gönderilebilir`);

	// -----------------------------------------------------------------------
	adim("4 · Temiz projeye kurulum (yalnızca arşivlerden)");
	writeFileSync(
		join(PROJE, "package.json"),
		JSON.stringify({ name: "kalem-prova", private: true, type: "module" }, null, 2),
	);
	calistir(
		"npm",
		[
			"install",
			"--no-audit",
			"--no-fund",
			...arsivler.values(),
			"react",
			"react-dom",
			"vue",
			"esbuild",
		],
		PROJE,
	);
	tamam(`kuruldu: ${PROJE}`);

	// -----------------------------------------------------------------------
	adim("5 · Node: ESM ve CJS");
	const girisler = [];
	for (const ad of arsivler.keys()) {
		const pkg = JSON.parse(readFileSync(join(PROJE, "node_modules", ad, "package.json"), "utf8"));
		for (const [alt, hedef] of Object.entries(pkg.exports ?? {})) {
			if (alt === "./package.json" || alt.includes("*") || alt.endsWith(".css")) continue;
			if (typeof hedef === "string" && hedef.endsWith(".css")) continue;
			girisler.push(`${ad}${alt === "." ? "" : alt.slice(1)}`);
		}
	}
	writeFileSync(
		join(PROJE, "esm.mjs"),
		`${girisler.map((g, i) => `import * as m${i} from ${JSON.stringify(g)};`).join("\n")}
import { parse, serialize } from "@kalem-editor/core";
import { renderToString } from "@kalem-editor/viewer";
const md = "* list\\n\\n1) item\\n";
if (serialize(parse(md)) !== md) throw new Error("gidiş-dönüş bozuk");
if (!renderToString(parse("# Hi")).includes("<h1")) throw new Error("renderToString bozuk");
console.log(${girisler.length});
`,
	);
	const esm = calistir("node", ["esm.mjs"], PROJE).trim();
	tamam(`ESM: ${esm} giriş yüklendi, parse/serialize/renderToString çalışıyor`);

	writeFileSync(
		join(PROJE, "cjs.cjs"),
		`const girisler = ${JSON.stringify(girisler)};
let n = 0;
for (const g of girisler) {
  // Tarayıcıya özgü IIFE ve yan etkili kayıt girişleri Node'da çalışmıyor;
  // onlar tarayıcı adımında sınanıyor.
  if (/define$/.test(g)) continue;
  require(g); n++;
}
const { parse, serialize } = require("@kalem-editor/core");
if (serialize(parse("_a_\\n")) !== "_a_\\n") throw new Error("CJS gidiş-dönüş bozuk");
console.log(n);
`,
	);
	const cjs = calistir("node", ["cjs.cjs"], PROJE).trim();
	tamam(`CJS: ${cjs} giriş require ile yüklendi`);

	// -----------------------------------------------------------------------
	adim("6 · Paketleyiciyle derlenmiş uygulama, tarayıcıda");
	writeFileSync(
		join(PROJE, "uygulama.js"),
		`import { Editor } from "@kalem-editor/editor";
import { mountUi } from "@kalem-editor/ui";
import { codeHighlightPlugin } from "@kalem-editor/plugin-code-highlight";
import { findReplacePlugin } from "@kalem-editor/plugin-find-replace";
import { wordCountPlugin } from "@kalem-editor/plugin-word-count";
import "@kalem-editor/themes/tokens.css";
import "@kalem-editor/themes/viewer.css";
import "@kalem-editor/themes/editor.css";
import "@kalem-editor/themes/ui.css";

const editor = new Editor(document.getElementById("app"), {
  value: "# Hello\\n\\nText.\\n",
  lang: "en",
  label: "Document",
  plugins: [codeHighlightPlugin(), findReplacePlugin(), wordCountPlugin({ container: document.getElementById("sayac") })],
});
mountUi(editor, { toolbar: "both" });
window.editor = editor;
`,
	);
	calistir(
		"npx",
		[
			"esbuild",
			"uygulama.js",
			"--bundle",
			"--format=esm",
			"--splitting",
			"--outdir=out",
			"--loader:.css=css",
		],
		PROJE,
	);
	writeFileSync(
		join(PROJE, "out", "index.html"),
		`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="uygulama.css">
<div id="app" class="kalem-theme"></div><div id="sayac"></div>
<script type="module" src="uygulama.js"></script>`,
	);

	// -----------------------------------------------------------------------
	const iife = join(PROJE, "node_modules", "@kalem-editor", "wc", "dist", "kalem-editor.iife.js");
	writeFileSync(
		join(PROJE, "out", "iife.html"),
		`<!doctype html><meta charset="utf-8">
<kalem-editor label="Doc"># From a script tag</kalem-editor>
<script src="kalem-editor.iife.js"></script>`,
	);
	writeFileSync(join(PROJE, "out", "kalem-editor.iife.js"), readFileSync(iife));

	const sunucu = spawnSync; // yalnızca tip ipucu
	void sunucu;
	const { createServer } = await import("node:http");
	const tipler = {
		".html": "text/html; charset=utf-8",
		".js": "text/javascript",
		".css": "text/css",
	};
	const srv = createServer((istek, yanit) => {
		const yol = join(PROJE, "out", decodeURIComponent((istek.url ?? "/").split("?")[0]));
		if (!existsSync(yol)) {
			yanit.writeHead(404).end();
			return;
		}
		const uzanti = yol.slice(yol.lastIndexOf("."));
		yanit.writeHead(200, { "content-type": tipler[uzanti] ?? "application/octet-stream" });
		yanit.end(readFileSync(yol));
	});
	await new Promise((coz) => srv.listen(0, coz));
	const port = srv.address().port;

	const tarayici = await chromium.launch();
	try {
		const sayfa = await tarayici.newPage();
		const sayfaHatalari = [];
		sayfa.on("pageerror", (e) => sayfaHatalari.push(e.message));
		await sayfa.goto(`http://localhost:${port}/index.html`);
		await sayfa.waitForFunction(() => window.editor !== undefined);
		await sayfa.locator("#app p").first().click();
		await sayfa.keyboard.press("End");
		await sayfa.keyboard.type(" Typed.");
		const deger = await sayfa.evaluate(() => window.editor.getValue());
		if (deger !== "# Hello\n\nText. Typed.\n")
			hata(`paketleyiciyle derlenen uygulama: beklenmeyen değer ${JSON.stringify(deger)}`);
		else tamam("esbuild ile derlenen uygulamada yazma çalışıyor");
		if ((await sayfa.locator(".kalem-toolbar").count()) !== 1) hata("sabit araç çubuğu yok");
		if ((await sayfa.locator("#sayac").textContent())?.trim() === "") hata("kelime sayacı boş");
		if (sayfaHatalari.length > 0) hata(`sayfa hatası: ${sayfaHatalari.join(" · ")}`);

		adim("7 · <script> etiketiyle IIFE");
		const iifeSayfa = await tarayici.newPage();
		await iifeSayfa.goto(`http://localhost:${port}/iife.html`);
		await iifeSayfa.waitForFunction(() => customElements.get("kalem-editor") !== undefined);
		const baslik = await iifeSayfa.locator("kalem-editor h1").textContent();
		if (baslik !== "From a script tag") hata(`IIFE: başlık ${JSON.stringify(baslik)}`);
		else tamam("<kalem-editor> tek script etiketiyle çalışıyor");
	} finally {
		await tarayici.close();
		srv.close();
	}
} catch (e) {
	hata(String(e instanceof Error ? e.message : e));
} finally {
	if (!TUT) rmSync(GECICI, { recursive: true, force: true });
	else console.log(`\nGeçici proje: ${GECICI}`);
}

console.log(hatalar.length === 0 ? "\n✓ Yayın provası geçti." : `\n✗ ${hatalar.length} sorun.`);
process.exit(hatalar.length === 0 ? 0 : 1);
