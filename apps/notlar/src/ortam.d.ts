/**
 * Kalem Notlar — Ortam bildirimleri  (İş listesi: F5-05)
 *
 * CSS import'ları Vite'ın işi; TypeScript onları bilmiyor ve yan etkili
 * import'lar için tip bildirimi arıyor. Bildirim olmadan `tsc --noEmit`
 * on bir satırı hata sayıyor.
 */
declare module "*.css";
