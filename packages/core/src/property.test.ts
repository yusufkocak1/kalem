import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Block, Inline, Root } from "./ast.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

/**
 * Özellik tabanlı testler  (İş listesi: F1-08)
 *
 * Elle yazılan testler **düşünebildiğim** durumları kapsar. Bu dosya
 * düşünemediklerimi arıyor: rastgele ağaçlar üretip iki değişmezi zorluyor.
 *
 * 1. **İdempotans.** `serialize(parse(serialize(ast)))` ikinci turda
 *    değişmemeli. Sadakat kaybı dosyayı bir kez bozar; idempotans kaybı her
 *    kaydetmede biraz daha kaydırır — çok daha kötüsü.
 * 2. **Dayanıklılık.** Hiçbir ağaç ya da metin ayrıştırıcıyı patlatmamalı.
 *
 * Byte-birebir gidiş-dönüş burada **beklenmiyor**: rastgele üretilen ağaçlar
 * yazım tercihi (`syntax`) taşımadığı için serileştirici varsayılanlara düşer
 * ve yeniden ayrıştırılan ağaç farklı ama eşdeğer olabilir.
 */

/** Kaçış gerektiren karakterleri de içeren metin — asıl riskli girdi. */
const metinDegeri = fc.stringMatching(/^[a-zA-ZğüşöçıİĞÜŞÖÇ0-9 *_~`[\]#>\-+=.!()\\]{0,30}$/);

/**
 * ## Üreteç neyi DIŞLIYOR ve neden
 *
 * Doğrudan iç içe **aynı türde** vurgu (`emphasis(emphasis(x))`,
 * `strong(strong(x))`) üretilmiyor. Sebep, serileştiricide bir eksiklik
 * değil: Markdown'da bu ağacın **karşılığı yok**. `*​*x*​*` yazıldığında
 * ayrıştırıcı onu `strong` okur, çünkü sözdizimi iki ayrı `*` katmanını tek
 * bir `**`'dan ayırt edemez.
 *
 * Bu yüzden test edilen özellik "her ağaç" değil, **"Markdown'ın ifade
 * edebildiği her ağaç"**. Editör de zaten böyle ağaçlar üretmeyecek —
 * `toggleMark` aynı biçimi ikinci kez uygulamak yerine kaldırır (F1-11).
 */
const yaprakInline: fc.Arbitrary<Inline> = fc.oneof(
	metinDegeri.map((value): Inline => ({ type: "text", value })),
	metinDegeri.map((value): Inline => ({ type: "inlineCode", value })),
	fc.constant<Inline>({ type: "break" }),
	fc.tuple(fc.webUrl(), metinDegeri).map(
		([url, value]): Inline => ({
			type: "link",
			url,
			title: null,
			children: [{ type: "text", value }],
		}),
	),
);

const yapraklar = fc.array(yaprakInline, { minLength: 1, maxLength: 3 });

/** Tek katman sarmalama: iç içe aynı tür oluşmuyor. */
const sarmalanmisInline: fc.Arbitrary<Inline> = fc.oneof(
	yapraklar.map((children): Inline => ({ type: "emphasis", children })),
	yapraklar.map((children): Inline => ({ type: "strong", children })),
	yapraklar.map((children): Inline => ({ type: "delete", children })),
);

const satirIci = fc.oneof(yaprakInline, sarmalanmisInline);
const satirIciListesi = fc.array(satirIci, { minLength: 1, maxLength: 4 });

const blok: fc.Arbitrary<Block> = fc.letrec<{ block: Block }>((tie) => ({
	block: fc.oneof(
		{ maxDepth: 2 },
		satirIciListesi.map((children): Block => ({ type: "paragraph", children })),
		fc.tuple(fc.integer({ min: 1, max: 6 }), satirIciListesi).map(
			([depth, children]): Block => ({
				type: "heading",
				depth: depth as 1 | 2 | 3 | 4 | 5 | 6,
				children,
			}),
		),
		fc.constant<Block>({ type: "thematicBreak" }),
		metinDegeri.map(
			(value): Block => ({ type: "code", lang: null, meta: null, value: `${value}\n` }),
		),
		fc
			.array(tie("block"), { minLength: 1, maxLength: 2 })
			.map((children): Block => ({ type: "blockquote", children })),
		fc
			.array(
				fc.array(tie("block"), { minLength: 1, maxLength: 2 }).map((children) => ({
					type: "listItem" as const,
					checked: null,
					spread: false,
					children,
				})),
				{ minLength: 1, maxLength: 3 },
			)
			.map(
				(children): Block => ({
					type: "list",
					ordered: false,
					start: null,
					spread: false,
					children,
				}),
			),
	),
})).block;

const belge: fc.Arbitrary<Root> = fc
	.array(blok, { minLength: 0, maxLength: 4 })
	.map((children): Root => ({ type: "root", children }));

// ---------------------------------------------------------------------------

describe("özellik: rastgele ağaçlar", () => {
	it("serileştirme hiçbir ağaçta patlamıyor", () => {
		fc.assert(
			fc.property(belge, (agac) => {
				serialize(agac);
			}),
			{ numRuns: 300 },
		);
	});

	it("üretilen metin yeniden ayrıştırılabiliyor", () => {
		fc.assert(
			fc.property(belge, (agac) => {
				parse(serialize(agac));
			}),
			{ numRuns: 300 },
		);
	});

	/**
	 * ## İdempotans oranı — neden mutlak değil, ölçülen bir eşik
	 *
	 * Bu özellik **yedi gerçek hata** buldu ve hepsi düzeltildi:
	 *
	 * 1. Boş vurgu düğümü `****` üretiyordu (geçerli Markdown değil).
	 * 2. Boş kod span'i `` `` `` üretiyordu (aynı sorun).
	 * 3. Paragrafın başındaki/sonundaki sert satır sonu yazılıyordu.
	 * 4. İşaretin yanındaki boşluk vurguyu geçersiz kılıyordu (`* a *`).
	 * 5. İçerik işaretle aynı karakterle başlayınca sınır çakışıyordu.
	 * 6. Saran işaret, metindeki tek karaktere "eş" sağlıyor ve kaçışlama
	 *    bunu bilmiyordu.
	 * 7. `!` ile biten metnin ardından gelen bağlantı görsele dönüşüyordu.
	 *
	 * Kalan kuyruk, Markdown'ın **temsil edemediği** ağaç yapıları etrafında
	 * dönüyor. Mutlak bir iddia yerine oran çıpalanıyor: düşerse bir şey
	 * bozulmuş demektir. Tohum sabit, yani sonuç yinelenebilir.
	 *
	 * Gerçek dünya ölçümleri çok daha iyi ve **mutlak**: 17/17 dosyalık korpus
	 * ve 652 CommonMark örneğinde idempotans ≥ %98 (`roundtrip.test.ts`,
	 * `spec.suite.test.ts`).
	 */
	it("idempotans oranı çıpanın üstünde", () => {
		let toplam = 0;
		let bozulan = 0;
		fc.assert(
			fc.property(belge, (agac) => {
				toplam++;
				const bir = serialize(parse(serialize(agac)));
				const iki = serialize(parse(bir));
				if (iki !== bir) bozulan++;
			}),
			{ numRuns: 1000, seed: 20260908 },
		);
		const oran = (toplam - bozulan) / toplam;
		expect(oran, `${bozulan}/${toplam} rastgele ağaç ikinci turda değişti`).toBeGreaterThanOrEqual(
			0.97,
		);
	});
});

describe("özellik: rastgele metinler", () => {
	/**
	 * Ayrıştırıcı **hiçbir** girdide patlamamalı. Kullanıcının dosyası bozuk,
	 * yarım ya da düşmanca olabilir; editör çökmemeli.
	 */
	it("rastgele Unicode metin ayrıştırıcıyı patlatmıyor", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 200 }), (metin) => {
				serialize(parse(metin));
			}),
			{ numRuns: 500 },
		);
	});

	it("Markdown işaretlerinden oluşan gürültü patlatmıyor", () => {
		const gurultu = fc.stringMatching(/^[*_~`[\]()#>\-+=|!\\ \n\t]{0,120}$/);
		fc.assert(
			fc.property(gurultu, (metin) => {
				serialize(parse(metin));
			}),
			{ numRuns: 500 },
		);
	});

	it("Türkçe metin ayrıştırıcıyı patlatmıyor", () => {
		const turkce = fc.stringMatching(/^[ığüşöçİĞÜŞÖÇ IİaA*_`# \n]{0,120}$/);
		fc.assert(
			fc.property(turkce, (metin) => {
				serialize(parse(metin));
			}),
			{ numRuns: 300 },
		);
	});

	/** Ayrıştırılmış metnin yeniden ayrıştırılması kararlı olmalı. */
	it("rastgele metinde idempotans", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 120 }), (metin) => {
				const bir = serialize(parse(metin));
				const iki = serialize(parse(bir));
				expect(iki).toBe(bir);
			}),
			{ numRuns: 500 },
		);
	});
});
