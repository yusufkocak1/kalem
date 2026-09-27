/**
 * @kalem-editor/react — Bağlam ve kancalar  (İş listesi: F5-01)
 *
 * ## `useSyncExternalStore` neden
 *
 * Editörün metni React'in dışında yaşıyor: kullanıcı yazarken model
 * DOM'dan okunuyor ve React bundan haberdar değil. Bu, React'in "harici
 * depo" dediği şeyin tam tanımı.
 *
 * Naif çözüm `useEffect` + `useState` olurdu ve iki yerden yanlış:
 *
 * - **Yırtılma (tearing).** Eşzamanlı render sırasında aynı ağacın iki
 *   bileşeni değeri farklı anlarda okuyabiliyor; biri eski metni, öteki
 *   yenisini gösteriyor. `useSyncExternalStore` React'e "bu değer dışarıda
 *   ve her okuma tutarlı olmalı" diyor.
 * - **Kaçırılan güncelleme.** Abone olmadan önce değişen bir değer
 *   `useEffect` yolunda kayboluyor; `useSyncExternalStore` abonelikten
 *   sonra anlık görüntüyü yeniden okuyor.
 *
 * ## Sunucu anlık görüntüsü
 *
 * Sunucuda editör yok. `getServerSnapshot` başlangıç metnini döndürüyor;
 * döndürmeseydi Next.js App Router'da (`'use client'` bile olsa) sunucu
 * render'ı hata veriyor — React bu kancayı SSR'de zorunlu tutuyor.
 *
 * ## React 17
 *
 * `useSyncExternalStore` React 18'de geldi. Peer aralığı `>=17` olduğu
 * için, kanca yoksa aynı işi yapan on satırlık bir yedek kullanılıyor
 * (`useReducer` + `useEffect`). Yedek **yırtılmaya karşı korumuyor** ama
 * buna gerek de yok: yırtılma eşzamanlı render'ın bir sonucu ve React
 * 17'de eşzamanlı render yok.
 *
 * Seçim modül düzeyinde bir kez yapılıyor, koşullu kanca çağrısı
 * değil — React sürümü çalışma sırasında değişmediği için kanca sırası
 * sabit kalıyor.
 */
import type { Editor } from "@kalem-editor/editor";
import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from "react";

/**
 * `useSyncExternalStore`un React 17 yedeği.
 *
 * Adı `use` ile başlıyor çünkü gerçekten bir kanca: içinde `useReducer`
 * ve `useEffect` çağırıyor ve yalnızca bir bileşenin en üst düzeyinden
 * çağrılabiliyor.
 */
function useYedekStore<T>(
	subscribe: (onChange: () => void) => () => void,
	getSnapshot: () => T,
): T {
	const [, cizdir] = useReducer((n: number) => n + 1, 0);
	const deger = getSnapshot();
	useEffect(() => {
		// Abone olmadan önce değişmiş olabilir; bir kez zorla okunuyor.
		cizdir();
		return subscribe(cizdir);
	}, [subscribe]);
	return deger;
}

const useStore: <T>(
	subscribe: (onChange: () => void) => () => void,
	getSnapshot: () => T,
	getServerSnapshot?: () => T,
) => T = React.useSyncExternalStore ?? useYedekStore;

/**
 * Editör örneği; `<KalemEditor>` içinde `null` değil.
 *
 * `null` iki durumda: sağlayıcı dışında kullanım ve ilk render (editör
 * `useEffect` içinde kuruluyor, çünkü DOM elemanı o ana kadar yok).
 */
export const KalemContext = createContext<Editor | null>(null);

/**
 * Editör örneğine erişim.
 *
 * `<KalemEditor>`in **çocuğu** olan bileşenler için: kendi araç
 * çubuğunu, sayacını ya da düğmesini yazan uygulama buradan editörü
 * alıyor ve imperatif API'yi kullanıyor.
 *
 * İlk render'da `null` — DOM elemanı henüz yok. Etkiler çalıştıktan
 * sonraki render'da dolu.
 */
export function useKalem(): Editor | null {
	return useContext(KalemContext);
}

/**
 * Editörün güncel Markdown metni.
 *
 * Değiştikçe bileşeni yeniden çizdiriyor. Kontrollü kullanımda
 * (`value` + `onChange`) buna gerek yok — metin zaten üst bileşende.
 * Bu kanca, metni **okumak isteyen ama sahiplenmek istemeyen** kardeş
 * bileşenler için: bir kelime sayacı, bir önizleme, bir "kaydedilmedi"
 * rozeti.
 *
 * @param fallback Editör henüz yokken (ilk render, SSR) dönen değer.
 */
export function useKalemValue(fallback = ""): string {
	const editor = useKalem();
	/**
	 * Anlık görüntü burada tutuluyor, her okumada üretilmiyor.
	 *
	 * İki sebep. Birincisi maliyet: `getValue()` belgeyi baştan
	 * serileştiriyor ve `getSnapshot` her render'da çağrılıyor — okumak
	 * isteyen üç bileşen, tuş başına üç serileştirme demekti. İkincisi
	 * `change` olayının metni **zaten taşıması**: editör onu bir kez
	 * üretip yayıyor, ikinci kez üretmenin bir kazancı yok.
	 */
	const deger = useRef(fallback);

	const subscribe = useCallback(
		(onChange: () => void) => {
			if (editor === null) return () => {};
			// Abone olurken güncel değer okunuyor: React abonelikten sonra
			// anlık görüntüyü yeniden soruyor, yani ilk değer buradan geliyor.
			deger.current = editor.getValue();
			return editor.on("change", (value) => {
				deger.current = value;
				onChange();
			});
		},
		[editor],
	);

	const getSnapshot = useCallback(
		() => (editor === null ? fallback : deger.current),
		[editor, fallback],
	);

	// Sunucuda editör hiç kurulmuyor; anlık görüntü sabit.
	const getServerSnapshot = useCallback(() => fallback, [fallback]);

	return useStore(subscribe, getSnapshot, getServerSnapshot);
}
