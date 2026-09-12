import type { Editor } from "@kalem/editor";
import { autosavePlugin, createIndicator, trAutosaveLabels } from "@kalem/plugin-autosave";
import { codeHighlightPlugin } from "@kalem/plugin-code-highlight";
import { findReplacePlugin } from "@kalem/plugin-find-replace";
import { outlinePlugin } from "@kalem/plugin-outline";
import { type SourceModePlugin, sourceModePlugin } from "@kalem/plugin-source-mode";
import { wordCountPlugin } from "@kalem/plugin-word-count";
import { useKalem } from "@kalem/react";
import { mountUi } from "@kalem/ui";
import { type RefObject, useEffect, useRef } from "react";

/**
 * Kalem Notlar — Arayüz ve eklenti montajı  (İş listesi: F5-05)
 *
 * Bu bileşen **hiçbir şey çizmiyor** (`null` dönüyor); tek işi editör
 * hazır olduğunda arayüzü ve altı eklentiyi kurmak, sökülürken geri
 * almak.
 *
 * `<KalemEditor>`in **çocuğu** olması şart: `useKalem()` bağlamdan
 * okuyor ve editör örneği ancak sağlayıcının içinde görünüyor. Etkinin
 * bağımlılığı `editor`; ilk çizimde `null`, montajdan sonra dolu.
 *
 * ## Neden hepsi tek etkinin içinde
 *
 * Araç çubuğu, eklentiler ve paneller aynı ömre sahip: editör yaşadığı
 * sürece var, yıkılınca yok. Ayrı etkilere bölmek her birine aynı `null`
 * kontrolünü ve aynı temizleyiciyi yazdırırdı.
 *
 * ## Geri çağırmalar neden ref'te
 *
 * Etki yeniden çalışırsa arayüz ve eklentiler **baştan kuruluyor** —
 * kullanıcı yazarken araç çubuğunun yok olup yeniden belirmesi demek bu.
 * Geri çağırmalar bağımlılık listesinde dursaydı, üst bileşendeki her
 * durum değişikliği bunu tetikleyebilirdi. Ref'ler her çizimde
 * tazeleniyor, bağımlılık listesi ise yalnızca editöre ve belgeye bakıyor.
 * (`@kalem/react` sarmalayıcısı kendi içinde aynı şeyi yapıyor.)
 *
 * ## Paneller neden dışarıdan geliyor
 *
 * `container` alan eklentiler (içindekiler, kelime sayacı) kendi yerlerini
 * seçmiyor: ekranın neresine ait olduklarını uygulama biliyor, kütüphane
 * bilmiyor. Kaplar React tarafından çiziliyor ve buraya `ref` olarak
 * geçiyor — React `ref`leri etkilerden **önce** bağladığı için düğümler
 * bu noktada hazır.
 */
export interface Kollar {
	readonly editor: Editor;
	readonly kaynak: SourceModePlugin;
}

export interface ArayuzProps {
	/** İçindekiler panelinin kabı. */
	anahatKap: RefObject<HTMLElement | null>;
	/** Kelime sayacının kabı. */
	sayacKap: RefObject<HTMLElement | null>;
	/** Kaydetme göstergesinin kabı. */
	kayitKap: RefObject<HTMLElement | null>;
	/** Otomatik kaydetmenin kurtarma anahtarı — not başına ayrı. */
	taslakAnahtari: string;
	/** Metni kalıcı hâle getiren kanca; hata fırlatırsa gösterge "Kaydedilemedi" diyor. */
	onKaydet: (markdown: string) => void;
	/** Kaynak kipine girip çıkıldığında — düğmenin basılı durumu için. */
	onKaynakKip: (kaynakta: boolean) => void;
	/** Editör kurulduğunda; üst bileşen imperatif erişim istiyor. */
	onHazir: (kollar: Kollar | null) => void;
}

export function Arayuz(props: ArayuzProps): null {
	const { anahatKap, sayacKap, kayitKap, taslakAnahtari } = props;
	const editor = useKalem();

	const guncel = useRef(props);
	guncel.current = props;

	useEffect(() => {
		if (editor === null) return;

		/*
		 * Word deneyimi: hem sabit çubuk hem balon.
		 *
		 * Sabit çubuk "burada neler var"ı seçim yapmadan gösteriyor, balon
		 * ise biçimlendirmeyi metnin yanında sunuyor. Not uygulamasında
		 * ikisi de işe yarıyor: uzun yazıda balon, ilk kullanımda çubuk.
		 */
		const ui = mountUi(editor, { toolbar: "both" });

		const kayitEl = kayitKap.current;
		const gosterge =
			kayitEl === null
				? null
				: createIndicator(kayitEl, { prefix: "kalem-", labels: trAutosaveLabels });

		const kaynak = sourceModePlugin({
			onModeChange: (kaynakta) => guncel.current.onKaynakKip(kaynakta),
		});

		const eklentiler = [
			codeHighlightPlugin(),
			findReplacePlugin(),
			outlinePlugin({ container: anahatKap.current }),
			wordCountPlugin({ container: sayacKap.current }),
			kaynak,
			autosavePlugin({
				delay: 800,
				// Anahtar not başına ayrı: aynı kaynakta birden çok belge
				// açılıyor ve ortak bir anahtar, bir notun taslağını başka
				// bir nota getirirdi.
				storageKey: taslakAnahtari,
				save: (markdown) => guncel.current.onKaydet(markdown),
				onStateChange: (durum) => gosterge?.render(durum),
			}),
		];

		for (const eklenti of eklentiler) editor.addPlugin(eklenti);
		guncel.current.onHazir({ editor, kaynak });

		return () => {
			/*
			 * Arayüz önce sökülüyor.
			 *
			 * `ui.destroy()` kendi kısayol eklentisini (Ctrl+K) editörden
			 * kaldırıyor; editör yıkıldıktan sonra çağrılsaydı olmayan bir
			 * kayda dokunurdu. Eklentileri tek tek kaldırmak da aynı sebeple
			 * burada: `editor.destroy()` zaten hepsini kapatıyor ama bu
			 * bileşen editörden **önce** temizleniyor ve sıra burada
			 * belirleniyor.
			 */
			ui.destroy();
			for (const eklenti of eklentiler) editor.removePlugin(eklenti.name);
			gosterge?.destroy();
			guncel.current.onHazir(null);
		};
	}, [editor, anahatKap, sayacKap, kayitKap, taslakAnahtari]);

	return null;
}
