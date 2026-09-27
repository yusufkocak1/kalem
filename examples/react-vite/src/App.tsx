import { KalemEditor, useKalem, useKalemValue } from "@kalem-editor/react";
import { useState } from "react";

import "@kalem-editor/themes/tokens.css";
import "@kalem-editor/themes/viewer.css";
import "@kalem-editor/themes/editor.css";
import "./stil.css";

const BASLANGIC = `# Işık ve Gölge

Bu editör bir React bileşeni. Yazdıkça metin aşağıda güncelleniyor.

* yıldız işareti korunuyor
* çünkü yazım tercihi modelde duruyor
`;

/**
 * Kontrollü kullanım.
 *
 * Metin React durumunda; editör onu yansıtıyor. `value` dışarıdan
 * değiştiğinde (aşağıdaki "Örneği geri yükle" düğmesi) editöre iniyor.
 */
export function App() {
	const [metin, setMetin] = useState(BASLANGIC);
	const [saltOkunur, setSaltOkunur] = useState(false);

	return (
		<main className="kalem-theme">
			<header>
				<h1>Kalem — React örneği</h1>
				<nav>
					<label>
						<input
							type="checkbox"
							checked={saltOkunur}
							onChange={(e) => setSaltOkunur(e.target.checked)}
						/>{" "}
						salt okunur
					</label>
					<button type="button" onClick={() => setMetin(BASLANGIC)}>
						Örneği geri yükle
					</button>
				</nav>
			</header>

			<KalemEditor
				className="editor"
				value={metin}
				onChange={setMetin}
				readOnly={saltOkunur}
				lang="tr"
				label="Belge"
			>
				<Durum />
			</KalemEditor>

			<section>
				<h2>Markdown çıktısı</h2>
				<pre>{metin}</pre>
			</section>
		</main>
	);
}

/**
 * `<KalemEditor>`in çocuğu: editöre `useKalem()` ile erişiyor, metni
 * `useKalemValue()` ile izliyor.
 *
 * İkisi de sarmalayıcının API'sinin tamamı; bu bileşen editörün iç
 * yapısından hiçbir şey bilmiyor.
 */
function Durum() {
	const editor = useKalem();
	const metin = useKalemValue();

	return (
		<p className="durum">
			<span>{metin.length} karakter</span>
			<button type="button" disabled={editor === null} onClick={() => editor?.focus()}>
				Odağı editöre ver
			</button>
		</p>
	);
}
