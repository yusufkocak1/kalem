import { describe, expect, it } from "vitest";
import type { Link, List, ListItem, Table, TableRow } from "./ast.js";
import { parseInline } from "./inline.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

const bloklar = (md: string) => parse(md).children;
const tipler = (md: string) => bloklar(md).map((b) => b.type);
const tek = (md: string) => bloklar(md)[0];

function ozet(node: unknown): string {
	const n = node as { type: string; children?: unknown[]; value?: string };
	if (n.children !== undefined) return `${n.type}[${n.children.map(ozet).join(", ")}]`;
	return n.value === undefined ? n.type : `${n.type}(${n.value})`;
}

// ---------------------------------------------------------------------------

describe("görev listesi", () => {
	it("işaretsiz görev", () => {
		const item = (tek("- [ ] yapılacak") as List).children[0] as ListItem;
		expect(item.checked).toBe(false);
		expect(ozet(item)).toBe("listItem[paragraph[text(yapılacak)]]");
	});

	it("işaretli görev", () => {
		expect(((tek("- [x] bitti") as List).children[0] as ListItem).checked).toBe(true);
	});

	it("büyük X de işaretli", () => {
		expect(((tek("- [X] bitti") as List).children[0] as ListItem).checked).toBe(true);
	});

	/** Görev olmayan maddede `checked` null kalmalı — false değil. */
	it("normal madde görev değil", () => {
		expect(((tek("- normal") as List).children[0] as ListItem).checked).toBeNull();
	});

	it("sıralı listede de görev olabiliyor", () => {
		expect(((tek("1. [x] bitti") as List).children[0] as ListItem).checked).toBe(true);
	});

	it("karışık liste", () => {
		const l = tek("- [ ] bir\n- [x] iki\n- üç") as List;
		expect((l.children as ListItem[]).map((i) => i.checked)).toEqual([false, true, null]);
	});

	/**
	 * İşaretten sonra boşluk şart: `- [x]bitti` görev değil.
	 *
	 * İçerik o zaman sıradan satır içi ayrıştırmaya girer ve `[x]` bir
	 * **kısayol bağlantı başvurusu** olur — CommonMark'ın doğru davranışı.
	 */
	it("boşluksuz işaret görev değil", () => {
		const item = (tek("- [x]bitti") as List).children[0] as ListItem;
		expect(item.checked).toBeNull();
		expect(ozet(item)).toBe("listItem[paragraph[linkReference[text(x)], text(bitti)]]");
	});
});

// ---------------------------------------------------------------------------

describe("tablo", () => {
	const basit = "| a | b |\n| --- | --- |\n| 1 | 2 |";

	it("başlık ve gövdeyi ayrıştırıyor", () => {
		const t = tek(basit) as Table;
		expect(t.type).toBe("table");
		expect(t.children).toHaveLength(2);
		expect(ozet(t.children[0])).toBe("tableRow[tableCell[text(a)], tableCell[text(b)]]");
	});

	it("hücrelerde satır içi ayrıştırma çalışıyor", () => {
		const t = tek("| a | b |\n| --- | --- |\n| *x* | `y` |") as Table;
		expect(ozet(t.children[1])).toBe(
			"tableRow[tableCell[emphasis[text(x)]], tableCell[inlineCode(y)]]",
		);
	});

	it("hizalamaları okuyor", () => {
		const t = tek("| a | b | c | d |\n| :-- | --: | :-: | --- |\n| 1 | 2 | 3 | 4 |") as Table;
		expect(t.align).toEqual(["left", "right", "center", null]);
	});

	it("kenar boruları isteğe bağlı", () => {
		expect(tipler("a | b\n--- | ---\n1 | 2")).toEqual(["table"]);
	});

	it("eksik hücreleri boşla tamamlıyor", () => {
		const t = tek("| a | b |\n| --- | --- |\n| 1 |") as Table;
		expect((t.children[1] as TableRow).children).toHaveLength(2);
	});

	it("fazla hücreyi atıyor", () => {
		const t = tek("| a | b |\n| --- | --- |\n| 1 | 2 | 3 |") as Table;
		expect((t.children[1] as TableRow).children).toHaveLength(2);
	});

	it("kaçırılan boru hücre ayracı değil", () => {
		const t = tek("| a | b |\n| --- | --- |\n| x \\| y | z |") as Table;
		expect(ozet((t.children[1] as TableRow).children[0])).toBe("tableCell[text(x | y)]");
	});

	/**
	 * Tabloyu tablo yapan ayraç satırıdır. Ayraç yoksa boru içeren satır
	 * sıradan bir paragraftır — aksi hâlde `a | b` yazan herkesin metni
	 * tabloya dönerdi.
	 */
	it("ayraç satırı yoksa tablo değil", () => {
		expect(tipler("| a | b |\n| 1 | 2 |")).toEqual(["paragraph"]);
	});

	it("hücre sayısı uyuşmuyorsa tablo değil", () => {
		expect(tipler("| a | b |\n| --- |\n| 1 | 2 |")).toEqual(["paragraph"]);
	});

	it("boş satırda bitiyor", () => {
		expect(tipler(`${basit}\n\nparagraf`)).toEqual(["table", "paragraph"]);
	});

	/**
	 * v1'de tablo düzenleme arayüzü yok (Karar #5) ama dosya bozulmamalı:
	 * ham metin `syntax.raw` içinde saklanıyor.
	 */
	it("ham metni kayıpsız saklıyor", () => {
		expect((tek(basit) as Table).syntax?.raw).toBe(basit);
	});

	it("Türkçe içerikli tablo", () => {
		const t = tek("| Şehir | Nüfus |\n| --- | --- |\n| İstanbul | 15M |") as Table;
		expect(ozet(t.children[1])).toBe("tableRow[tableCell[text(İstanbul)], tableCell[text(15M)]]");
	});
});

// ---------------------------------------------------------------------------

describe("otomatik bağlantı literali", () => {
	/** Metindeki ilk bağlantı düğümü — konumu girdiden girdiye değişiyor. */
	const ilk = (raw: string) => parseInline(raw).find((n) => n.type === "link") as Link;

	it("çıplak https URL", () => {
		const l = ilk("https://ornek.com");
		expect(l.type).toBe("link");
		expect(l.url).toBe("https://ornek.com");
		expect(l.syntax).toEqual({ style: "literal" });
	});

	it("www öneki http ile tamamlanıyor", () => {
		const l = ilk("www.ornek.com");
		expect(l.url).toBe("http://www.ornek.com");
		expect(ozet(l)).toBe("link[text(www.ornek.com)]");
	});

	it("çıplak e-posta", () => {
		expect(ilk("posta@ornek.com").url).toBe("mailto:posta@ornek.com");
	});

	it("metin içinde", () => {
		expect(parseInline("bak https://a.com şuna").map(ozet)).toEqual([
			"text(bak )",
			"link[text(https://a.com)]",
			"text( şuna)",
		]);
	});

	/** Cümle sonundaki nokta URL'ye ait değildir. */
	it("sondaki noktalamayı kırpıyor", () => {
		expect(parseInline("bak https://a.com.").map(ozet)).toEqual([
			"text(bak )",
			"link[text(https://a.com)]",
			"text(.)",
		]);
	});

	it("dengesiz kapanış parantezini kırpıyor", () => {
		expect(ilk("(https://a.com/b)").url).toBe("https://a.com/b");
	});

	it("dengeli parantezi koruyor", () => {
		expect(ilk("https://a.com/b_(c)").url).toBe("https://a.com/b_(c)");
	});

	/** Kelime ortasından bağlantı çıkmamalı. */
	it("kelime ortasında bağlantı açmıyor", () => {
		expect(parseInline("bahttps://a.com").map(ozet)).toEqual(["text(bahttps://a.com)"]);
	});

	it("açılı ayraçlı autolink literal değil", () => {
		expect(ilk("<https://a.com>").syntax).toEqual({ style: "autolink" });
	});

	it("satır içi bağlantının hedefi literal olmuyor", () => {
		expect(parseInline("[a](https://b.com)").map(ozet)).toEqual(["link[text(a)]"]);
	});
});

describe("çok satırlı tablo hücresi", () => {
	const tablo = (hucre: string) => `| a | b |\n| --- | --- |\n| ${hucre} | z |\n`;

	it("hücredeki <br> satır sonu oluyor", () => {
		const t = tek(tablo("bir<br>iki<br/>üç")) as Table;
		expect(ozet(t.children[1]?.children[0])).toBe(
			"tableCell[text(bir), break, text(iki), break, text(üç)]",
		);
	});

	it("biçimin içindeki <br> de satır sonu", () => {
		const t = tek(tablo("**bir<br>iki**")) as Table;
		expect(ozet(t.children[1]?.children[0])).toBe("tableCell[strong[text(bir), break, text(iki)]]");
	});

	it("hücre dışındaki <br> ham HTML olarak kalıyor", () => {
		expect(ozet(tek("bir<br>iki\n"))).toBe("paragraph[text(bir), html(<br>), text(iki)]");
	});

	it("<br> yazılışı gidiş-dönüşte korunuyor", () => {
		const md = tablo("bir<br/>iki<BR>üç");
		expect(serialize(parse(md))).toBe(md);
	});

	it("yeni satır sonu hücreyi bölmeden <br> olarak yazılıyor", () => {
		const doc = parse(tablo("x"));
		const t = doc.children[0] as Table;
		const satir = t.children[1] as TableRow;
		const hucre = satir.children[0];
		if (hucre === undefined) throw new Error("hücre yok");
		hucre.children = [
			{ type: "text", value: "bir" },
			{ type: "break", syntax: { marker: "backslash" } },
			{ type: "text", value: "iki" },
		];
		const yazilan = serialize(doc);
		expect(yazilan).toContain("| bir<br>iki |");
		expect(ozet((parse(yazilan).children[0] as Table).children[1]?.children[0])).toBe(
			"tableCell[text(bir), break, text(iki)]",
		);
	});
});
