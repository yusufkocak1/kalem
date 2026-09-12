#!/usr/bin/env node
/**
 * Sıfır bağımlılıklı statik sunucu — derlenmiş örnekler için  (F5-03)
 *
 * Vite tabanlı örneklerin `vite preview`i var; Angular'ın ve düz HTML
 * örneklerinin yok. Bir paket eklemek yerine (örnekler "minimal ve
 * kopyalanabilir" olmak zorunda) tek dosyalık sunucu.
 *
 * `serve-demo.mjs`ten ayrı: o paket çıktılarını farklı köklerden servis
 * ediyor ve açılışta derleme yapıyor. Buradaki iş yalnızca bir klasörü
 * yayınlamak.
 *
 * Kullanım: node scripts/serve-static.mjs <klasör> [port]
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const KLASOR = resolve(process.argv[2] ?? ".");
const PORT = Number(process.argv[3] ?? process.env.PORT ?? 4180);

const TIPLER = {
	// Charset açıkça yazılıyor: başlıksız yanıtta tarayıcı Windows-1252'ye
	// düşüyor ve Türkçe karakterler bozuluyor.
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".svg": "image/svg+xml; charset=utf-8",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

createServer((istek, yanit) => {
	const yol = decodeURIComponent((istek.url ?? "/").split("?")[0]);
	// `..` sızıntısı normalize + kök önek kontrolüyle kesiliyor.
	let dosya = normalize(join(KLASOR, yol));
	if (existsSync(dosya) && statSync(dosya).isDirectory()) dosya = join(dosya, "index.html");
	if (!dosya.startsWith(KLASOR) || !existsSync(dosya)) {
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
	console.log(`${KLASOR} → http://localhost:${PORT}/`);
});
