#!/usr/bin/env node
/**
 * Koruyucu kapıların ÖZ-TESTİ  (İş listesi: F0-07 kabul kriteri)
 *
 * "Kasıtlı olarak React import eden bir dal CI'ı kırıyor" — bunu iddia etmek
 * yetmez, kanıtlanmalı. Bu script sahte bir workspace kurar, içine kasıtlı
 * ihlaller koyar ve kapıların gerçekten kırmızıya döndüğünü doğrular.
 *
 * Bir kapı sessizce bozulursa (regex kayması, yol değişikliği) burada yakalanır.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BURASI = fileURLToPath(new URL(".", import.meta.url));
const PURITY = join(BURASI, "guard-purity.mjs");
const LOCALE = join(BURASI, "guard-locale.mjs");

let gecen = 0;
const basarisiz = [];

function calistir(script, args) {
	const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
	return { kod: r.status, cikti: (r.stdout ?? "") + (r.stderr ?? "") };
}

function bekle(ad, kosul, detay) {
	if (kosul) {
		gecen++;
		console.log(`  ✓ ${ad}`);
	} else {
		basarisiz.push(ad);
		console.log(`  ✗ ${ad}`);
		if (detay) console.log(`      ${detay.split("\n").slice(0, 6).join("\n      ")}`);
	}
}

/** Sahte workspace kurar. secenekler ile kasıtlı ihlaller enjekte edilir. */
function sahteWorkspace(secenekler = {}) {
	const kok = mkdtempSync(join(tmpdir(), "kalem-selftest-"));
	for (const ad of ["core", "viewer", "editor", "ui"]) {
		const dir = join(kok, "packages", ad);
		mkdirSync(join(dir, "dist"), { recursive: true });
		const pkg = {
			name: `@kalem/${ad}`,
			version: "0.0.0",
			license: "MIT",
			type: "module",
			sideEffects: false,
			exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
			dependencies: ad === "core" ? {} : { "@kalem/core": "workspace:^" },
		};
		if (ad === "core" && secenekler.reactBagimliligi) pkg.dependencies = { react: "^19.0.0" };
		if (ad === "core" && secenekler.peerBagimliligi) pkg.peerDependencies = { vue: "^3" };
		writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));

		let kod = `export const PACKAGE = "@kalem/${ad}";\n`;
		if (ad === "core" && secenekler.reactImport) kod = `import { useState } from "react";\n${kod}`;
		if (ad === "core" && secenekler.domErisimi)
			kod += `export const el = document.createElement("div");\n`;
		if (ad === "core" && secenekler.nodeImport)
			kod = `import { readFileSync } from "node:fs";\n${kod}`;
		writeFileSync(join(dir, "dist", "index.js"), kod);
	}
	return kok;
}

const temizlenecek = [];
const kur = (o) => {
	const k = sahteWorkspace(o);
	temizlenecek.push(k);
	return k;
};

console.log("\nSAFLIK KAPISI ÖZ-TESTİ");

{
	const r = calistir(PURITY, ["--root", kur()]);
	bekle("temiz workspace geçiyor", r.kod === 0, r.cikti);
}
{
	const r = calistir(PURITY, ["--root", kur({ reactBagimliligi: true })]);
	bekle(
		"react bağımlılığı beyan eden dal KIRILIYOR",
		r.kod === 1 && /3rd-party bağımlılık/.test(r.cikti),
		r.cikti,
	);
}
{
	const r = calistir(PURITY, ["--root", kur({ reactImport: true })]);
	bekle(
		"bundle'da react import'u olan dal KIRILIYOR",
		r.kod === 1 && /import ediyor/.test(r.cikti),
		r.cikti,
	);
}
{
	const r = calistir(PURITY, ["--root", kur({ domErisimi: true })]);
	bekle(
		"core'da document kullanan dal KIRILIYOR",
		r.kod === 1 && /DOM globali/.test(r.cikti),
		r.cikti,
	);
}
{
	const r = calistir(PURITY, ["--root", kur({ peerBagimliligi: true })]);
	bekle(
		"core'a peerDependency ekleyen dal KIRILIYOR",
		r.kod === 1 && /peerDependency/.test(r.cikti),
		r.cikti,
	);
}
{
	// Testler `node:fs` kullanabilir (tipler açık) ama dist'e girmemeli:
	// core tarayıcıda da çalışmak zorunda.
	const r = calistir(PURITY, ["--root", kur({ nodeImport: true })]);
	bekle(
		"core'da node: yerleşiği import eden dal KIRILIYOR",
		r.kod === 1 && /Node yerleşiği/.test(r.cikti),
		r.cikti,
	);
}

console.log("\nLOCALE KAPISI ÖZ-TESTİ");

const localeDir = mkdtempSync(join(tmpdir(), "kalem-locale-"));
temizlenecek.push(localeDir);

const yaz = (ad, icerik) => {
	const y = join(localeDir, ad);
	writeFileSync(y, icerik);
	return y;
};

{
	const y = yaz(
		"temiz.ts",
		"const a = s.toLocaleLowerCase(lang);\nconst b = x.localeCompare(y, lang);\nconst c = new Intl.Collator(lang);\n",
	);
	const r = calistir(LOCALE, [y]);
	bekle("locale duyarlı kod geçiyor", r.kod === 0, r.cikti);
}
{
	const y = yaz("kirli.ts", 'const a = "Işık".toLowerCase();\n');
	const r = calistir(LOCALE, [y]);
	bekle("çıplak toLowerCase KIRILIYOR", r.kod === 1 && /toLocaleLowerCase/.test(r.cikti), r.cikti);
}
{
	const y = yaz("tek-arg.ts", "const a = x.localeCompare(y);\n");
	const r = calistir(LOCALE, [y]);
	bekle("tek argümanlı localeCompare KIRILIYOR", r.kod === 1, r.cikti);
}
{
	const y = yaz(
		"izinli.ts",
		"const a = ext.toLowerCase(); // kalem-locale-ok: dosya uzantısı ASCII\n",
	);
	const r = calistir(LOCALE, [y]);
	bekle("kalem-locale-ok kaçışı çalışıyor", r.kod === 0, r.cikti);
}
{
	const y = yaz(
		"yorum.ts",
		'const a = 1; // eskiden .toLowerCase() vardı\nconst b = ".toLowerCase() metni";\n',
	);
	const r = calistir(LOCALE, [y]);
	bekle("yorum ve string içi eşleşme sayılmıyor", r.kod === 0, r.cikti);
}
{
	// GERÇEK BİR HATAYDI: içinde tırnak geçen bir regex maskeleyiciyi
	// kaydırıyor ve dosyanın geri kalanını görünmez yapıyordu. Kapı
	// "temiz" diyordu, oysa altında ihlal vardı.
	const y = yaz("regex-tuzagi.ts", 'const RE = /"([^"]*)"/;\nconst a = "Işık".toLowerCase();\n');
	const r = calistir(LOCALE, [y]);
	bekle("tırnaklı regex sonrasındaki ihlal yakalanıyor", r.kod === 1, r.cikti);
}
{
	// Regex İÇİNDEKİ `.toLowerCase(` metni kod değildir, sayılmamalı.
	const y = yaz("regex-icinde.ts", "const RE = /\\.toLowerCase\\(/;\n");
	const r = calistir(LOCALE, [y]);
	bekle("regex içindeki eşleşme sayılmıyor", r.kod === 0, r.cikti);
}
{
	// Bölme işlemi regex sanılıp sonrası maskelenmemeli.
	const y = yaz("bolme.ts", "const oran = toplam / adet;\nconst b = x.toUpperCase();\n");
	const r = calistir(LOCALE, [y]);
	bekle("bölme regex sanılmıyor", r.kod === 1 && /toUpperCase/.test(r.cikti), r.cikti);
}
{
	// GERÇEK BİR HATAYDI: template literal tamamen maskeleniyordu, oysa
	// `${...}` içindeki gerçek koddur ve taranmalıdır.
	const y = yaz("sablon.ts", "const a = `deger: ${x.toLowerCase()}`;\n");
	const r = calistir(LOCALE, [y]);
	bekle("template literal içindeki ${} taranıyor", r.kod === 1, r.cikti);
}
{
	// Template literal'in DÜZ kısmı kod değildir, sayılmamalı.
	const y = yaz("sablon-duz.ts", "const a = `burada .toLowerCase() yazıyor ama metin`;\n");
	const r = calistir(LOCALE, [y]);
	bekle("template literal düz kısmı sayılmıyor", r.kod === 0, r.cikti);
}
{
	// GERÇEK BİR SORUNDU: Biome uzun zincirleri satırlara bölünce
	// `kalem-locale-ok` yorumu çağrıdan uzaklaşıyor ve kaçış sessizce
	// etkisizleşiyordu. Kaçış artık ifadenin tamamını kapsıyor.
	const y = yaz(
		"cok-satirli-kacis.ts",
		"// kalem-locale-ok: gerekçe\nconst a = deger\n\t.trim()\n\t.replace(/x/g, '')\n\t.toLowerCase();\n",
	);
	const r = calistir(LOCALE, [y]);
	bekle("çok satırlı zincirde kaçış geçerli", r.kod === 0, r.cikti);
}
{
	// Kaçış bir ÖNCEKİ ifadeye aitse bu ifadeyi kapsamamalı.
	const y = yaz(
		"kacis-sizmasi.ts",
		"// kalem-locale-ok: baska bir sebep\nconst a = 1;\nconst b = x.toLowerCase();\n",
	);
	const r = calistir(LOCALE, [y]);
	bekle("kaçış bir sonraki ifadeye sızmıyor", r.kod === 1, r.cikti);
}

for (const d of temizlenecek) rmSync(d, { recursive: true, force: true });

console.log(`\n${gecen} geçti, ${basarisiz.length} başarısız`);
if (basarisiz.length > 0) {
	console.error("\n✗ KORUYUCU KAPILAR BOZUK — kapılar ihlalleri yakalamıyor:");
	for (const b of basarisiz) console.error(`    ${b}`);
	console.error("\nBu, kapıların artık hiçbir şeyi korumadığı anlamına gelir. Önce bunu düzelt.");
	process.exit(1);
}
console.log("✓ tüm koruyucu kapılar ihlalleri yakalıyor");
