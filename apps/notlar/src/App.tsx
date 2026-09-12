import { KalemEditor } from "@kalem/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Arayuz, type Kollar } from "./Arayuz.js";
import { baslikCikar } from "./baslik.js";
import {
	bosNot,
	depoyuAc,
	type Not,
	notlariOku,
	notlariYaz,
	notuGuncelle,
	sirala,
	taslakAnahtari,
} from "./depo.js";
import { Kenar } from "./Kenar.js";
import { ILK_NOT } from "./ornek.js";

/**
 * Kalem Notlar  (İş listesi: F5-05)
 *
 * Kalem'i kendi ürünü gibi kullanan bir uygulama: yerel bir not defteri.
 * Amaç kütüphanenin yüzeyini sergilemek değil — **gerçekten yazmak**.
 * Eksikler ancak kullanırken görünüyor.
 *
 * ## Editör not başına yeniden kuruluyor
 *
 * `key={secili.id}` bilerek. Not değiştirmek yeni bir belge açmak demek;
 * alternatif `setValue` çağırmaktı ama o da geçmişi zaten sıfırlıyor
 * (önceki belgenin adımlarına geri dönmek tehlikeli olurdu), yani
 * kazandıracağı bir şey yok. Yeniden kurmak ayrıca otomatik kaydetmenin
 * kurtarma anahtarını nota bağlıyor.
 *
 * ## İki ayrı kalıcılık yolu, bilerek
 *
 * - `onChange` → React durumu. Liste başlığı yazarken güncelleniyor.
 * - Otomatik kaydetme eklentisi → `localStorage`, 800 ms sessizlikten
 *   sonra, göstergesiyle birlikte.
 *
 * Her tuşta `localStorage`a yazmak gereksiz; React durumunu 800 ms
 * geciktirmek listeyi tökezletirdi. Ayrım ikisini de doğru yapıyor.
 */
export function App() {
	const [depo] = useState(depoyuAc);
	const [notlar, setNotlar] = useState<Not[]>(() => {
		const okunan = notlariOku(depo);
		return okunan.length > 0 ? sirala(okunan) : [bosNot(ILK_NOT)];
	});
	const [seciliId, setSeciliId] = useState<string>(() => notlar[0]?.id ?? "");
	const [arama, setArama] = useState("");
	const [kaynakta, setKaynakta] = useState(false);
	const [anahatAcik, setAnahatAcik] = useState(true);
	// Başlangıç sistem tercihinden; düğmeye basılınca seçim açık hâle
	// geliyor ve `<html data-theme>` hem kabuğu hem Kalem'i çeviriyor.
	const [koyu, setKoyu] = useState(
		() => window.matchMedia?.("(prefers-color-scheme: dark)").matches === true,
	);
	const [uyari, setUyari] = useState<string | null>(
		depo === null ? "Yerel depoya erişilemiyor; notlar bu oturumdan sonra kaybolacak." : null,
	);

	const anahatKap = useRef<HTMLDivElement | null>(null);
	const sayacKap = useRef<HTMLDivElement | null>(null);
	const kayitKap = useRef<HTMLDivElement | null>(null);
	const dosyaRef = useRef<HTMLInputElement | null>(null);
	const kollarRef = useRef<Kollar | null>(null);
	/**
	 * "Bir sonraki editör kurulduğunda odağı ona ver."
	 *
	 * Yeni not açmak `key`i değiştiriyor, yani editör **o anda yok** —
	 * düğmenin tıklama işleyicisinden `focus()` çağırmak boşa giderdi.
	 * Bayrak, kurulumu bildiren geri çağırmada okunuyor.
	 */
	const odaklanRef = useRef(false);

	/*
	 * Liste bir ref'te aynalanıyor.
	 *
	 * Kaydetme kancası güncel listeye ihtiyaç duyuyor ama bağımlılık
	 * olarak alsaydı her tuşta kimliği değişir, eklentiler baştan
	 * kurulurdu. Aynalamak okuma anını çizime bağlamaktan kurtarıyor.
	 */
	const notlarRef = useRef(notlar);
	notlarRef.current = notlar;

	const secili = notlar.find((n) => n.id === seciliId) ?? notlar[0] ?? null;

	useEffect(() => {
		document.documentElement.dataset["theme"] = koyu ? "dark" : "light";
	}, [koyu]);

	// Geri çağırmalar seçili notu ref'ten okuyor; bağımlılık olarak
	// alsalardı kimlikleri her seçim değişiminde değişirdi.
	const kimlikRef = useRef(seciliId);
	kimlikRef.current = secili?.id ?? seciliId;

	/** Editörün metni; React durumuna iniyor (liste başlığı için). */
	const degisti = useCallback((metin: string) => {
		setNotlar((onceki) => notuGuncelle(onceki, kimlikRef.current, metin));
	}, []);

	/**
	 * Otomatik kaydetmenin kancası.
	 *
	 * Kota dolduğunda `notlariYaz` `false` dönüyor ve burada **hata
	 * fırlatılıyor**: eklenti durumu `error` yapıyor, gösterge
	 * "Kaydedilemedi" diyor. Sessizce yutmak bir not uygulamasında
	 * yapılabilecek en kötü şey.
	 */
	const kaydet = useCallback(
		(metin: string) => {
			const guncel = notuGuncelle(notlarRef.current, kimlikRef.current, metin);
			notlarRef.current = guncel;
			if (!notlariYaz(depo, guncel)) {
				setUyari("Notlar kaydedilemedi — yerel depo dolu olabilir.");
				throw new Error("Yerel depoya yazılamadı");
			}
			setUyari(null);
		},
		[depo],
	);

	const hazir = useCallback((kollar: Kollar | null) => {
		kollarRef.current = kollar;
		if (kollar === null || !odaklanRef.current) return;
		odaklanRef.current = false;
		kollar.editor.focus();
	}, []);

	const yeniNot = useCallback(() => {
		const not = bosNot("# \n");
		// Yeni not açan kişi yazmak istiyor; odağı düğmede bırakmak onu
		// fazladan bir tıklamaya zorlardı.
		odaklanRef.current = true;
		setNotlar((onceki) => {
			const yeni = [not, ...onceki];
			notlariYaz(depo, yeni);
			return yeni;
		});
		setSeciliId(not.id);
		setArama("");
	}, [depo]);

	const notuSil = useCallback(
		(id: string) => {
			setNotlar((onceki) => {
				const kalan = onceki.filter((n) => n.id !== id);
				// Defter hiç boş kalmıyor: boş ekran "her şeyi sildim" hissi
				// veriyor ve yapılacak ilk şey belirsiz kalıyor.
				const yeni = kalan.length > 0 ? kalan : [bosNot(ILK_NOT)];
				notlariYaz(depo, yeni);
				setSeciliId((secim) => (secim === id ? (yeni[0]?.id ?? "") : secim));
				return yeni;
			});
			try {
				depo?.removeItem(taslakAnahtari(id));
			} catch {
				// Taslak kalıntısı zararsız; silinememesi akışı durdurmamalı.
			}
		},
		[depo],
	);

	/** Notu `.md` olarak indiriyor — Markdown taşınabilir olduğu için tek adım. */
	const disaAktar = useCallback(() => {
		if (secili === null) return;
		const ad = `${baslikCikar(secili.metin, "not").replace(/[\\/:*?"<>|]/g, "-")}.md`;
		const adres = URL.createObjectURL(
			new Blob([secili.metin], { type: "text/markdown;charset=utf-8" }),
		);
		const bag = document.createElement("a");
		bag.href = adres;
		bag.download = ad;
		bag.click();
		URL.revokeObjectURL(adres);
	}, [secili]);

	const iceAktar = useCallback(
		async (dosya: File) => {
			const not = bosNot(await dosya.text());
			odaklanRef.current = true;
			setNotlar((onceki) => {
				const yeni = [not, ...onceki];
				notlariYaz(depo, yeni);
				return yeni;
			});
			setSeciliId(not.id);
		},
		[depo],
	);

	return (
		<div className="uygulama">
			<header className="ust">
				<h1>Kalem Notlar</h1>
				<div className="ust-araclar">
					<button type="button" aria-pressed={anahatAcik} onClick={() => setAnahatAcik((a) => !a)}>
						İçindekiler
					</button>
					<button
						type="button"
						aria-pressed={kaynakta}
						onClick={() => kollarRef.current?.kaynak.toggle()}
					>
						Markdown kaynağı
					</button>
					<button type="button" onClick={disaAktar}>
						Dışa aktar
					</button>
					<button type="button" onClick={() => dosyaRef.current?.click()}>
						İçe aktar
					</button>
					<input
						ref={dosyaRef}
						type="file"
						accept=".md,.markdown,text/markdown,text/plain"
						hidden
						onChange={(e) => {
							const dosya = e.target.files?.[0];
							if (dosya !== undefined) void iceAktar(dosya);
							e.target.value = "";
						}}
					/>
					<button type="button" aria-pressed={koyu} onClick={() => setKoyu((k) => !k)}>
						{koyu ? "Açık tema" : "Koyu tema"}
					</button>
				</div>
			</header>

			{uyari === null ? null : (
				<p className="uyari" role="alert">
					{uyari}
				</p>
			)}

			<div className="govde">
				<Kenar
					notlar={notlar}
					seciliId={secili?.id ?? null}
					arama={arama}
					onAra={setArama}
					onSec={setSeciliId}
					onYeni={yeniNot}
					onSil={notuSil}
				/>

				<main className="ana">
					{secili === null ? (
						<p className="bos">Not seçilmedi.</p>
					) : (
						<div className="tuval">
							<KalemEditor
								key={secili.id}
								className="yazi"
								defaultValue={secili.metin}
								onChange={degisti}
								lang="tr"
								label="Not"
							>
								<Arayuz
									anahatKap={anahatKap}
									sayacKap={sayacKap}
									kayitKap={kayitKap}
									taslakAnahtari={taslakAnahtari(secili.id)}
									onKaydet={kaydet}
									onKaynakKip={setKaynakta}
									onHazir={hazir}
								/>
							</KalemEditor>
						</div>
					)}
				</main>

				<div className="anahat" hidden={!anahatAcik} ref={anahatKap} />
			</div>

			<footer className="durum">
				<div ref={sayacKap} className="sayac" />
				<div ref={kayitKap} className="kayit" />
			</footer>
		</div>
	);
}
