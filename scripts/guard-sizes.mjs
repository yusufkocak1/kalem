#!/usr/bin/env node
/**
 * KORUYUCU KAPI — Boyut iddiaları  (İş listesi: F6-11)
 *
 * Belgelerde, README'de ve duyuru metinlerinde yazan boyutlar **bugünkü
 * ölçümle** aynı mı?
 *
 * Bu kapı bir tahminden doğmadı. F6-05'te giriş sayfasına "editör + arayüz
 * 34,6 kB" yazıldı ve bir test o metni sabitledi. Beş görev sonra ölçüm
 * 35,0 kB'ydı; test hâlâ geçiyordu, çünkü sınadığı şey sayfanın **kendi
 * yazdığı** sayıydı, ölçüm değil. Aynı anda on bir sayfada daha eski sayı
 * duruyordu (`find-replace` 4,4 → 4,3; `core` 11,5 → 11,7). Duyurunun
 * başlığındaki sayının yanlış olması, bir okuyucunun `size-limit`i çalıştırıp
 * bulacağı ilk şey olurdu.
 *
 * ## Nasıl
 *
 * Her iddia bir dosya, bir desen ve bir (ya da birkaç) `size-limit` girdisi.
 * Desenin yakaladığı sayı ölçümle, **yazarın seçtiği hassasiyette**
 * karşılaştırılıyor: "26 kB" tam sayıya, "35,0 kB" tek haneye, "1,98 kB" iki
 * haneye yuvarlanıyor; "903 B" bayt olarak. Ondalık ayırıcı metinden
 * okunuyor — Türkçe sayfada virgül, İngilizce'de nokta.
 *
 * Bir desen **hiç eşleşmezse** de kapı kırmızı: metin değişmiş ve iddia
 * denetimden sessizce düşmüş demek.
 *
 * Rakip kütüphanelerin boyutları burada yok; onlar ölçülmüyor ve sayfada
 * "yaklaşık" diye yazıyor.
 *
 * Önce `pnpm build` gerekiyor (`size-limit` derlenmiş çıktıyı ölçüyor).
 *
 * `--fix` eski sayıları ölçümle **yerinde** değiştiriyor — biçim (birim,
 * hane, ayırıcı) korunarak. Paket büyüdüğünde on beş dosyayı elle
 * düzeltmek yerine bir komut; kayıp iddialar yine elle düzeltilmeli, çünkü
 * orada metnin kendisi değişmiş.
 *
 * Kullanım: node scripts/guard-sizes.mjs [--quiet] [--fix]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = fileURLToPath(new URL("../", import.meta.url));
const SESSIZ = process.argv.includes("--quiet");
const DUZELT = process.argv.includes("--fix");
const DOCS = "apps/docs/src/content/docs";
const EN = `${DOCS}/en`;

// size-limit girdilerinin adları (.size-limit.json)
const CORE = "@kalem/core";
const VIEWER = "@kalem/viewer";
const EDITOR = "@kalem/editor (core dahil)";
const WORD = "@kalem/editor + @kalem/ui — Word deneyimi";
const IIFE = "@kalem/wc — <script> ile düşen tam paket (çekirdek + editör dâhil)";
const REACT = "@kalem/react (React ve editör hariç)";
const VUE = "@kalem/vue (Vue ve editör hariç)";
const WC = "@kalem/wc (editör hariç)";

const SAYI = String.raw`(\d+(?:[.,]\d+)? k?B)`;

/** Etiketten sonra, aynı satırdaki ilk boyut. Tablo satırları için. */
function sonra(etiket) {
	const kacis = etiket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`${kacis}[^\\n]*?${SAYI}`, "d");
}

/** Serbest desen: `SAYI` yer tutucusu boyutu yakalıyor. */
function desen(kaynak) {
	return new RegExp(kaynak.replaceAll("SAYI", SAYI), "d");
}

/**
 * İddialar. `olcum` bir girdi adı ya da toplanacak adların dizisi; desende
 * birden çok grup varsa `olcum` her grup için bir öğe taşıyan dizi.
 */
const IDDIALAR = [
	// README — GitHub ve npm'in ilk gösterdiği sayfa
	{ dosya: "README.md", desen: sonra("`@kalem/viewer` |"), olcum: VIEWER },
	{ dosya: "README.md", desen: sonra("`@kalem/core` |"), olcum: CORE },
	{ dosya: "README.md", desen: sonra("| `@kalem/editor` |"), olcum: EDITOR },
	{ dosya: "README.md", desen: sonra("`@kalem/editor` + `@kalem/ui` |"), olcum: WORD },
	{ dosya: "README.md", desen: sonra("`@kalem/wc` (IIFE build) |"), olcum: IIFE },
	{ dosya: "README.md", desen: sonra("Editor + UI (min+gzip) |"), olcum: WORD },

	// Duyuru metinleri ve sosyal önizleme
	{ dosya: "docs/duyuru/show-hn.md", desen: desen("SAYI for the parser"), olcum: CORE },
	{ dosya: "docs/duyuru/show-hn.md", desen: desen("SAYI for the editor plus"), olcum: WORD },
	{ dosya: "docs/duyuru/devto.md", desen: sonra("| `@kalem/core` |"), olcum: CORE },
	{ dosya: "docs/duyuru/devto.md", desen: sonra("| `@kalem/viewer` |"), olcum: VIEWER },
	{ dosya: "docs/duyuru/devto.md", desen: sonra("| `@kalem/editor` |"), olcum: EDITOR },
	{ dosya: "docs/duyuru/devto.md", desen: sonra("`@kalem/editor` + `@kalem/ui` |"), olcum: WORD },
	{ dosya: "scripts/duyuru/onizleme.html", desen: desen('id="boyut">SAYI'), olcum: WORD },
	{ dosya: "docs/duyuru/sosyal.md", desen: desen("dependencies; SAYI min\\+gzip"), olcum: WORD },

	// Doküman sitesi — giriş sayfası
	{ dosya: `${DOCS}/index.mdx`, desen: sonra("<b>editör + arayüz</b>"), olcum: WORD },
	{ dosya: `${DOCS}/index.mdx`, desen: sonra("<b>çekirdek</b>"), olcum: CORE },
	{ dosya: `${DOCS}/index.mdx`, desen: sonra("<b>görüntüleyici</b>"), olcum: VIEWER },
	{ dosya: `${DOCS}/index.mdx`, desen: sonra("Editör + arayüz (min+gzip) |"), olcum: WORD },

	// Başlangıç ve mimari
	{ dosya: `${DOCS}/baslangic.md`, desen: sonra("`@kalem/viewer` |"), olcum: VIEWER },
	{ dosya: `${DOCS}/baslangic.md`, desen: sonra("`@kalem/core` |"), olcum: CORE },
	{ dosya: `${DOCS}/baslangic.md`, desen: sonra("| `@kalem/editor` |"), olcum: EDITOR },
	{ dosya: `${DOCS}/baslangic.md`, desen: sonra("`@kalem/editor` + `@kalem/ui` |"), olcum: WORD },
	{
		dosya: `${DOCS}/baslangic.md`,
		desen: desen("`@kalem/react` SAYI, `@kalem/vue` SAYI, `@kalem/wc` SAYI"),
		olcum: [REACT, VUE, WC],
	},
	{ dosya: `${DOCS}/mimari.md`, desen: sonra("| `@kalem/core` |"), olcum: CORE },
	{ dosya: `${DOCS}/mimari.md`, desen: sonra("| `@kalem/viewer` |"), olcum: VIEWER },
	{ dosya: `${DOCS}/mimari.md`, desen: sonra("`@kalem/editor` (çekirdek dâhil) |"), olcum: EDITOR },
	{ dosya: `${DOCS}/mimari.md`, desen: sonra("`@kalem/editor` + `@kalem/ui` |"), olcum: WORD },
	{ dosya: `${DOCS}/mimari.md`, desen: sonra("tek `<script>` derlemesi |"), olcum: IIFE },
	{
		dosya: `${DOCS}/mimari.md`,
		desen: desen("\\| Sarmalayıcılar \\(react / vue / wc\\) \\| SAYI / SAYI / SAYI"),
		olcum: [REACT, VUE, WC],
	},

	// Rehberler ve tarifler
	{
		dosya: `${DOCS}/frameworkler/cdn.md`,
		desen: desen("hepsini içine alıyor: \\*\\*SAYI"),
		olcum: IIFE,
	},
	{
		dosya: `${DOCS}/frameworkler/vanilla.md`,
		desen: desen("SAYI, düzenleme kodu yok"),
		olcum: VIEWER,
	},
	{ dosya: `${DOCS}/rehber/viewer.md`, desen: desen("düzenlemiyor\\. SAYI"), olcum: VIEWER },
	{
		dosya: `${DOCS}/tarifler/salt-okunur.md`,
		desen: desen("SAYI yerine\\s+SAYI:"),
		olcum: [EDITOR, VIEWER],
	},
	{
		dosya: `${DOCS}/tarifler/sunucuda-markdown.md`,
		desen: desen("Toplam SAYI"),
		olcum: [[CORE, VIEWER]],
	},
	{
		dosya: `${DOCS}/tarifler/sunucuda-markdown.md`,
		desen: desen("`@kalem/core` tek başına SAYI"),
		olcum: CORE,
	},
	{
		dosya: `${DOCS}/rehber/temalar.md`,
		desen: sonra("| `ui.css` |"),
		olcum: "@kalem/themes/ui.css",
	},
	...[
		["plugin-code-highlight", "@kalem/plugin-code-highlight (sekiz dil paketi dahil)"],
		["plugin-find-replace", "@kalem/plugin-find-replace"],
		["plugin-image-upload", "@kalem/plugin-image-upload"],
		["plugin-outline", "@kalem/plugin-outline"],
		["plugin-word-count", "@kalem/plugin-word-count"],
		["plugin-source-mode", "@kalem/plugin-source-mode"],
		["plugin-autosave", "@kalem/plugin-autosave"],
	].flatMap(([paket, olcum]) =>
		[`${DOCS}/rehber/eklentiler.md`, `${EN}/rehber/eklentiler.md`].map((dosya) => ({
			dosya,
			desen: sonra(`| \`@kalem/${paket}\` |`),
			olcum,
		})),
	),
	{ dosya: `${DOCS}/rehber/viewer.md`, desen: desen("editörün SAYI'ını"), olcum: EDITOR },
	{
		dosya: `${DOCS}/frameworkler/web-components.md`,
		desen: desen("Kendi boyutu SAYI \\(editör hariç\\)"),
		olcum: WC,
	},
	{ dosya: `${DOCS}/frameworkler/react.md`, desen: desen("Kendi boyutu SAYI"), olcum: REACT },
	{ dosya: `${DOCS}/frameworkler/vue.md`, desen: desen("Kendi boyutu SAYI"), olcum: VUE },

	// Doküman sitesi — İngilizce (`/en/`). Ondalık ayırıcı nokta; `bicimle`
	// ayırıcıyı metinden okuduğu için aynı iddialar yeniden kullanılıyor.
	{ dosya: `${EN}/index.mdx`, desen: sonra("<b>editor + UI</b>"), olcum: WORD },
	{ dosya: `${EN}/index.mdx`, desen: sonra("<b>core</b>"), olcum: CORE },
	{ dosya: `${EN}/index.mdx`, desen: sonra("<b>viewer</b>"), olcum: VIEWER },
	{ dosya: `${EN}/index.mdx`, desen: sonra("Editor + UI (min+gzip) |"), olcum: WORD },
	{ dosya: `${EN}/baslangic.md`, desen: sonra("`@kalem/viewer` |"), olcum: VIEWER },
	{ dosya: `${EN}/baslangic.md`, desen: sonra("`@kalem/core` |"), olcum: CORE },
	{ dosya: `${EN}/baslangic.md`, desen: sonra("| `@kalem/editor` |"), olcum: EDITOR },
	{ dosya: `${EN}/baslangic.md`, desen: sonra("`@kalem/editor` + `@kalem/ui` |"), olcum: WORD },
	{
		dosya: `${EN}/baslangic.md`,
		desen: desen("`@kalem/react` SAYI, `@kalem/vue` SAYI, `@kalem/wc` SAYI"),
		olcum: [REACT, VUE, WC],
	},
	{ dosya: `${EN}/mimari.md`, desen: sonra("| `@kalem/core` |"), olcum: CORE },
	{ dosya: `${EN}/mimari.md`, desen: sonra("| `@kalem/viewer` |"), olcum: VIEWER },
	{ dosya: `${EN}/mimari.md`, desen: sonra("`@kalem/editor` (core included) |"), olcum: EDITOR },
	{ dosya: `${EN}/mimari.md`, desen: sonra("`@kalem/editor` + `@kalem/ui` |"), olcum: WORD },
	{ dosya: `${EN}/mimari.md`, desen: sonra("the single `<script>` build |"), olcum: IIFE },
	{
		dosya: `${EN}/mimari.md`,
		desen: desen("\\| Wrappers \\(react / vue / wc\\) \\| SAYI / SAYI / SAYI"),
		olcum: [REACT, VUE, WC],
	},
	{
		dosya: `${EN}/frameworkler/cdn.md`,
		desen: desen("includes everything: \\*\\*SAYI"),
		olcum: IIFE,
	},
	{ dosya: `${EN}/frameworkler/vanilla.md`, desen: desen("SAYI, no editing code"), olcum: VIEWER },
	{
		dosya: `${EN}/frameworkler/web-components.md`,
		desen: desen("Its own size is SAYI \\(editor not included\\)"),
		olcum: WC,
	},
	{ dosya: `${EN}/frameworkler/react.md`, desen: desen("Its own size is SAYI"), olcum: REACT },
	{ dosya: `${EN}/frameworkler/vue.md`, desen: desen("Its own size is SAYI"), olcum: VUE },
	{ dosya: `${EN}/rehber/viewer.md`, desen: desen("doesn't edit it\\. SAYI"), olcum: VIEWER },
	{ dosya: `${EN}/rehber/viewer.md`, desen: desen("the editor's SAYI"), olcum: EDITOR },
	{
		dosya: `${EN}/tarifler/salt-okunur.md`,
		desen: desen("SAYI instead of SAYI:"),
		olcum: [VIEWER, EDITOR],
	},
	{
		dosya: `${EN}/tarifler/sunucuda-markdown.md`,
		desen: desen("SAYI in total"),
		olcum: [[CORE, VIEWER]],
	},
	{
		dosya: `${EN}/tarifler/sunucuda-markdown.md`,
		desen: desen("`@kalem/core` on its own is SAYI"),
		olcum: CORE,
	},
	{ dosya: `${EN}/rehber/temalar.md`, desen: sonra("| `ui.css` |"), olcum: "@kalem/themes/ui.css" },
];

// ---------------------------------------------------------------------------
// Ölçüm
// ---------------------------------------------------------------------------

function olc() {
	const sonuc = spawnSync("pnpm", ["exec", "size-limit", "--json"], {
		cwd: KOK,
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	// size-limit bütçe aşımında da JSON basıyor ve 1 ile çıkıyor; o durumu
	// `pnpm size` zaten yakalıyor, burada yalnızca sayılar gerekli.
	const json = sonuc.stdout.slice(sonuc.stdout.indexOf("["));
	try {
		return new Map(JSON.parse(json).map((g) => [g.name, g.size]));
	} catch {
		console.error("size-limit çıktısı okunamadı. Önce `pnpm build`.");
		console.error(sonuc.stderr || sonuc.stdout);
		process.exit(1);
	}
}

/** Ölçümü, yazılan sayının biçiminde yazar: aynı birim, hane ve ayırıcı. */
export function bicimle(bayt, ornek) {
	if (!ornek.endsWith("kB")) return `${Math.round(bayt)} B`;
	const sayi = ornek.slice(0, -3);
	const ayirici = sayi.includes(",") ? "," : ".";
	const hane = /[.,](\d+)$/.exec(sayi)?.[1].length ?? 0;
	return `${(bayt / 1000).toFixed(hane).replace(".", ayirici)} kB`;
}

// ---------------------------------------------------------------------------

const olcumler = olc();
const hatalar = [];
let denetlenen = 0;
let duzeltilen = 0;
/** `--fix` için dosya başına bekleyen değişiklikler: [başlangıç, bitiş, yeni]. */
const degisiklikler = new Map();

const toplam = (ad) => {
	const adlar = Array.isArray(ad) ? ad : [ad];
	let t = 0;
	for (const a of adlar) {
		const deger = olcumler.get(a);
		if (deger === undefined) throw new Error(`size-limit girdisi yok: "${a}"`);
		t += deger;
	}
	return t;
};

for (const { dosya, desen: re, olcum } of IDDIALAR) {
	const metin = readFileSync(join(KOK, dosya), "utf8");
	const m = re.exec(metin);
	if (m === null) {
		hatalar.push(`${dosya}: iddia bulunamadı (${re.source.slice(0, 60)}…) — metin değişti mi?`);
		continue;
	}
	const gruplar = m.slice(1);
	const hedefler = Array.isArray(olcum) ? olcum : [olcum];
	for (const [i, yazilan] of gruplar.entries()) {
		const beklenen = bicimle(toplam(hedefler[i]), yazilan);
		denetlenen++;
		if (yazilan !== beklenen) {
			if (DUZELT) {
				const [bas, bit] = m.indices[i + 1];
				if (!degisiklikler.has(dosya)) degisiklikler.set(dosya, []);
				degisiklikler.get(dosya).push([bas, bit, beklenen]);
				continue;
			}
			const satir = metin.slice(0, m.index).split("\n").length;
			hatalar.push(`${dosya}:${satir}  "${yazilan}" yazıyor, ölçüm ${beklenen}`);
		}
	}
}

// Sondan başa uygulanıyor: öndeki bir değişiklik arkadakilerin konumunu
// kaydırmasın.
for (const [dosya, liste] of degisiklikler) {
	const yol = join(KOK, dosya);
	let metin = readFileSync(yol, "utf8");
	for (const [bas, bit, yeni] of liste.sort((a, b) => b[0] - a[0])) {
		metin = metin.slice(0, bas) + yeni + metin.slice(bit);
		duzeltilen++;
	}
	writeFileSync(yol, metin);
}
if (duzeltilen > 0) console.log(`Boyut kapısı: ${duzeltilen} sayı ölçümle güncellendi.`);

if (hatalar.length > 0) {
	console.error(`Boyut kapısı: ${hatalar.length} eski ya da kayıp iddia\n`);
	for (const h of hatalar) console.error(`  ${h}`);
	console.error("\nSayıyı ölçümle değiştirin; sayfa sayıyı değil ölçümü anlatmalı.");
	process.exit(1);
}
if (!SESSIZ) console.log(`Boyut kapısı: ${denetlenen} sayı ölçümle aynı.`);
