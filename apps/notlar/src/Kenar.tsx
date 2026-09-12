import { matches, score } from "@kalem/ui";
import { useMemo } from "react";
import { baslikCikar, ozetCikar } from "./baslik.js";
import type { Not } from "./depo.js";

/**
 * Kalem Notlar — Not listesi  (İş listesi: F5-05)
 *
 * ## Arama neden `@kalem/ui`den geliyor
 *
 * `foldForSearch` slash menüsü için yazılmıştı (F3-03) ama işi genel:
 * Türkçe'de `ısık` yazan biri `Işık`ı bulmalı, `İSTANBUL` araması
 * `istanbul`u bulmalı. Aynı katlamayı burada ikinci kez yazmak, iki
 * yerde ayrı ayrı yanlış olma hakkı kazanmak olurdu.
 *
 * `score` sıralamayı da veriyor: baştan eşleşen not, ortadan eşleşenin
 * üstünde.
 */
export interface KenarProps {
	notlar: readonly Not[];
	seciliId: string | null;
	arama: string;
	onAra: (deger: string) => void;
	onSec: (id: string) => void;
	onYeni: () => void;
	onSil: (id: string) => void;
}

const LOCALE = "tr";

export function Kenar(props: KenarProps) {
	const { notlar, seciliId, arama, onAra, onSec, onYeni, onSil } = props;

	const gorunen = useMemo(() => {
		if (arama.trim() === "") return notlar;
		const q = arama.trim();
		return notlar
			.filter((n) => matches(n.metin, q, LOCALE))
			.map((n) => ({ not: n, puan: score(baslikCikar(n.metin), q, LOCALE) }))
			.sort((a, b) => b.puan - a.puan)
			.map((x) => x.not);
	}, [notlar, arama]);

	return (
		<aside className="kenar">
			<div className="kenar-ust">
				<button type="button" className="birincil" onClick={onYeni}>
					Yeni not
				</button>
				<input
					type="search"
					className="ara"
					value={arama}
					placeholder="Notlarda ara"
					aria-label="Notlarda ara"
					onChange={(e) => onAra(e.target.value)}
				/>
			</div>

			{gorunen.length === 0 ? (
				<p className="bos">
					{arama.trim() === "" ? "Henüz not yok." : `“${arama.trim()}” için sonuç yok.`}
				</p>
			) : (
				<ul className="liste">
					{gorunen.map((not) => (
						<li key={not.id}>
							<button
								type="button"
								className={`satir${not.id === seciliId ? " secili" : ""}`}
								aria-current={not.id === seciliId ? "true" : undefined}
								onClick={() => onSec(not.id)}
							>
								<span className="ad">{baslikCikar(not.metin)}</span>
								<span className="ozet">{ozetCikar(not.metin) || "boş"}</span>
								<span className="zaman">{zamanYaz(not.guncellenme)}</span>
							</button>
							<button
								type="button"
								className="sil"
								aria-label={`${baslikCikar(not.metin)} notunu sil`}
								onClick={() => onSil(not.id)}
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}
		</aside>
	);
}

/**
 * "3 dakika önce" gibi.
 *
 * `Intl.RelativeTimeFormat` kullanılıyor; elle yazılmış bir Türkçe tablo
 * hem eksik olurdu hem de uygulamanın diline kilitlenirdi.
 */
const GORECELI = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const BIRIMLER: [Intl.RelativeTimeFormatUnit, number][] = [
	["second", 60],
	["minute", 60],
	["hour", 24],
	["day", 7],
	["week", 4.35],
	["month", 12],
];

function zamanYaz(zaman: number): string {
	let fark = (zaman - Date.now()) / 1000;
	for (const [birim, bolen] of BIRIMLER) {
		if (Math.abs(fark) < bolen) return GORECELI.format(Math.round(fark), birim);
		fark /= bolen;
	}
	return GORECELI.format(Math.round(fark), "year");
}
