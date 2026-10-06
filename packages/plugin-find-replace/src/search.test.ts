/**
 * Bölge çıkarma, arama ve değiştirme — testler  (İş listesi: F4-03)
 *
 * Eklentinin saf yarısı. Kabul kriterlerinin ikisi de burada ölçülüyor:
 * Türkçe eşleşme çiftleri ve 100 sayfalık belgede tarama süresi.
 */
import { parse, serialize } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import { regionsOf } from "./regions.js";
import { replaceAll, replaceOne } from "./replace.js";
import type { SearchOptions } from "./search.js";
import {
	createIndex,
	findMatches,
	nextFrom,
	previousFrom,
	replacementFor,
	unescapeExtended,
} from "./search.js";

/** Belgedeki eşleşmelerin metinleri — testi okunur kılan kısayol. */
function bul(md: string, query: string, options: SearchOptions = {}, locale = "tr"): string[] {
	const doc = parse(md);
	const index = createIndex(doc, locale);
	return findMatches(index, query, options).map((m) =>
		(index.regions[m.regionIndex] as { text: string }).text.slice(m.from, m.to),
	);
}

/** Değiştirilmiş belgenin Markdown çıktısı; değiştirme metni moda göre çözülüyor. */
function degistir(md: string, query: string, value: string, options: SearchOptions = {}): string {
	const doc = parse(md);
	const index = createIndex(doc, "tr");
	const matches = findMatches(index, query, options);
	const sonuc = replaceAll(doc, index.regions, matches, (m) =>
		replacementFor(index, m, query, value, options),
	);
	return sonuc === null ? serialize(doc) : serialize(sonuc.doc);
}

describe("regionsOf", () => {
	it("paragraf ve başlık ayrı bölgeler", () => {
		const bolgeler = regionsOf(parse("# Başlık\n\nParagraf.\n"));
		expect(bolgeler.map((r) => r.text)).toEqual(["Başlık", "Paragraf."]);
		expect(bolgeler.map((r) => r.kind)).toEqual(["inline", "inline"]);
	});

	it("blok kimliği ve yol imleçle aynı biçimde", () => {
		const bolgeler = regionsOf(parse("> Alıntı içinde.\n"));
		expect(bolgeler[0]).toMatchObject({ blockIndex: 0, path: [0], kind: "inline" });
	});

	it("liste maddeleri ayrı bölgeler", () => {
		expect(regionsOf(parse("- bir\n- iki\n")).map((r) => r.text)).toEqual(["bir", "iki"]);
	});

	it("tablo hücre hücre taranıyor", () => {
		// Serileştirici artık yalnızca değişen satırı yeniden yazıyor; hücrede
		// bulunan eşleşme değiştirilebiliyor.
		const bolgeler = regionsOf(parse("| a | b |\n|---|---|\n| c | d |\n"));
		expect(bolgeler.map((r) => r.text)).toEqual(["a", "b", "c", "d"]);
		expect(bolgeler.map((r) => r.path)).toEqual([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1],
		]);
	});

	it("kod bloğu kaynak metin bölgesi", () => {
		const bolgeler = regionsOf(parse("```js\nconst x = 1;\n```\n"));
		expect(bolgeler).toHaveLength(1);
		// Değer satır sonuyla duruyor: ayrıştırıcı kod bloğunun kaynağını
		// olduğu gibi saklıyor.
		expect(bolgeler[0]).toMatchObject({ kind: "source", text: "const x = 1;\n" });
	});

	it("bağlantı tanımı taranmıyor", () => {
		// Değiştirilemediği için aranmıyor da (dosya başındaki gerekçe).
		expect(regionsOf(parse("[a]: https://ornek.com\n"))).toHaveLength(0);
	});

	it("biçimlendirme metne dahil, işaretler değil", () => {
		expect(regionsOf(parse("bu **kalın** metin\n"))[0]?.text).toBe("bu kalın metin");
	});

	it("görsel tek karakter (U+FFFC) ve atomik olarak işaretli", () => {
		// Editörün kuralı: görsel 1 karakter (`inline-edit.ts`, `offsets.ts`).
		const bolge = regionsOf(parse("a![alt](x.png)b\n"))[0];
		expect(bolge?.text).toBe(`a${String.fromCharCode(0xfffc)}b`);
		expect(bolge?.atomics).toEqual([1]);
	});

	it("satır sonu tek karakter", () => {
		// `offsets.ts` `<br>` için 1 sayıyor; ayrışırsak seçim kayar.
		expect(regionsOf(parse("a  \nb\n"))[0]?.text).toBe("a\nb");
	});
});

describe("findMatches — Türkçe kabul kriteri", () => {
	it("ışık araması IŞIK'ı buluyor", () => {
		expect(bul("IŞIK ve gölge\n", "ışık")).toEqual(["IŞIK"]);
	});

	it("IŞIK araması ışık'ı buluyor", () => {
		expect(bul("ışık ve gölge\n", "IŞIK")).toEqual(["ışık"]);
	});

	it("iyi ↔ İYİ eşleşiyor", () => {
		expect(bul("İYİ günler\n", "iyi")).toEqual(["İYİ"]);
		expect(bul("iyi günler\n", "İYİ")).toEqual(["iyi"]);
	});

	it("ışık araması İŞİK'i bulmuyor", () => {
		expect(bul("İŞİK diye bir kelime\n", "ışık")).toEqual([]);
	});

	it("locale İngilizce iken Türkçe çifti eşleşmiyor", () => {
		// Kuralın gerçekten locale'den geldiğini gösteriyor.
		expect(bul("IŞIK\n", "ışık", {}, "en")).toEqual([]);
	});
});

describe("findMatches", () => {
	it("boş sorgu hiçbir şey bulmuyor", () => {
		expect(bul("metin\n", "")).toEqual([]);
	});

	it("aynı paragraftaki bütün geçişleri buluyor", () => {
		expect(bul("kedi kedi kedi\n", "kedi")).toHaveLength(3);
	});

	it("eşleşmeler örtüşmüyor", () => {
		expect(bul("aaaa\n", "aa")).toHaveLength(2);
	});

	it("belge sırasını koruyor", () => {
		const doc = parse("# bir x\n\nparagraf x\n\n- madde x\n");
		const index = createIndex(doc, "tr");
		const matches = findMatches(index, "x");
		expect(matches.map((m) => m.regionIndex)).toEqual([0, 1, 2]);
	});

	it("duyarlı arama kasayı ayırt ediyor", () => {
		expect(bul("Kedi kedi\n", "kedi", { caseSensitive: true })).toEqual(["kedi"]);
	});

	it("tam kelime seçeneği ekleri dışlıyor", () => {
		expect(bul("kedi kediler\n", "kedi", { wholeWord: true })).toHaveLength(1);
	});

	it("tam kelime Türkçe harfte yanlış sınır üretmiyor", () => {
		expect(bul("şeker\n", "eker", { wholeWord: true })).toEqual([]);
	});

	it("kod bloğunun içinde de arıyor", () => {
		expect(bul("```js\nconst kedi = 1;\n```\n", "kedi")).toEqual(["kedi"]);
	});

	it("sınır aşılınca duruyor", () => {
		expect(bul("aaaaaa\n", "a", { limit: 3 })).toHaveLength(3);
	});

	it("uzayan katlamadan sonraki aralık kaymıyor", () => {
		// İngilizce locale'de "İ" iki kod birimine katlanıyor (i + nokta).
		// Eşleşme ondan **sonra** başlıyor; eşleme tablosu olmasaydı aralık
		// bir karakter kayar ve "tanbul" dönerdi.
		expect(bul("İstanbul\n", "stanbul", {}, "en")).toEqual(["stanbul"]);
	});
});

describe("gezinme", () => {
	const doc = parse("bir kedi\n\niki kedi\n\nüç kedi\n");
	const index = createIndex(doc, "tr");
	const matches = findMatches(index, "kedi");

	it("imleçten sonraki eşleşmeye gidiyor", () => {
		expect(nextFrom(matches, 0, 0)).toBe(0);
		expect(nextFrom(matches, 0, 5)).toBe(1);
		expect(nextFrom(matches, 1, 0)).toBe(1);
	});

	it("sonda başa sarıyor", () => {
		expect(nextFrom(matches, 2, 99)).toBe(0);
	});

	it("geri giderken sona sarıyor", () => {
		expect(previousFrom(matches, 0, 0)).toBe(2);
		expect(previousFrom(matches, 1, 8)).toBe(1);
	});

	it("eşleşme yoksa -1", () => {
		expect(nextFrom([], 0, 0)).toBe(-1);
		expect(previousFrom([], 0, 0)).toBe(-1);
	});
});

describe("değiştirme", () => {
	it("tek eşleşmeyi değiştiriyor", () => {
		expect(degistir("bir kedi var\n", "kedi", "köpek")).toBe("bir köpek var\n");
	});

	it("aynı paragraftaki bütün eşleşmeleri değiştiriyor", () => {
		expect(degistir("kedi kedi kedi\n", "kedi", "köpek")).toBe("köpek köpek köpek\n");
	});

	it("uzunluk değişse de sonraki eşleşmeler kaymıyor", () => {
		// Sondan başa gidilmesinin sebebi bu (bkz. `replace.ts`).
		expect(degistir("a a a\n", "a", "uzunbirkelime")).toBe(
			"uzunbirkelime uzunbirkelime uzunbirkelime\n",
		);
	});

	it("boş metinle değiştirmek siliyor", () => {
		expect(degistir("bir kedi var\n", "kedi ", "")).toBe("bir var\n");
	});

	it("başlıkta ve listede de çalışıyor", () => {
		expect(degistir("# kedi\n\n- kedi\n", "kedi", "köpek")).toBe("# köpek\n\n- köpek\n");
	});

	it("tabloda değiştiriyor, hizayı ve öteki satırları koruyor", () => {
		const md = "| Hayvan | Ses |\n| ------ | --- |\n| kedi   | miyav |\n| inek   | mö |\n";
		expect(degistir(md, "kedi", "fare")).toBe(
			"| Hayvan | Ses |\n| ------ | --- |\n| fare   | miyav |\n| inek   | mö |\n",
		);
	});

	it("kod bloğunda çalışıyor", () => {
		expect(degistir("```js\nconst kedi = 1;\n```\n", "kedi", "kopek")).toBe(
			"```js\nconst kopek = 1;\n```\n",
		);
	});

	it("biçimin tamamı eşleşince biçim korunuyor", () => {
		expect(degistir("bu **kedi** metni\n", "kedi", "köpek")).toBe("bu **köpek** metni\n");
	});

	it("biçim sınırını aşan eşleşme düz metne dönüyor", () => {
		// Bilinçli: iki farklı biçimden hangisinin kazanacağı keyfî olurdu.
		expect(degistir("**ka**lın\n", "kalın", "ince")).toBe("ince\n");
	});

	it("arama görselin üstünden geçmiyor, görsel silinmiyor", () => {
		// Kullanıcı arada bir görsel görüyor; "ab" orada yazmıyor.
		expect(degistir("a![alt](x.png)b\n", "ab", "c")).toBe("a![alt](x.png)b\n");
	});

	it("görselin yanındaki metin değiştiriliyor, görsel kalıyor", () => {
		expect(degistir("kedi![alt](x.png)kedi\n", "kedi", "köpek")).toBe("köpek![alt](x.png)köpek\n");
	});

	it("eşleşme yoksa belge değişmiyor", () => {
		const doc = parse("metin\n");
		const index = createIndex(doc, "tr");
		expect(replaceAll(doc, index.regions, [], "x")).toBeNull();
	});

	it("tek eşleşme değiştirince imleç metnin sonunda", () => {
		const doc = parse("bir kedi\n");
		const index = createIndex(doc, "tr");
		const [match] = findMatches(index, "kedi");
		const sonuc = replaceOne(doc, index.regions, match as never, "köpek");
		expect(sonuc?.caret).toEqual({ blockIndex: 0, path: [], offset: 4 + 5 });
	});

	it("belge nesnesi yeniden kullanılabiliyor (değişmezlik)", () => {
		const doc = parse("kedi\n");
		const index = createIndex(doc, "tr");
		replaceAll(doc, index.regions, findMatches(index, "kedi"), "köpek");
		expect(serialize(doc)).toBe("kedi\n");
	});
});

describe("100 sayfalık belge", () => {
	/**
	 * Kabul kriteri: "100 sayfalık dokümanda takılmadan çalışıyor."
	 *
	 * Sayfa ~500 kelime sayılıyor; 100 sayfa ≈ 50 000 kelime.
	 *
	 * ## Duvar saati eşiği nerede kaldı
	 *
	 * `createIndex` için "2.000 ms'den kısa" diye bir eşik vardı ve
	 * **payı yoktu**: bu makinede gerçek süre 1.405 ms, yani yalnızca
	 * 1,4×. Makinede paralel bir koşu varken (F6-09 sırasında iki kez
	 * oldu) eşik aşılıyordu — kodda hiçbir şey değişmeden.
	 *
	 * Eşiğin amacı zaten mutlak hız değil **büyüme biçimi**: doğrusal
	 * olmayan bir tarama buraya saniyeler getirirdi. Onu ölçmenin doğru
	 * yolu oran — iki ölçüm de aynı koşullarda alındığı için makinenin
	 * yükü ikisini birden büyütüyor ve oran sabit kalıyor.
	 *
	 * Aşağıdaki iki testin mutlak eşikleri duruyor, çünkü payları gerçek:
	 * ölçülen süreler 8 ms ve 6 ms, eşikler 1.000 ms ve 3.000 ms.
	 */
	const paragraf = `${"kelime ".repeat(100)}kedi\n\n`;
	const md = paragraf.repeat(500);
	const doc = parse(md);

	it("belge bölgelere ayrılıyor", () => {
		const index = createIndex(doc, "tr");
		expect(index.regions).toHaveLength(500);
		expect(index.regions[0]?.text).toContain("kedi");
	});

	it("indeksleme doğrusal büyüyor", () => {
		/*
		 * Dört kat belge, dört kat süre beklenir. Eşik 8× — karesel bir
		 * tarama 16× getirirdi, yani aradaki fark testin yakalayabileceği
		 * kadar geniş. Ölçülen: 4,8×.
		 */
		const sure = (n: number): number => {
			const d = parse(paragraf.repeat(n));
			const bas = performance.now();
			createIndex(d, "tr");
			return performance.now() - bas;
		};

		const kucuk = Math.max(sure(250), 1);
		const buyuk = sure(1000);
		expect(buyuk / kucuk).toBeLessThan(8);
		/*
		 * Süre sınırı geniş: `test:cov` altında eklenti kaynaktan ölçümle
		 * koşuyor ve 1.250 sayfalık iki ayrıştırma vitest'in 5 sn
		 * varsayılanını aşabiliyor. Asıl denetim yukarıdaki oran.
		 */
	}, 30_000);

	it("her tuş vuruşunda yeniden tarama hızlı", () => {
		const index = createIndex(doc, "tr");
		const bas = performance.now();
		for (const sorgu of ["k", "ke", "ked", "kedi"]) findMatches(index, sorgu);
		// Dört tarama: kullanıcının "kedi" yazması.
		expect(performance.now() - bas).toBeLessThan(1000);
	});

	it("tümünü değiştir tek geçişte bitiyor", () => {
		const index = createIndex(doc, "tr");
		const matches = findMatches(index, "kedi");
		expect(matches).toHaveLength(500);
		const bas = performance.now();
		const sonuc = replaceAll(doc, index.regions, matches, "köpek");
		expect(sonuc).not.toBeNull();
		expect(performance.now() - bas).toBeLessThan(3000);
	});
});

describe("genişletilmiş mod", () => {
	it("kaçışları çözüyor", () => {
		expect(unescapeExtended("a\\tb\\nc\\x41\\u00e7\\\\d\\q")).toBe("a\tb\nc" + "A" + "ç\\dq");
	});

	it("paragraf içindeki satır sonunu \\n ile buluyor", () => {
		expect(bul("bir\\\niki\n", "bir\\niki", { mode: "extended" })).toEqual(["bir\niki"]);
		// Normal modda aynı sorgu düz metin.
		expect(bul("bir\\\niki\n", "bir\\niki")).toEqual([]);
	});

	it("değiştirmedeki \\n satır sonu oluyor", () => {
		expect(degistir("bir, iki\n", ", ", "\\n", { mode: "extended" })).toBe("bir\\\niki\n");
	});
});

describe("düzenli ifade modu", () => {
	it("deseni buluyor", () => {
		expect(bul("a1 b22 c333\n", "\\d+", { mode: "regex" })).toEqual(["1", "22", "333"]);
	});

	it("varsayılan olarak büyük/küçük harfe duyarsız, istenince duyarlı", () => {
		expect(bul("Kedi kedi\n", "kedi", { mode: "regex" })).toEqual(["Kedi", "kedi"]);
		expect(bul("Kedi kedi\n", "kedi", { mode: "regex", caseSensitive: true })).toEqual(["kedi"]);
	});

	it("^ ve $ her paragrafta", () => {
		expect(bul("bir iki\n\nüç dört\n", "^\\S+", { mode: "regex" })).toEqual(["bir", "üç"]);
	});

	it("boş eşleşmede takılmıyor", () => {
		expect(bul("abc\n", "x*", { mode: "regex" })).toEqual([]);
	});

	it("tam kelime seçeneği desene de uygulanıyor", () => {
		expect(bul("kedi kediler\n", "kedi\\w*", { mode: "regex", wholeWord: true })).toEqual([
			"kedi",
			"kediler",
		]);
		expect(bul("kedi kediler\n", "kedi", { mode: "regex", wholeWord: true })).toEqual(["kedi"]);
	});

	it("geçersiz desende hata fırlatıyor", () => {
		expect(() => bul("a\n", "(a", { mode: "regex" })).toThrow(SyntaxError);
	});

	it("gruplarla değiştiriyor", () => {
		expect(degistir("Ad: Ali, Soyad: Veli\n", "(\\w+): (\\w+)", "$2=$1", { mode: "regex" })).toBe(
			"Ali=Ad, Veli=Soyad\n",
		);
		expect(
			degistir("2026-10-06\n", "(?<y>\\d+)-(?<a>\\d+)-(?<g>\\d+)", "$<g>.$<a>.$<y>", {
				mode: "regex",
			}),
		).toBe("06.10.2026\n");
	});

	it("geriye bakan desen eşleşmenin solunu görüyor", () => {
		expect(
			degistir("fiyat: 10 TL, adet: 10\n", "(?<=fiyat: )\\d+", "($&)", { mode: "regex" }),
		).toBe("fiyat: (10) TL, adet: 10\n");
	});

	it("biçimi koruyor ve görseli silmiyor", () => {
		expect(degistir("**kedi** ![g](g.png) kedi\n", "k(e)di", "k$1$1di", { mode: "regex" })).toBe(
			"**keedi** ![g](g.png) keedi\n",
		);
	});
});
