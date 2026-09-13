#!/usr/bin/env node
/**
 * Performans ölçüm koşucusu  (İş listesi: F6-08)
 *
 * `pnpm olcum` — belge boyutunu katlayarak tuş başına maliyetin nasıl
 * büyüdüğünü ölçer ve Markdown tablosu basar.
 *
 * ## Neden `pnpm verify`in parçası değil
 *
 * Mutlak süreler makineye bağlı: aynı kod dizüstünde 4 ms, paylaşılan bir
 * CI çekirdeğinde 25 ms ölçülüyor. Bunu kapıya koymak ya sürekli yanlış
 * alarm verir ya da eşiği o kadar gevşetmek gerekir ki hiçbir gerilemeyi
 * yakalamaz. Kapıdaki iş `e2e/performans.spec.ts`te ve orada ölçülen şey
 * mutlak süre değil **büyüme oranı**; buradaki koşucu ise karar vermek
 * için, rapor üretiyor.
 *
 * Kullanım:
 *   node scripts/olcum.mjs                 # varsayılan boyutlar
 *   node scripts/olcum.mjs 100 1000 5000   # kendi boyutların
 */
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const BOYUTLAR = process.argv.slice(2).map(Number).filter(Number.isFinite);
const OLCULECEK = BOYUTLAR.length > 0 ? BOYUTLAR : [100, 500, 1000, 2500, 5000, 10_000];
const PORT = 5199;
const TUS = 60;

/**
 * Sunucuyu ayağa kaldırır; `serve-demo.mjs` açılışta paketleri derliyor.
 *
 * Hazır olması **portu yoklayarak** anlaşılıyor, çocuğun çıktısını
 * dinleyerek değil. İlk sürüm `stdout`u boruya alıp "http://localhost"
 * satırını bekliyordu ve kilitlendi: `pnpm build` aynı boruya sayfalarca
 * yazıyor, boru doluyor ve kimse okumadığı için derleme orada duruyordu.
 * Çıktı artık doğrudan terminale gidiyor.
 */
async function sunucu() {
	const cocuk = spawn("node", ["scripts/serve-demo.mjs", String(PORT)], {
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	const bitis = Date.now() + 10 * 60_000;
	for (;;) {
		if (cocuk.exitCode !== null) throw new Error(`sunucu çıktı: ${cocuk.exitCode}`);
		if (Date.now() > bitis) throw new Error("sunucu on dakikada açılmadı");
		try {
			const yanit = await fetch(`http://localhost:${PORT}/olcum.html`);
			if (yanit.ok) return cocuk;
		} catch {
			// Henüz dinlemiyor; derleme sürüyor olabilir.
		}
		await new Promise((c) => setTimeout(c, 1000));
	}
}

const ms = (n) => `${n.toFixed(1)} ms`;

async function main() {
	const sunucuSureci = await sunucu();
	const tarayici = await chromium.launch();
	const sayfa = await tarayici.newPage({ locale: "tr-TR" });
	const satirlar = [];

	try {
		for (const blok of OLCULECEK) {
			await sayfa.goto(`http://localhost:${PORT}/olcum.html`);
			await sayfa.waitForFunction(() => document.getElementById("hazir")?.textContent === "hazır");

			const kurulum = await sayfa.evaluate((n) => window.olcum.kur(n), blok);

			const ilk = sayfa.locator("#editor > [data-kalem-id]").first();
			await ilk.click();
			await sayfa.keyboard.press("End");
			await sayfa.keyboard.type("ışık".repeat(TUS / 4), { delay: 0 });

			const o = await sayfa.evaluate(() => window.olcum.sonuc());
			satirlar.push({ blok, ...kurulum, ...o });

			console.log(
				`${String(blok).padStart(6)} blok · kuruluş ${ms(kurulum.kurulus).padStart(9)} · ` +
					`${String(kurulum.dugum).padStart(6)} eleman · tuş p50 ${ms(o.p50).padStart(8)} · ` +
					`p95 ${ms(o.p95).padStart(8)} · en kötü ${ms(o.enKotu).padStart(8)} · ` +
					`uzun görev ${o.uzunGorevler}`,
			);
		}

		console.log("\n| Blok | Karakter | Eleman | Kuruluş | Tuş p50 | Tuş p95 | Uzun görev |");
		console.log("| --- | --- | --- | --- | --- | --- | --- |");
		for (const s of satirlar) {
			console.log(
				`| ${s.blok} | ${s.karakter.toLocaleString("tr-TR")} | ${s.dugum.toLocaleString("tr-TR")} | ` +
					`${ms(s.kurulus)} | ${ms(s.p50)} | ${ms(s.p95)} | ${s.uzunGorevler} |`,
			);
		}

		/*
		 * Büyüme oranı kararı veren sayı.
		 *
		 * Blok sayısı 10 katına çıkarken tuş başına maliyet de 10 katına
		 * çıkıyorsa maliyet O(belge) ve sanal kaydırma kaçınılmaz. Sabit
		 * kalıyorsa gereksiz bir karmaşıklık olur.
		 */
		const ilkS = satirlar[0];
		const sonS = satirlar[satirlar.length - 1];
		if (ilkS !== undefined && sonS !== undefined && ilkS !== sonS) {
			const blokKat = sonS.blok / ilkS.blok;
			const sureKat = sonS.p50 / Math.max(ilkS.p50, 0.01);
			console.log(
				`\nBlok ${blokKat.toFixed(1)}× büyüdü, tuş başına maliyet ${sureKat.toFixed(1)}× büyüdü.`,
			);
		}
	} finally {
		await tarayici.close();
		sunucuSureci.kill();
	}
}

await main();
