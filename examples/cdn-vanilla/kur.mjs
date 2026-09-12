#!/usr/bin/env node
/**
 * `examples/cdn-vanilla` — "derleme" adımı  (İş listesi: F5-04)
 *
 * Örneğin kendisinde derleme yok: `index.html` tarayıcıda olduğu gibi
 * çalışıyor. Burada yapılan tek şey, sayfanın yüklediği iki dosyayı
 * `dist/` altına kopyalamak.
 *
 * Sebep: paketler henüz npm'de değil, yani gerçek bir CDN adresi
 * yok. Sayfa yayımlandığında `https://cdn.jsdelivr.net/npm/@kalem/…`
 * yazacak (README'ye bakın); burada aynı dosyalar yerelden geliyor ve
 * **derlenmiş paket çıktısından** kopyalanıyor, kaynaktan değil — yani
 * sınanan şey npm'e gidecek olanın aynısı.
 */
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BURASI = dirname(fileURLToPath(import.meta.url));
const KOK = join(BURASI, "..", "..");
const HEDEF = join(BURASI, "dist");

const DOSYALAR = [
	[join(KOK, "packages", "wc", "dist", "kalem-editor.iife.js"), "kalem-editor.iife.js"],
	[join(KOK, "packages", "themes", "css", "tokens.css"), "tokens.css"],
	[join(KOK, "packages", "themes", "css", "viewer.css"), "viewer.css"],
	[join(KOK, "packages", "themes", "css", "editor.css"), "editor.css"],
	[join(BURASI, "index.html"), "index.html"],
];

rmSync(HEDEF, { recursive: true, force: true });
mkdirSync(HEDEF, { recursive: true });

for (const [kaynak, ad] of DOSYALAR) {
	copyFileSync(kaynak, join(HEDEF, ad));
}

console.log(`cdn-vanilla → ${DOSYALAR.length} dosya kopyalandı (dist/)`);
