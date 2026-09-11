"use client";

import { KalemEditor, useKalemValue } from "@kalem/react";
import { useState } from "react";

/**
 * İstemci bileşeni.
 *
 * `'use client'` burada gerekli çünkü `useState` kullanıyor. `@kalem/react`
 * kendi yönergesini zaten taşıyor; bu dosya onu tekrar etmek zorunda
 * değildi ama kendi durumunu tuttuğu için ediyor.
 */
export function Duzenleyici({ baslangic }: { baslangic: string }) {
	const [kayitli, setKayitli] = useState<string | null>(null);

	return (
		<>
			<KalemEditor className="editor" defaultValue={baslangic} lang="tr" label="Belge">
				<Sayac />
			</KalemEditor>

			<p className="durum">
				<button type="button" onClick={() => setKayitli(new Date().toLocaleTimeString("tr-TR"))}>
					Kaydet
				</button>
				{kayitli === null ? " henüz kaydedilmedi" : ` ${kayitli} itibarıyla kaydedildi`}
			</p>
		</>
	);
}

/** Kontrolsüz kullanımda metni izlemenin yolu: `useKalemValue`. */
function Sayac() {
	const metin = useKalemValue();
	return <p className="durum">{metin.length} karakter</p>;
}
