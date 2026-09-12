import { describe, expect, it } from "vitest";
import { consumeIndent, indentWidth, isBlank, scan, stripIndent } from "./scanner.js";

/** Testleri okunur kılmak için: satırların yalnızca içeriği. */
const degerler = (kaynak: string): string[] => scan(kaynak).lines.map((l) => l.value);

describe("scan — satırlara bölme", () => {
	it("LF ile bölüyor", () => {
		expect(degerler("bir\niki\nüç")).toEqual(["bir", "iki", "üç"]);
	});

	it("CRLF ile bölüyor ve \\r'yi içeriğe katmıyor", () => {
		expect(degerler("bir\r\niki")).toEqual(["bir", "iki"]);
	});

	it("tek başına CR'yi de satır sonu sayıyor", () => {
		expect(degerler("bir\riki")).toEqual(["bir", "iki"]);
	});

	it("karışık satır sonlarını doğru bölüyor", () => {
		expect(degerler("a\nb\r\nc\rd")).toEqual(["a", "b", "c", "d"]);
	});

	it("boş kaynak tek boş satır veriyor", () => {
		expect(degerler("")).toEqual([""]);
	});

	it("satır sonuyla biten dosyada sonda fazladan satır üretmiyor", () => {
		expect(degerler("bir\niki\n")).toEqual(["bir", "iki"]);
	});

	it("ardışık boş satırları koruyor", () => {
		expect(degerler("a\n\n\nb")).toEqual(["a", "", "", "b"]);
	});

	it("satır numaraları 1 tabanlı ve artıyor", () => {
		expect(scan("a\nb\nc").lines.map((l) => l.line)).toEqual([1, 2, 3]);
	});
});

/**
 * Ofsetler `position` bilgisinin kaynağı — gidiş-dönüş sadakati (F1-07) ve
 * editörün kaynak eşlemesi buna dayanacak. Yanlış ofset sessizce yanlış
 * `position` demek.
 */
describe("scan — ofsetler", () => {
	it("LF'te start/end kaynağı birebir kesiyor", () => {
		const kaynak = "bir\niki";
		for (const satir of scan(kaynak).lines) {
			expect(kaynak.slice(satir.start, satir.end)).toBe(satir.value);
		}
	});

	it("CRLF'te de kaynağı birebir kesiyor", () => {
		const kaynak = "bir\r\niki\r\n";
		for (const satir of scan(kaynak).lines) {
			expect(kaynak.slice(satir.start, satir.end)).toBe(satir.value);
		}
	});

	it("her satırın kendi satır sonunu kaydediyor", () => {
		expect(scan("a\nb\r\nc\rd").lines.map((l) => l.ending)).toEqual(["\n", "\r\n", "\r", ""]);
	});

	it("Türkçe karakterlerde ofset kayması olmuyor", () => {
		const kaynak = "Işık ışıldıyor\nĞÜŞÇÖİ";
		const satirlar = scan(kaynak).lines;
		expect(kaynak.slice(satirlar[0]?.start, satirlar[0]?.end)).toBe("Işık ışıldıyor");
		expect(kaynak.slice(satirlar[1]?.start, satirlar[1]?.end)).toBe("ĞÜŞÇÖİ");
	});
});

describe("scan — belge düzeyi yazım bilgisi", () => {
	it("baskın satır sonunu buluyor", () => {
		expect(scan("a\nb\nc").lineEnding).toBe("\n");
		expect(scan("a\r\nb\r\nc").lineEnding).toBe("\r\n");
		expect(scan("a\rb\rc").lineEnding).toBe("\r");
	});

	it("karışık dosyada çoğunluk kazanıyor", () => {
		expect(scan("a\r\nb\r\nc\nd").lineEnding).toBe("\r\n");
	});

	it("hiç satır sonu yoksa LF varsayıyor", () => {
		expect(scan("tek satır").lineEnding).toBe("\n");
	});

	it("finalNewline'ı doğru tespit ediyor", () => {
		expect(scan("a\n").finalNewline).toBe(true);
		expect(scan("a\r\n").finalNewline).toBe(true);
		expect(scan("a").finalNewline).toBe(false);
		expect(scan("").finalNewline).toBe(false);
	});
});

/**
 * BOM ve NUL, CommonMark'ın zorunlu kıldığı iki normalleştirme. BOM
 * kaydediliyor (serileştirici geri koyabilsin), NUL ise kayıp — belgelenmiş
 * tek gerçek gidiş-dönüş istisnası.
 */
describe("scan — BOM ve NUL", () => {
	it("baştaki BOM'u atıyor ama kaydediyor", () => {
		const sonuc = scan("﻿# Başlık");
		expect(sonuc.bom).toBe(true);
		expect(sonuc.lines[0]?.value).toBe("# Başlık");
	});

	it("BOM yoksa bayrağı kapalı", () => {
		expect(scan("# Başlık").bom).toBe(false);
	});

	it("ortadaki BOM'a dokunmuyor", () => {
		// Yalnızca dosyanın başındaki BOM anlamlıdır.
		expect(scan("a﻿b").lines[0]?.value).toBe("a﻿b");
	});

	it("NUL karakterini U+FFFD ile değiştiriyor", () => {
		expect(scan("a\0b").lines[0]?.value).toBe("a\ufffdb");
	});
});

/**
 * Sekme genişletme CommonMark'ın en sinsi ayrıntısı: sekme bir karakter değil,
 * bir sonraki 4'ün katına kadar olan boşluk. Bu testler o kuralı sabitliyor.
 */
describe("indentWidth", () => {
	it("boşlukları sayıyor", () => {
		expect(indentWidth("x")).toBe(0);
		expect(indentWidth("   x")).toBe(3);
		expect(indentWidth("    x")).toBe(4);
	});

	it("sekmeyi bir sonraki 4'ün katına taşıyor", () => {
		expect(indentWidth("\tx")).toBe(4);
		expect(indentWidth(" \tx")).toBe(4);
		expect(indentWidth("  \tx")).toBe(4);
		expect(indentWidth("   \tx")).toBe(4);
		expect(indentWidth("    \tx")).toBe(8);
	});

	it("karışık boşluk ve sekmeyi doğru sayıyor", () => {
		expect(indentWidth("\t x")).toBe(5);
		expect(indentWidth(" \t x")).toBe(5);
		expect(indentWidth("\t\tx")).toBe(8);
	});

	it("içerikten sonraki boşluğu saymıyor", () => {
		expect(indentWidth("  a  b")).toBe(2);
	});

	it("tamamen boşluktan oluşan satırın tümünü sayıyor", () => {
		expect(indentWidth("   ")).toBe(3);
		expect(indentWidth("\t")).toBe(4);
	});
});

describe("consumeIndent", () => {
	it("istenen kadar boşluk tüketiyor", () => {
		expect(consumeIndent("    metin", 2)).toEqual({ rest: "  metin", consumed: 2 });
		expect(consumeIndent("    metin", 4)).toEqual({ rest: "metin", consumed: 4 });
	});

	it("sıfır ya da negatif istekte hiçbir şey tüketmiyor", () => {
		expect(consumeIndent("  x", 0)).toEqual({ rest: "  x", consumed: 0 });
		expect(consumeIndent("  x", -1)).toEqual({ rest: "  x", consumed: 0 });
	});

	it("yeterli girinti yoksa olanı tüketiyor", () => {
		expect(consumeIndent("  metin", 8)).toEqual({ rest: "metin", consumed: 2 });
	});

	/**
	 * CommonMark'ın kuralı: sekmenin ortasında durmak gerekirse aşan kısım
	 * boşluğa çevrilir. İç içe listelerde sürekli devreye girer.
	 */
	it("sekmenin ortasında durunca kalanı boşluğa çeviriyor", () => {
		expect(consumeIndent("\tmetin", 2)).toEqual({ rest: "  metin", consumed: 2 });
		expect(consumeIndent("\tmetin", 1)).toEqual({ rest: "   metin", consumed: 1 });
		expect(consumeIndent("\tmetin", 3)).toEqual({ rest: " metin", consumed: 3 });
	});

	it("sekmeyi tam sınırında tüketiyor", () => {
		expect(consumeIndent("\tmetin", 4)).toEqual({ rest: "metin", consumed: 4 });
	});

	it("kısmi sekmeden sonra kalan girintiyi koruyor", () => {
		expect(consumeIndent("\t\tmetin", 2)).toEqual({ rest: "  \tmetin", consumed: 2 });
	});

	it("girintisi olmayan satıra dokunmuyor", () => {
		expect(consumeIndent("metin", 4)).toEqual({ rest: "metin", consumed: 0 });
	});
});

describe("stripIndent", () => {
	it("bütün girintiyi atıyor", () => {
		expect(stripIndent("    metin")).toEqual({ rest: "metin", consumed: 4 });
		expect(stripIndent("\t metin")).toEqual({ rest: "metin", consumed: 5 });
	});

	it("girintisiz satırı olduğu gibi bırakıyor", () => {
		expect(stripIndent("metin")).toEqual({ rest: "metin", consumed: 0 });
	});

	it("tamamen boşluk olan satırı boşaltıyor", () => {
		expect(stripIndent("   ")).toEqual({ rest: "", consumed: 3 });
	});
});

describe("isBlank", () => {
	it("boş ve yalnızca boşluklu satırlar için true", () => {
		expect(isBlank("")).toBe(true);
		expect(isBlank("   ")).toBe(true);
		expect(isBlank("\t")).toBe(true);
		expect(isBlank(" \t ")).toBe(true);
	});

	it("içerikli satırlar için false", () => {
		expect(isBlank("x")).toBe(false);
		expect(isBlank("   x")).toBe(false);
		expect(isBlank("  x  ")).toBe(false);
	});

	it("boşluk benzeri ama boşluk olmayan karakterleri boş saymıyor", () => {
		// U+00A0 kırılmaz boşluk CommonMark'ta boşluk değildir.
		expect(isBlank(" ")).toBe(false);
	});
});
