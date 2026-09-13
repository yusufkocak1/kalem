/**
 * Ortam bildirimleri  (İş listesi: F6-06)
 *
 * CSS import'ları Vite'ın işi; TypeScript onları bilmiyor. `?inline`
 * eki CSS'i metin olarak getiriyor (tema seçicisi bunu kullanıyor), o
 * yüzden ayrı bir bildirim gerekiyor.
 */
declare module "*.css" {
	const icerik: string;
	export default icerik;
}

declare module "*.css?inline" {
	const icerik: string;
	export default icerik;
}
