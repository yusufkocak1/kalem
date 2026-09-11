import { Duzenleyici } from "./duzenleyici";

const BASLANGIC = `# Işık ve Gölge

Bu sayfa bir **sunucu bileşeni**; editör istemcide çalışan tek parça.

* yıldız işareti korunuyor
* çünkü yazım tercihi modelde duruyor
`;

/**
 * Sayfa sunucuda çalışıyor.
 *
 * `<Duzenleyici>` bir istemci bileşeni ve başlangıç metnini prop olarak
 * alıyor: veritabanından gelen bir belge de aynı yoldan iner.
 */
export default function Page() {
	return (
		<main>
			<h1>Kalem — Next.js örneği</h1>
			<p className="not">
				Bu metin sunucuda üretildi. Aşağıdaki editör istemcide kuruluyor; arada{" "}
				<code>dynamic(… ssr: false)</code> sarmalayıcısı yok.
			</p>
			<Duzenleyici baslangic={BASLANGIC} />
		</main>
	);
}
