"use client";

/**
 * @kalem/react — `<KalemEditor />`  (İş listesi: F5-01)
 *
 * Editörü React ağacına bağlayan ince katman. "İnce" burada gerçek
 * anlamıyla: bu dosya düzenleme hakkında hiçbir şey bilmiyor, yalnızca
 * yaşam döngüsünü ve iki yönlü akışı yönetiyor.
 *
 * ## `'use client'` neden dosyanın başında
 *
 * Next.js App Router'da bileşenler varsayılan olarak **sunucuda**
 * çalışıyor. Bu bileşen `useEffect` içinde DOM'a editör kuruyor, yani
 * istemci bileşeni olmak zorunda. Yönergeyi paketin içine koymak, gömen
 * uygulamanın her sayfada hatırlaması gereken bir şeyi ortadan
 * kaldırıyor.
 *
 * ## Kontrollü ve kontrolsüz
 *
 * React'in `<input>` için kurduğu ayrımın aynısı:
 *
 * - **Kontrolsüz** (`defaultValue`): metin editörde yaşıyor, React
 *   karışmıyor. Çoğu kullanım bu.
 * - **Kontrollü** (`value`): metin üst bileşende. `value` dışarıdan
 *   değişince editöre yazılıyor.
 *
 * Kontrollü kipin klasik tuzağı sonsuz döngü: kullanıcı yazıyor →
 * `onChange` → üst bileşen `setState` → `value` değişiyor → editöre
 * yazılıyor → imleç başa kaçıyor. Buradaki çözüm, editörün **kendi
 * yaydığı** metni hatırlamak: gelen `value` ona eşitse hiçbir şey
 * yapılmıyor. Yani yalnızca gerçekten dışarıdan gelen bir değişiklik
 * editöre iniyor.
 *
 * ## Editör neden yalnızca bir kez kuruluyor
 *
 * Kurulum pahalı (ayrıştırma, render, olay abonelikleri) ve her kurulum
 * imleci, seçimi ve geçmişi sıfırlıyor. Bu yüzden `lang`, `plugins`,
 * `label` gibi seçenekler **montaj anında** okunuyor; sonradan
 * değiştirilmeleri yeni bir editör gerektirirdi ve kullanıcının yazdığı
 * yeri kaybetmesi, bir prop'un geç uygulanmasından kötü. Değişebilen iki
 * şey — `value` ve `readOnly` — editörün kendi API'siyle güncelleniyor.
 *
 * Geri çağırmalar (`onChange`) bunun istisnası: bir ref'te tutuluyorlar,
 * yani her render'da tazeleniyor ama editör yeniden kurulmuyor. Aksi
 * hâlde satır içi yazılan her `onChange={() => …}` editörü yeniden
 * kurardı.
 *
 * ## Strict Mode
 *
 * React 19'un geliştirme kipi her etkiyi kurup söküp yeniden kuruyor.
 * Temizleyici `destroy()` çağırıyor ve editör DOM içeriğini **bırakıyor**
 * (belgesel karar: sökülen editörün yerinde boş kutu kalmamalı). İkinci
 * kurulum o artığı temizliyor — `#sync` kendi ürettiği bloklardan sonra
 * kalan her düğümü siliyor. Bir tarayıcı testi bunu sabitliyor.
 */
import type { Root } from "@kalem/core";
import type { Plugin } from "@kalem/editor";
import { Editor } from "@kalem/editor";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { KalemContext } from "./context.js";

export interface KalemEditorProps {
	/** Kontrollü metin. Verilirse `defaultValue` yok sayılıyor. */
	value?: string;
	/** Kontrolsüz başlangıç metni. */
	defaultValue?: string;
	/** İçerik değiştiğinde. */
	onChange?: (value: string, doc: Root) => void;
	/** Editör kurulduğunda — imperatif erişim isteyen üst bileşen için. */
	onReady?: (editor: Editor) => void;
	readOnly?: boolean;
	/** Belge dili; yazım denetimi sözlüğünü seçiyor. Montaj anında okunuyor. */
	lang?: string;
	/** Erişilebilir ad (`aria-label`). Montaj anında okunuyor. */
	label?: string;
	/** Eklentiler. Montaj anında okunuyor. */
	plugins?: readonly Plugin[];
	className?: string;
	style?: CSSProperties;
	id?: string;
	/**
	 * Editörün **yanına** çizilen içerik.
	 *
	 * Kendi araç çubuğunu yazan uygulama için: buradaki bileşenler
	 * `useKalem()` ile editöre erişiyor. Düzenlenebilir alanın **içine**
	 * konmuyorlar — orası modelden çiziliyor ve React'in koyduğu her
	 * düğüm ilk render'da silinirdi.
	 */
	children?: ReactNode;
}

export function KalemEditor(props: KalemEditorProps): ReactNode {
	const { className, style, id, children } = props;
	const kap = useRef<HTMLDivElement | null>(null);
	const [editor, setEditor] = useState<Editor | null>(null);

	/**
	 * Güncel prop'lar.
	 *
	 * Editör bir kez kuruluyor ama geri çağırmalar her render'da
	 * değişebiliyor; kurulum anındakini yakalamak, ikinci render'dan
	 * sonra eski `onChange`i çağırmak olurdu.
	 */
	const guncel = useRef(props);
	guncel.current = props;

	/** Editörün en son **kendi yaydığı** metin (döngü kırıcı). */
	const yayilan = useRef<string | null>(null);

	// Boş bağımlılık dizisi **bilerek**: editör yalnızca bir kez kuruluyor,
	// değişen prop'lar aşağıdaki etkilerle uygulanıyor (dosya başındaki not).
	useEffect(() => {
		const el = kap.current;
		if (el === null) return;

		const p = guncel.current;
		const ilk = p.value ?? p.defaultValue ?? "";
		yayilan.current = ilk;

		const ed = new Editor(el, {
			value: ilk,
			readOnly: p.readOnly ?? false,
			...(p.lang === undefined ? {} : { lang: p.lang }),
			...(p.label === undefined ? {} : { label: p.label }),
			...(p.plugins === undefined ? {} : { plugins: [...p.plugins] }),
			onChange: (value, doc) => {
				yayilan.current = value;
				guncel.current.onChange?.(value, doc);
			},
		});

		setEditor(ed);
		guncel.current.onReady?.(ed);

		return () => {
			ed.destroy();
			setEditor(null);
		};
	}, []);

	// Kontrollü kip: dışarıdan gelen metin editöre yazılıyor.
	useEffect(() => {
		if (editor === null || props.value === undefined) return;
		// Editörün kendi yaydığı metin geri geldiyse hiçbir şey yapma.
		if (props.value === yayilan.current) return;
		yayilan.current = props.value;
		editor.setValue(props.value);
	}, [editor, props.value]);

	useEffect(() => {
		if (editor === null) return;
		editor.setReadOnly(props.readOnly ?? false);
	}, [editor, props.readOnly]);

	return (
		<KalemContext.Provider value={editor}>
			<div ref={kap} className={className} style={style} id={id} />
			{children}
		</KalemContext.Provider>
	);
}
