#!/usr/bin/env node
/**
 * KORUYUCU KAPI 3/3 — Locale kapısı  (İş listesi: F0-04)
 *
 * Türkçe'de `i`'nin büyüğü `I` değil `İ`, `I`'nın küçüğü `i` değil `ı`.
 * Bu yüzden çıplak `toLowerCase()` / `toUpperCase()` / `localeCompare(x)`
 * çağrıları Türkçe'de PATLAMAZ — sessizce yanlış sonuç verir. İngilizce
 * yazılmış testler bunu asla yakalamaz. Tek güvenilir savunma derleme
 * zamanında yasaklamaktır.
 *
 * Kullanım:  node scripts/guard-locale.mjs [dizin|dosya ...]
 * Kaçış:     satırın kendisine ya da bir üst satıra  // kalem-locale-ok: <sebep>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const VARSAYILAN = ["packages", "scripts", "apps/docs/src", "examples"];
const UZANTI = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
// Üretilmiş çıktılar taranmaz: kaynak zaten denetleniyor, üretilmiş kopya
// yalnızca gürültü ve bayat sonuç üretir (`.tsbuild` tsc'nin ara çıktısı).
const ATLA = new Set([
	"node_modules",
	"dist",
	// Örnek uygulamaların derleme çıktısı: içindeki üçüncü parti kod
	// bizim kuralımıza uymak zorunda değil ve uymuyor da.
	".next",
	".nuxt",
	".output",
	".tsbuild",
	"coverage",
	".astro",
	".git",
	"test-results",
	"playwright-report",
]);
const IZIN = /kalem-locale-ok:/;

const KURALLAR = [
	{
		ad: "toLowerCase",
		re: /\.toLowerCase\s*\(/g,
		duzelt: "toLocaleLowerCase(locale)",
	},
	{
		ad: "toUpperCase",
		re: /\.toUpperCase\s*\(/g,
		duzelt: "toLocaleUpperCase(locale)",
	},
	{
		ad: "toLocaleLowerCase (locale'siz)",
		re: /\.toLocaleLowerCase\s*\(\s*\)/g,
		duzelt: "toLocaleLowerCase(locale) — argüman zorunlu",
	},
	{
		ad: "toLocaleUpperCase (locale'siz)",
		re: /\.toLocaleUpperCase\s*\(\s*\)/g,
		duzelt: "toLocaleUpperCase(locale) — argüman zorunlu",
	},
	{
		ad: "localeCompare (tek argüman)",
		re: /\.localeCompare\s*\(/g,
		argSayisi: 2,
		duzelt: "localeCompare(other, locale)",
	},
	{
		ad: "Intl.Collator (locale'siz)",
		re: /new\s+Intl\.Collator\s*\(\s*\)/g,
		duzelt: "new Intl.Collator(locale)",
	},
	{
		ad: "Intl.Collator (undefined locale)",
		re: /new\s+Intl\.Collator\s*\(\s*undefined\b/g,
		duzelt: "new Intl.Collator(locale)",
	},
];

/**
 * Bir `/` bu konumda regex literal mi başlatıyor, yoksa bölme mi.
 *
 * Sözcüksel çözümleyici olmadan kesin ayrım yapılamaz; standart sezgisel
 * kural şudur: regex ancak bir **değer beklenen** yerde başlayabilir, yani
 * kendinden önceki anlamlı karakter bir operatör, ayraç açılışı ya da
 * anahtar sözcük ise.
 */
function regexBaslangiciMi(s, i) {
	let k = i - 1;
	while (k >= 0 && /\s/.test(s[k])) k--;
	if (k < 0) return true;
	const onceki = s[k];
	if ("(,=:[!&|?{};+-*%^~<>".includes(onceki)) return true;
	// `return /.../`, `typeof /.../` gibi anahtar sözcüklerden sonra.
	const kelime = /[A-Za-z_$][\w$]*$/.exec(s.slice(0, k + 1));
	return (
		kelime !== null && ["return", "typeof", "case", "in", "of", "new", "delete"].includes(kelime[0])
	);
}

/**
 * Yorum, string ve **regex literal** içeriğini boşlukla maskeler; ofsetler korunur.
 *
 * Regex'leri atlamak şart: içinde tırnak geçen bir desen (`/"([^"]*)"/` gibi)
 * maskeleyiciyi kaydırır ve dosyanın geri kalanını görünmez yapar — kapı
 * sessizce hiçbir şey bulamaz hale gelir. Bu tam olarak bir kez yaşandı.
 */
function maskele(s) {
	const c = [...s];
	let i = 0;
	const bosalt = (bas, son) => {
		for (let k = bas; k < son && k < c.length; k++) if (c[k] !== "\n") c[k] = " ";
	};
	while (i < c.length) {
		const iki = s.slice(i, i + 2);
		if (iki === "//") {
			const son = s.indexOf("\n", i);
			bosalt(i, son === -1 ? c.length : son);
			i = son === -1 ? c.length : son;
		} else if (iki === "/*") {
			const son = s.indexOf("*/", i + 2);
			bosalt(i, son === -1 ? c.length : son + 2);
			i = son === -1 ? c.length : son + 2;
		} else if (c[i] === '"' || c[i] === "'") {
			const tirnak = c[i];
			let k = i + 1;
			while (k < c.length && c[k] !== tirnak) k += c[k] === "\\" ? 2 : 1;
			bosalt(i + 1, k);
			i = k + 1;
		} else if (c[i] === "`") {
			// Template literal: yalnızca DÜZ kısımlar maskelenir. `${...}`
			// içindeki gerçek koddur ve taranmalıdır — burayı maskelemek
			// `${x.toLowerCase()}` gibi ihlalleri görünmez yapardı.
			let k = i + 1;
			let duzBaslangic = k;
			while (k < c.length) {
				if (c[k] === "\\") {
					k += 2;
					continue;
				}
				if (c[k] === "`") break;
				if (c[k] === "$" && c[k + 1] === "{") {
					bosalt(duzBaslangic, k);
					let derinlik = 0;
					k++; // '$'
					while (k < c.length) {
						if (c[k] === "{") derinlik++;
						else if (c[k] === "}") {
							derinlik--;
							if (derinlik === 0) {
								k++;
								break;
							}
						}
						k++;
					}
					duzBaslangic = k;
					continue;
				}
				k++;
			}
			bosalt(duzBaslangic, k);
			i = k + 1;
		} else if (c[i] === "/" && regexBaslangiciMi(s, i)) {
			let k = i + 1;
			let sinifIcinde = false;
			while (k < c.length && c[k] !== "\n") {
				if (c[k] === "\\") {
					k += 2;
					continue;
				}
				if (c[k] === "[") sinifIcinde = true;
				else if (c[k] === "]") sinifIcinde = false;
				else if (c[k] === "/" && !sinifIcinde) break;
				k++;
			}
			// Satır sonuna kadar kapanmadıysa regex değildi; bölme say.
			if (k >= c.length || c[k] === "\n") {
				i++;
				continue;
			}
			bosalt(i + 1, k);
			i = k + 1;
		} else {
			i++;
		}
	}
	return c.join("");
}

/** `(` konumundan başlayarak üst düzey argüman sayısını sayar. */
function argSay(s, acilisIdx) {
	let derinlik = 0;
	let sayi = 0;
	let dolu = false;
	for (let i = acilisIdx; i < s.length; i++) {
		const ch = s[i];
		if (ch === "(" || ch === "[" || ch === "{") derinlik++;
		else if (ch === ")" || ch === "]" || ch === "}") {
			derinlik--;
			if (derinlik === 0) return dolu ? sayi + 1 : 0;
		} else if (ch === "," && derinlik === 1) sayi++;
		else if (derinlik === 1 && !/\s/.test(ch)) dolu = true;
	}
	return -1;
}

/**
 * Kaçış yorumu bu çağrıyı kapsıyor mu.
 *
 * Yalnızca "aynı satır ya da bir üst satır" bakmak **kırılgan**: Biome uzun
 * zincirleri satırlara böldüğünde `// kalem-locale-ok` yorumu çağrıdan
 * uzaklaşıyor ve kaçış sessizce etkisizleşiyor. Bu tam olarak iki kez
 * yaşandı.
 *
 * Bunun yerine **ifadenin başına kadar** yukarı yürünüyor: bir önceki
 * satırın sonu ifadeyi bitirmişse (`;`, `{`, `}` ya da boş satır) durulur.
 */
function izinliMi(satirlar, satirNo) {
	for (let i = satirNo - 1; i >= 0 && satirNo - i <= IZIN_ARAMA_DERINLIGI; i--) {
		const satir = satirlar[i] ?? "";
		if (IZIN.test(satir)) return true;
		const kirpik = satir.trim();
		// İfade sınırı: buradan yukarısı başka bir ifadeye ait.
		if (i < satirNo - 1 && (kirpik === "" || /[;{}]$/.test(kirpik))) return false;
	}
	return false;
}

/** Kaçış yorumu bu kadar satır yukarıya kadar aranır. */
const IZIN_ARAMA_DERINLIGI = 8;

function* dosyalar(yol) {
	let st;
	try {
		st = statSync(yol);
	} catch {
		return;
	}
	if (st.isFile()) {
		if (UZANTI.test(yol) && !yol.includes(`${sep}dist${sep}`)) yield yol;
		return;
	}
	for (const ad of readdirSync(yol)) {
		if (ATLA.has(ad)) continue;
		yield* dosyalar(join(yol, ad));
	}
}

const hedefler = process.argv.slice(2).length ? process.argv.slice(2) : VARSAYILAN;
const bulgular = [];

for (const hedef of hedefler) {
	for (const dosya of dosyalar(hedef)) {
		const ham = readFileSync(dosya, "utf8");
		const kod = maskele(ham);
		const satirlar = ham.split("\n");
		for (const kural of KURALLAR) {
			kural.re.lastIndex = 0;
			let m = kural.re.exec(kod);
			while (m !== null) {
				const idx = m.index;
				if (kural.argSayisi) {
					const acilis = kod.indexOf("(", idx);
					const n = argSay(kod, acilis);
					if (n >= kural.argSayisi) {
						m = kural.re.exec(kod);
						continue;
					}
				}
				const satirNo = kod.slice(0, idx).split("\n").length;
				if (izinliMi(satirlar, satirNo)) {
					m = kural.re.exec(kod);
					continue;
				}
				const buSatir = satirlar[satirNo - 1] ?? "";
				const sutun = idx - kod.lastIndexOf("\n", idx - 1);
				bulgular.push({
					dosya: relative(process.cwd(), dosya).split(sep).join("/"),
					satirNo,
					sutun,
					kural: kural.ad,
					duzelt: kural.duzelt,
					metin: buSatir.trim(),
				});
				m = kural.re.exec(kod);
			}
		}
	}
}

if (bulgular.length === 0) {
	console.log("✓ locale kapısı: temiz");
	process.exit(0);
}

console.error(`\n✗ LOCALE KAPISI — ${bulgular.length} ihlal\n`);
for (const b of bulgular) {
	console.error(`  ${b.dosya}:${b.satirNo}:${b.sutun}`);
	console.error(`    ${b.metin}`);
	console.error(`    ${b.kural} → ${b.duzelt}\n`);
}
console.error("Türkçe'de bu çağrılar patlamaz, sessizce yanlış sonuç verir.");
console.error("  'Işık'.toLowerCase()             → 'işık'   ✗  (beklenen: 'ışık')");
console.error("  'iyi'.toUpperCase()              → 'IYI'    ✗  (beklenen: 'İYİ')");
console.error("  'Işık'.toLocaleLowerCase('tr')   → 'ışık'   ✓");
console.error("\nGerçekten locale'den bağımsız bir karşılaştırma gerekiyorsa");
console.error("(protokol adı, HTML etiketi, dosya uzantısı gibi) satıra şunu ekle:");
console.error("  // kalem-locale-ok: <kısa sebep>\n");
process.exit(1);
