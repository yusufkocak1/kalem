/**
 * Örnek uygulama — Next.js App Router  (İş listesi: F5-01)
 *
 * Yapılandırmada Kalem'e özel hiçbir şey yok: `transpilePackages` yok,
 * `dynamic(… { ssr: false })` sarmalayıcısı yok, `'use client'` hatırlatması
 * yok. Paket kendi `"use client"` yönergesini taşıyor ve ESM/CJS'i ayrı
 * ayrı yayımlıyor; App Router onu sıradan bir npm bağımlılığı gibi alıyor.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {};

export default nextConfig;
