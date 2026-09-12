/**
 * Canlı örnek — React  (İş listesi: F6-03)
 *
 * `@kalem/react` sarmalayıcısı, Astro'nun React adasında. Sayfadaki Vue
 * örneğiyle **aynı anda** yaşıyor: aynı sayfa, iki çerçeve, tek editör
 * motoru.
 *
 * `useKalemValue` bilerek kullanılıyor — metni okuyan ama sahiplenmeyen
 * bir kardeş bileşenin nasıl yazıldığını göstermek, kontrollü kipi
 * tekrarlamaktan daha öğretici.
 */
import type { Editor } from "@kalem/editor";
import { KalemEditor, useKalemValue } from "@kalem/react";
import { mountUi, type Ui } from "@kalem/ui";
import { useCallback, useEffect, useRef } from "react";
import { ORNEK_BELGE } from "./ornek-belge.js";

function Cikti() {
	const metin = useKalemValue(ORNEK_BELGE);
	return <pre className="canli-cikti">{metin}</pre>;
}

export function CanliReact() {
	const uiRef = useRef<Ui | null>(null);

	const hazir = useCallback((editor: Editor) => {
		uiRef.current = mountUi(editor, { toolbar: "both" });
	}, []);

	// Ada sökülürse arayüz de sökülüyor; editörü `<KalemEditor>` kendisi
	// yıkıyor ve arayüz ondan **önce** temizlenmeli.
	useEffect(() => {
		return () => {
			uiRef.current?.destroy();
			uiRef.current = null;
		};
	}, []);

	return (
		<div className="canli">
			<p className="canli-rozet">
				<b>React</b> · <code>&lt;KalemEditor /&gt;</code> + <code>useKalemValue()</code>
			</p>
			<KalemEditor
				className="canli-yazi kalem-theme"
				defaultValue={ORNEK_BELGE}
				lang="tr"
				label="Canlı örnek — React"
				onReady={hazir}
			>
				<Cikti />
			</KalemEditor>
		</div>
	);
}
