import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

/**
 * CommonMark spec suite  (İş listesi: F1-08 / F1-03 / F1-04)
 *
 * ## Neden burada tam uyum ölçülmüyor
 *
 * Spec suite `markdown → HTML` karşılaştırır. Bizim HTML render'ımız
 * (`renderToString`) **F2-02**'de geliyor — yani asıl uyum oranı Faz 2'den
 * önce ölçülemez. Bu, iş listesinde yakalanmamış bir bağımlılık; F1-03 ve
 * F1-04'ün "spec suite'te ≥ %90" kabul kriterleri o zamana kadar açık kalıyor.
 *
 * Buraya kadar ölçülebilen iki şey var ve ikisi de değerli:
 *
 * 1. **Dayanıklılık** — 652 girdinin hiçbirinde patlamamak. Pazarlıksız:
 *    kullanıcının dosyası ne kadar tuhaf olursa olsun editör çökmemeli.
 * 2. **Gidiş-dönüş oranı** — yapıyı doğru anladığımızın dolaylı ama güçlü
 *    göstergesi, ve bozulmaları bölüm bölüm gösteriyor.
 */

interface SpecOrnek {
	readonly example: number;
	readonly section: string;
	readonly markdown: string;
	readonly html: string;
}

const ORNEKLER: readonly SpecOrnek[] = JSON.parse(
	readFileSync(new URL("../fixtures/commonmark/spec-0.31.2.json", import.meta.url), "utf8"),
);

describe("CommonMark spec — dayanıklılık", () => {
	it("652 örnek yüklendi", () => {
		expect(ORNEKLER.length).toBe(652);
	});

	/**
	 * **Pazarlıksız kural.** Ayrıştırıcı hiçbir girdide patlamamalı; spec
	 * örnekleri kasten uç durumlarla dolu ve gerçek dünyadaki bozuk dosyaları
	 * temsil ediyor.
	 */
	it("hiçbir örnekte ayrıştırıcı patlamıyor", () => {
		const patlayanlar: string[] = [];
		for (const o of ORNEKLER) {
			try {
				parse(o.markdown);
			} catch (hata) {
				patlayanlar.push(`#${o.example} (${o.section}): ${String(hata)}`);
			}
		}
		expect(patlayanlar, patlayanlar.slice(0, 5).join("\n")).toEqual([]);
	});

	it("hiçbir örnekte serileştirici patlamıyor", () => {
		const patlayanlar: string[] = [];
		for (const o of ORNEKLER) {
			try {
				serialize(parse(o.markdown));
			} catch (hata) {
				patlayanlar.push(`#${o.example} (${o.section}): ${String(hata)}`);
			}
		}
		expect(patlayanlar, patlayanlar.slice(0, 5).join("\n")).toEqual([]);
	});

	/**
	 * İdempotans, gidiş-dönüş sadakatinden **daha önemli**: sadakat kaybı
	 * dosyayı bir kez değiştirir, idempotans kaybı her kaydetmede biraz daha
	 * kaydırır.
	 */
	it("idempotans oranı ≥ %98", () => {
		const bozulanlar: string[] = [];
		for (const o of ORNEKLER) {
			const bir = serialize(parse(o.markdown));
			const iki = serialize(parse(bir));
			if (bir !== iki) bozulanlar.push(`#${o.example} ${o.section}`);
		}
		const oran = (ORNEKLER.length - bozulanlar.length) / ORNEKLER.length;
		expect(
			oran,
			`bozulan ${bozulanlar.length}: ${bozulanlar.slice(0, 10).join(" · ")}`,
		).toBeGreaterThanOrEqual(0.98);
	});
});

/**
 * Bölüm bölüm gidiş-dönüş oranı.
 *
 * Tek bir toplam sayı hangi alanın zayıf olduğunu saklar. Bölüm bazında
 * ölçmek, Faz 2'de spec uyumu ölçülürken nereye bakılacağını şimdiden
 * gösteriyor.
 */
describe("CommonMark spec — gidiş-dönüş oranı", () => {
	const bolumler = [...new Set(ORNEKLER.map((o) => o.section))];

	/** Bölümün gidiş-dönüşten geçen örnek sayısı. */
	function olc(bolum: string): { gecen: number; toplam: number; bozulan: number[] } {
		const kume = ORNEKLER.filter((o) => o.section === bolum);
		const bozulan: number[] = [];
		for (const o of kume) {
			if (serialize(parse(o.markdown)) !== o.markdown) bozulan.push(o.example);
		}
		return { gecen: kume.length - bozulan.length, toplam: kume.length, bozulan };
	}

	it("bölüm raporu üretiliyor", () => {
		const satirlar = bolumler
			.map((b) => {
				const { gecen, toplam } = olc(b);
				const yuzde = Math.round((gecen / toplam) * 100);
				return `${String(yuzde).padStart(3)}%  ${String(gecen).padStart(3)}/${String(toplam).padEnd(3)}  ${b}`;
			})
			.sort();
		const { gecen, toplam } = bolumler.reduce(
			(a, b) => {
				const r = olc(b);
				return { gecen: a.gecen + r.gecen, toplam: a.toplam + r.toplam };
			},
			{ gecen: 0, toplam: 0 },
		);
		console.log(
			`\nCommonMark gidiş-dönüş — toplam ${gecen}/${toplam} (%${Math.round((gecen / toplam) * 100)})\n${satirlar.join("\n")}\n`,
		);
		expect(toplam).toBe(652);
	});

	/**
	 * Eşik bilinçli olarak **düşük** tutuldu.
	 *
	 * Spec örnekleri byte-birebir gidiş-dönüş için tasarlanmadı: birçoğu
	 * kasten normalleştirilecek girdiler (fazladan boşluk, tuhaf girinti,
	 * eksik kapanış). Buradaki sayı bir **regresyon çıpası** — düşerse bir
	 * şey bozulmuş demektir, yükselmesi iyi haber.
	 */
	it("genel gidiş-dönüş oranı çıpanın üstünde", () => {
		const bozulan = ORNEKLER.filter((o) => serialize(parse(o.markdown)) !== o.markdown);
		const oran = (ORNEKLER.length - bozulan.length) / ORNEKLER.length;
		expect(oran, `${bozulan.length} örnek bozuluyor`).toBeGreaterThanOrEqual(0.5);
	});
});
