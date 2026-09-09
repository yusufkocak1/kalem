#!/usr/bin/env node
/**
 * apps/demo için sıfır bağımlılıklı statik sunucu.
 *
 * Neden `python -m http.server` değil: o sunucu Content-Type başlığına
 * charset eklemiyor, tarayıcı Windows-1252'ye düşüyor ve Türkçe karakterler
 * bozuluyor ("Editör" → "EditÃ¶r"). Aynı tuzağa iki kez düşmemek için
 * charset burada açıkça yazılıyor.
 *
 * Kullanım: node scripts/serve-demo.mjs [port]
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const KOK = fileURLToPath(new URL("../apps/demo/", import.meta.url));

/**
 * Paket çıktılarını da servis eder.
 *
 * Demo sayfası `@kalem/core`'u **gerçek derlenmiş bundle'dan** yükler —
 * kaynak kodu tekrar etmek yerine. Böylece sayfada görülen davranış, npm'e
 * gidecek olanla birebir aynı.
 */
const PAKETLER = [
	{ onEk: "/@kalem/core/", kok: fileURLToPath(new URL("../packages/core/dist/", import.meta.url)) },
	{
		onEk: "/@kalem/viewer/",
		kok: fileURLToPath(new URL("../packages/viewer/dist/", import.meta.url)),
	},
	{
		onEk: "/@kalem/editor/",
		kok: fileURLToPath(new URL("../packages/editor/dist/", import.meta.url)),
	},
	{
		onEk: "/@kalem/ui/",
		kok: fileURLToPath(new URL("../packages/ui/dist/", import.meta.url)),
	},
	// Temalar saf CSS; derleme adımı yok, kaynak doğrudan servis ediliyor.
	{
		onEk: "/@kalem/themes/",
		kok: fileURLToPath(new URL("../packages/themes/css/", import.meta.url)),
	},
];

const TIPLER = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".svg": "image/svg+xml; charset=utf-8",
	".png": "image/png",
	".webp": "image/webp",
	".woff2": "font/woff2",
};

createServer((istek, yanit) => {
	const yol = decodeURIComponent((istek.url ?? "/").split("?")[0]);

	// Paket çıktıları ayrı kökten servis edilir.
	const paket = PAKETLER.find((p) => yol.startsWith(p.onEk));
	if (paket !== undefined) {
		const hedef = normalize(join(paket.kok, yol.slice(paket.onEk.length)));
		if (hedef.startsWith(paket.kok) && existsSync(hedef)) {
			yanit.writeHead(200, {
				"Content-Type": TIPLER[extname(hedef)] ?? "application/octet-stream",
				"Cache-Control": "no-store",
			});
			createReadStream(hedef).pipe(yanit);
			return;
		}
		yanit.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		yanit.end("Paket dosyası bulunamadı — önce `pnpm build` çalıştır");
		return;
	}

	// `..` sızıntısı normalize + KOK önek kontrolü ile kesiliyor (aşağıda).
	let dosya = normalize(join(KOK, yol));
	if (existsSync(dosya) && statSync(dosya).isDirectory()) dosya = join(dosya, "index.html");
	if (!dosya.startsWith(KOK) || !existsSync(dosya)) {
		yanit.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		yanit.end("Bulunamadı");
		return;
	}
	yanit.writeHead(200, {
		"Content-Type": TIPLER[extname(dosya)] ?? "application/octet-stream",
		"Cache-Control": "no-store",
	});
	createReadStream(dosya).pipe(yanit);
}).listen(PORT, () => {
	console.log(`Kalem demo → http://localhost:${PORT}/`);
});
