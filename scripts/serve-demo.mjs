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
