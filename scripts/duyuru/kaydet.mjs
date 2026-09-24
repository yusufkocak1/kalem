#!/usr/bin/env node
/**
 * Duyuru varlıklarını üretir  (İş listesi: F6-11)
 *
 * Üç çıktı, hepsi `docs/duyuru/` altına:
 *
 * - `demo.gif`  — README'nin başındaki tanıtım (JavaScript'in çalışmadığı
 *   yerler için: GitHub, npm, dev.to).
 * - `demo.mp4`  — aynı sahne, tam çözünürlükte; X ve Bluesky GIF değil
 *   video istiyor.
 * - `onizleme.png` — 1280×640 sosyal önizleme (GitHub'ın "Social preview"
 *   ayarı ve bağlantı kartları).
 *
 * ## Neden kare kare
 *
 * Playwright'ın `recordVideo`su işletim sisteminin imlecini çizmiyor ve
 * yalnızca VP8 yazıyor. Burada CDP'nin `Page.startScreencast`i kullanılıyor:
 * her kare zaman damgasıyla geliyor, sahnedeki sahte imleç (`sahne.html`)
 * karelerin içinde, ve kareler ffmpeg'e süreleriyle birlikte veriliyor —
 * yani yavaş bir makinede de kayıt gerçek zamanlı akıyor.
 *
 * ## Gereken
 *
 * `pnpm build` ve tam bir ffmpeg (PATH'te ya da `FFMPEG` ortam
 * değişkeninde). Playwright'ın kendi ffmpeg'i yetmiyor: H.264 ve GIF
 * kodlayıcısı yok.
 *
 * Kullanım: node scripts/duyuru/kaydet.mjs [--yalniz-onizleme]
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const KOK = fileURLToPath(new URL("../../", import.meta.url));
const CIKTI = join(KOK, "docs", "duyuru");
const KARELER = join(CIKTI, ".kareler");
const PORT = 4191;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const GENISLIK = 1280;
const YUKSEKLIK = 720;

// ---------------------------------------------------------------------------
// Sunucu
// ---------------------------------------------------------------------------

const sunucu = spawn(
	process.execPath,
	[join(KOK, "scripts", "serve-static.mjs"), KOK, String(PORT)],
	{
		stdio: ["ignore", "pipe", "inherit"],
	},
);
await new Promise((coz) => sunucu.stdout.once("data", coz));
const ADRES = `http://localhost:${PORT}/scripts/duyuru/`;

const tarayici = await chromium.launch();

try {
	mkdirSync(CIKTI, { recursive: true });
	await onizleme();
	if (!process.argv.includes("--yalniz-onizleme")) {
		const kareler = await kaydet();
		kodla(kareler);
	}
} finally {
	await tarayici.close();
	sunucu.kill();
}

// ---------------------------------------------------------------------------
// Sosyal önizleme
// ---------------------------------------------------------------------------

async function onizleme() {
	const sayfa = await tarayici.newPage({ viewport: { width: 1280, height: 640 } });
	await sayfa.goto(`${ADRES}onizleme.html`);
	await sayfa.waitForFunction(() => document.fonts.status === "loaded");
	const yol = join(CIKTI, "onizleme.png");
	await sayfa.screenshot({ path: yol });
	await sayfa.close();
	console.log(`onizleme.png  ${kb(yol)}`);
}

// ---------------------------------------------------------------------------
// Sahne
// ---------------------------------------------------------------------------

/** Sahneyi oynatır, kareleri `{ veri, zaman }` olarak döndürür. */
async function kaydet() {
	const sayfa = await tarayici.newPage({ viewport: { width: GENISLIK, height: YUKSEKLIK } });
	await sayfa.goto(`${ADRES}sahne.html`);
	await sayfa.waitForFunction(() => window.kalemHazir === true);

	const kareler = [];
	const cdp = await sayfa.context().newCDPSession(sayfa);
	cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
		kareler.push({ veri: data, zaman: metadata.timestamp });
		cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
	});

	// İmleç ekranın dışından değil, editörün yanından giriyor.
	await sayfa.mouse.move(640, 420);
	await cdp.send("Page.startScreencast", {
		format: "png",
		maxWidth: GENISLIK,
		maxHeight: YUKSEKLIK,
	});

	const bekle = (ms) => sayfa.waitForTimeout(ms);
	const yaz = (metin) => sayfa.keyboard.type(metin, { delay: 55 });
	const git = (x, y, adim = 18) => sayfa.mouse.move(x, y, { steps: adim });

	await bekle(900);

	// 1 · Boş belge: imleç editöre tıklıyor, `# ` başlığa dönüşüyor.
	// Boş paragraf tek satır yüksekliğinde; kutusunun dışına tıklamak
	// odak vermiyor.
	const bos = await sayfa.locator("#editor p").first().boundingBox();
	await git(bos.x + 40, bos.y + bos.height / 2);
	await sayfa.mouse.click(bos.x + 40, bos.y + bos.height / 2);
	await bekle(300);
	await yaz("# Meeting notes");
	await sayfa.keyboard.press("Enter");
	await yaz("Kalem looks like Word, but what it saves is plain Markdown.");
	await bekle(500);

	// 2 · Seçim → balon araç çubuğu → Bold.
	const secim = await sayfa.evaluate(() => {
		const hedef = "plain Markdown";
		const p = [...document.querySelectorAll("#editor p")].find((el) =>
			el.textContent?.includes(hedef),
		);
		const metin = p?.firstChild;
		if (!metin) throw new Error("paragraf yok");
		const bas = metin.textContent.indexOf(hedef);
		const aralik = document.createRange();
		aralik.setStart(metin, bas);
		aralik.setEnd(metin, bas + hedef.length);
		const r = aralik.getClientRects();
		const ilk = r[0];
		const son = r[r.length - 1];
		return {
			x1: ilk.left + 1,
			y1: ilk.top + ilk.height / 2,
			x2: son.right - 1,
			y2: son.top + son.height / 2,
		};
	});
	await git(secim.x1, secim.y1);
	await sayfa.mouse.down();
	await git(secim.x2, secim.y2, 24);
	await sayfa.mouse.up();
	await bekle(450);
	const kalin = await sayfa.locator('.kalem-bubble button[aria-label="Bold"]').boundingBox();
	await git(kalin.x + kalin.width / 2, kalin.y + kalin.height / 2, 14);
	await bekle(250);
	await sayfa.mouse.click(kalin.x + kalin.width / 2, kalin.y + kalin.height / 2);
	await bekle(900);

	// 3 · Slash menüsü → madde imli liste.
	await sayfa.keyboard.press("End");
	await sayfa.keyboard.press("Enter");
	await bekle(200);
	await yaz("/");
	await bekle(700);
	await yaz("bull");
	await bekle(600);
	await sayfa.keyboard.press("Enter");
	await yaz("Zero runtime dependencies");
	await sayfa.keyboard.press("Enter");
	await yaz("React, Vue, or no framework");
	await sayfa.keyboard.press("Enter");
	await yaz("Clean diffs in Git");
	await sayfa.keyboard.press("Enter");
	await sayfa.keyboard.press("Enter");

	// 4 · Giriş kuralı: `> ` alıntıya dönüşüyor.
	await yaz("> Your file stays yours.");
	await bekle(700);

	// 5 · Blok tutamağıyla alıntıyı başlığın altına taşı.
	const alinti = await sayfa.locator("#editor blockquote").boundingBox();
	await git(alinti.x + 60, alinti.y + alinti.height / 2, 20);
	await bekle(500);
	const tutamac = await sayfa.locator(".kalem-handle-grip").boundingBox();
	await git(tutamac.x + tutamac.width / 2, tutamac.y + tutamac.height / 2, 10);
	await bekle(300);
	const paragraf = await sayfa.locator("#editor p").first().boundingBox();
	await sayfa.mouse.down();
	await git(tutamac.x + tutamac.width / 2, paragraf.y + 3, 30);
	await bekle(350);
	await sayfa.mouse.up();
	await bekle(400);
	await git(700, 560, 20);
	await bekle(2200);

	await cdp.send("Page.stopScreencast");
	await sayfa.close();
	if (kareler.length < 30) throw new Error(`Yalnızca ${kareler.length} kare yakalandı`);
	return kareler;
}

// ---------------------------------------------------------------------------
// Kodlama
// ---------------------------------------------------------------------------

/**
 * Kareleri ffmpeg'in concat listesine yazar ve üç biçime kodlar.
 *
 * Screencast yalnızca ekran **değiştiğinde** kare gönderiyor; her karenin
 * süresi bir sonrakinin zaman damgasına kadar. Bu yüzden sabit kare hızı
 * varsaymak kaydı hızlandırırdı.
 */
function kodla(kareler) {
	rmSync(KARELER, { recursive: true, force: true });
	mkdirSync(KARELER, { recursive: true });

	const satirlar = [];
	for (const [i, kare] of kareler.entries()) {
		const ad = `${String(i).padStart(5, "0")}.png`;
		writeFileSync(join(KARELER, ad), Buffer.from(kare.veri, "base64"));
		const sonraki = kareler[i + 1]?.zaman ?? kare.zaman + 0.1;
		satirlar.push(`file '${ad}'`, `duration ${(sonraki - kare.zaman).toFixed(4)}`);
	}
	// concat demuxer'ı son kareyi süresiz bırakıyor; tekrar yazmak süresini koruyor.
	satirlar.push(`file '${String(kareler.length - 1).padStart(5, "0")}.png'`);
	const liste = join(KARELER, "liste.txt");
	writeFileSync(liste, `${satirlar.join("\n")}\n`);

	const toplam = kareler.at(-1).zaman - kareler[0].zaman;
	console.log(`${kareler.length} kare, ${toplam.toFixed(1)} sn`);

	const girdi = [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		liste,
	];

	ffmpeg([
		...girdi,
		"-vf",
		"fps=30,format=yuv420p",
		"-c:v",
		"libx264",
		"-crf",
		"20",
		"-preset",
		"slow",
		"-movflags",
		"+faststart",
		join(CIKTI, "demo.mp4"),
	]);

	// Palet sahnenin kendisinden; `diff` hareket eden bölgeye öncelik veriyor.
	ffmpeg([
		...girdi,
		"-vf",
		"fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
		"-loop",
		"0",
		join(CIKTI, "demo.gif"),
	]);

	rmSync(KARELER, { recursive: true, force: true });
	console.log(`demo.mp4  ${kb(join(CIKTI, "demo.mp4"))}`);
	console.log(`demo.gif  ${kb(join(CIKTI, "demo.gif"))}`);
}

function ffmpeg(argumanlar) {
	const sonuc = spawnSync(FFMPEG, argumanlar, { stdio: "inherit" });
	if (sonuc.error) {
		throw new Error(`ffmpeg çalışmadı (${FFMPEG}). PATH'e ekleyin ya da FFMPEG=… verin.`);
	}
	if (sonuc.status !== 0) throw new Error(`ffmpeg ${sonuc.status} ile çıktı`);
}

function kb(yol) {
	return `${(statSync(yol).size / 1024).toFixed(0)} kB`;
}
