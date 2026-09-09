/**
 * Yapıştırma boru hattı  (İş listesi: F3-07)
 *
 * Kaynak tespiti, Markdown sezgisi ve parçanın belgeye yerleşmesi burada
 * saf olarak sınanıyor. Tarayıcı testleri yalnızca `paste` olayının buraya
 * doğru bağlandığını doğruluyor.
 */
import { parse, serialize } from "@kalem/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Caret } from "./block-edit.js";
import { assignIds, resetIds } from "./ids.js";
import { detectPasteSource, insertFragment, looksLikeMarkdown, pasteFragment } from "./paste.js";

beforeEach(() => {
	resetIds();
});

const belge = (markdown: string) => assignIds(parse(markdown));
const imlec = (blockIndex: number, offset: number): Caret => ({ blockIndex, path: [], offset });

/** HTML metnini gerçek DOM olmadan ayrıştıramıyoruz; testler onu vermiyor. */
const domYok = () => null;

describe("kaynak tespiti", () => {
	it("Word ad alanını tanıyor", () => {
		const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><p>a</p></html>';
		expect(detectPasteSource({ html, text: "a" })).toBe("word");
	});

	it("Mso sınıfını tanıyor", () => {
		expect(detectPasteSource({ html: '<p class="MsoNormal">a</p>', text: "a" })).toBe("word");
	});

	it("mso- stilini tanıyor", () => {
		expect(detectPasteSource({ html: "<p style='mso-list:l0'>a</p>", text: "a" })).toBe("word");
	});

	it("Google Docs kimliğini tanıyor", () => {
		const html = '<b id="docs-internal-guid-abc"><p>a</p></b>';
		expect(detectPasteSource({ html, text: "a" })).toBe("gdocs");
	});

	it("sıradan HTML html sayılıyor", () => {
		expect(detectPasteSource({ html: "<p>a</p>", text: "a" })).toBe("html");
	});

	it("HTML yoksa metnin kendisine bakılıyor", () => {
		expect(detectPasteSource({ html: "", text: "# Başlık" })).toBe("markdown");
		expect(detectPasteSource({ html: "", text: "sadece metin" })).toBe("text");
	});
});

describe("Markdown sezgisi", () => {
	it.each([
		["# Başlık", "başlık"],
		["- madde", "madde imli liste"],
		["1. madde", "numaralı liste"],
		["> alıntı", "alıntı"],
		["```js\nkod\n```", "kod çiti"],
		["---", "yatay çizgi"],
		["[bağ](https://a.com)", "bağlantı"],
		["`kod`", "satır içi kod"],
	])("%s → Markdown", (metin) => {
		expect(looksLikeMarkdown(metin)).toBe(true);
	});

	/**
	 * Satır içi `*` ve `_` bilerek dışarıda: kullanıcının çarpım işaretini
	 * ya da dosya adını bozmak, kazanılan kolaylıktan pahalı.
	 */
	it.each([
		["2 * 3 * 4", "çarpım"],
		["dosya_adi_burada", "alt çizgili ad"],
		["Sıradan bir cümle.", "düz cümle"],
		["", "boş"],
	])("%s → Markdown değil", (metin) => {
		expect(looksLikeMarkdown(metin)).toBe(false);
	});
});

describe("parça üretimi", () => {
	it("Markdown metni ayrıştırılıyor", () => {
		const parca = pasteFragment({ html: "", text: "# Başlık\n\nmetin\n" }, domYok);
		expect(serialize(parca)).toBe("# Başlık\n\nmetin\n");
	});

	it("düz metin paragraflara bölünüyor", () => {
		const parca = pasteFragment({ html: "", text: "bir\n\niki" }, domYok);
		expect(serialize(parca)).toBe("bir\n\niki\n");
	});

	/** E-postadan kopyalanan metin satır yapısını korumalı. */
	it("tek satır sonu sert satır sonu oluyor", () => {
		const parca = pasteFragment({ html: "", text: "bir\niki" }, domYok);
		expect(serialize(parca)).toBe("bir\\\niki\n");
	});

	it("plainOnly Markdown'ı ayrıştırmıyor", () => {
		const parca = pasteFragment({ html: "", text: "# Başlık" }, domYok, { plainOnly: true });
		// `\#` kaçışı doğru: metin **başlık değil**, başına diyez konmuş bir
		// cümle. Serileştirici onu yeniden okunduğunda başlığa dönüşmeyecek
		// biçimde yazmak zorunda.
		expect(serialize(parca)).toBe("\\# Başlık\n");
	});

	it("parseMarkdown kapatılabiliyor", () => {
		const parca = pasteFragment({ html: "", text: "# Başlık" }, domYok, {
			parseMarkdown: false,
		});
		// `\#` kaçışı doğru: metin **başlık değil**, başına diyez konmuş bir
		// cümle. Serileştirici onu yeniden okunduğunda başlığa dönüşmeyecek
		// biçimde yazmak zorunda.
		expect(serialize(parca)).toBe("\\# Başlık\n");
	});

	/** HTML ayrıştırılamazsa metin kaybolmamalı. */
	it("HTML çözülemezse metne düşülüyor", () => {
		const parca = pasteFragment({ html: "<p>a</p>", text: "a" }, domYok);
		expect(serialize(parca)).toBe("a\n");
	});

	it("hiçbir şey yoksa boş parça", () => {
		expect(pasteFragment({ html: "", text: "" }, domYok).children).toHaveLength(0);
	});
});

describe("belgeye yerleştirme", () => {
	const md = (sonuc: ReturnType<typeof insertFragment>) =>
		sonuc === null ? "<null>" : serialize(sonuc.doc);

	/** Cümlenin ortasına yapıştıran kullanıcı yeni paragraf istemiyor. */
	it("tek paragraf satır içi ekleniyor", () => {
		const sonuc = insertFragment(belge("abcd\n"), imlec(0, 2), parse("XY"));
		expect(md(sonuc)).toBe("abXYcd\n");
		expect(sonuc?.caret.offset).toBe(4);
	});

	it("satır içi ekleme biçimi koruyor", () => {
		expect(md(insertFragment(belge("abcd\n"), imlec(0, 2), parse("**XY**")))).toBe("ab**XY**cd\n");
	});

	it("çok bloklu parça bloğu bölüyor", () => {
		expect(md(insertFragment(belge("abcd\n"), imlec(0, 2), parse("bir\n\niki\n")))).toBe(
			"abbir\n\nikicd\n",
		);
	});

	it("başlık içeren parça yapıyı koruyor", () => {
		expect(md(insertFragment(belge("son\n"), imlec(0, 0), parse("# Baş\n\nmetin\n")))).toBe(
			"# Baş\n\nmetinson\n",
		);
	});

	/** Liste satır içine kaynayamaz; kendi bloğu olarak giriyor. */
	it("liste parçası blok olarak giriyor", () => {
		expect(md(insertFragment(belge("abcd\n"), imlec(0, 2), parse("- bir\n- iki\n")))).toBe(
			"ab\n\n- bir\n- iki\n\ncd\n",
		);
	});

	it("metin taşımayan bloğa yapıştırma araya giriyor", () => {
		expect(md(insertFragment(belge("---\n"), imlec(0, 0), parse("yeni")))).toBe("---\n\nyeni\n");
	});

	it("boş parça reddediliyor", () => {
		expect(insertFragment(belge("abcd\n"), imlec(0, 2), { type: "root", children: [] })).toBeNull();
	});

	/** Yapıştırılan bloğun kaynak belgedeki satır numarası bu belgede yalan. */
	it("yapıştırılan blokların konumu düşürülüyor", () => {
		const sonuc = insertFragment(belge("abcd\n"), imlec(0, 4), parse("bir\n\niki\n"));
		for (const blok of sonuc?.doc.children ?? []) {
			expect((blok as { position?: unknown }).position).toBeUndefined();
		}
	});
});
