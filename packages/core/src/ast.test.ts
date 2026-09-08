import { describe, expect, it } from "vitest";
import type {
	Block,
	Code,
	Heading,
	Image,
	Inline,
	Link,
	List,
	ListItem,
	Node,
	NodeOf,
	Paragraph,
	Root,
	Table,
	Text,
} from "./ast.js";
import * as ast from "./ast.js";

/**
 * `ast.ts` **yalnızca tip içermeli.** Kabul kriteri: "tipler core/src/ast.ts'te,
 * sıfır runtime kodu" (F1-01).
 *
 * Biri dosyaya bir `const` ya da fonksiyon eklerse modül artık boş olmaz ve
 * bu test kırılır. Tip dosyasının runtime maliyeti sıfır kalmalı — boyut
 * bütçesinin (12 kB) en ucuz parçası burası.
 */
describe("ast.ts sıfır runtime", () => {
	it("derlendiğinde hiçbir değer dışa aktarmaz", () => {
		expect(Object.keys(ast)).toHaveLength(0);
	});
});

/**
 * Aşağıdaki testlerin gövdesi neredeyse boş — asıl iddia **derleme zamanında**.
 * Tip hatası olursa `pnpm typecheck` kırılır; testler bu dosyanın gerçekten
 * derlendiğini garantiler.
 */
describe("düğüm biçimleri", () => {
	it("tipik bir belge ağacı kurulabiliyor", () => {
		const belge: Root = {
			type: "root",
			syntax: { lineEnding: "\n", finalNewline: true, bom: false },
			children: [
				{ type: "yaml", value: "baslik: Deneme" },
				{
					type: "heading",
					depth: 1,
					children: [{ type: "text", value: "Işıklı Başlık" }],
					syntax: { style: "atx" },
				},
				{
					type: "list",
					ordered: false,
					start: null,
					spread: false,
					syntax: { marker: "-" },
					children: [
						{
							type: "listItem",
							checked: null,
							spread: false,
							children: [{ type: "paragraph", children: [{ type: "text", value: "madde" }] }],
						},
					],
				},
			],
		};

		expect(belge.children).toHaveLength(3);
	});

	it("görev listesi maddesi `checked` taşıyor", () => {
		const madde: ListItem = {
			type: "listItem",
			checked: true,
			spread: false,
			children: [],
		};
		expect(madde.checked).toBe(true);
	});

	it("sıralı liste başlangıç ve ayraç tercihini taşıyor", () => {
		const liste: List = {
			type: "list",
			ordered: true,
			start: 3,
			spread: false,
			syntax: { delimiter: ")", numbering: "incrementing" },
			children: [],
		};
		expect(liste.start).toBe(3);
		expect(liste.syntax?.delimiter).toBe(")");
	});
});

/**
 * Yazım tercihleri gidiş-dönüş sadakatinin (F1-07) önkoşulu. Bu testler
 * "aynı anlamı taşıyan iki farklı yazılış" durumlarının modellenebildiğini
 * gösterir — serileştirici bu bilgi olmadan kullanıcının dosyasını değiştirir.
 */
describe("yazım tercihleri", () => {
	it("aynı başlık iki farklı yazılışla temsil edilebiliyor", () => {
		const atx: Heading = {
			type: "heading",
			depth: 2,
			children: [{ type: "text", value: "Başlık" }],
			syntax: { style: "atx", closed: false },
		};
		const setext: Heading = {
			type: "heading",
			depth: 2,
			children: [{ type: "text", value: "Başlık" }],
			syntax: { style: "setext", underline: "-" },
		};

		// Anlam aynı, yazılış farklı.
		expect(atx.depth).toBe(setext.depth);
		expect(atx.syntax?.style).not.toBe(setext.syntax?.style);
	});

	it("kod bloğu çit karakterini ve uzunluğunu koruyor", () => {
		const cit: Code = {
			type: "code",
			lang: "ts",
			meta: null,
			value: "const a = 1;",
			syntax: { style: "fenced", fence: "~", fenceLength: 4 },
		};
		const girintili: Code = {
			type: "code",
			lang: null,
			meta: null,
			value: "const a = 1;",
			syntax: { style: "indented" },
		};

		expect(cit.syntax?.fence).toBe("~");
		expect(girintili.syntax?.fence).toBeUndefined();
	});

	it("yatay çizgi ham yazılışını koruyor", () => {
		const cizgi: Block = { type: "thematicBreak", syntax: { raw: "* * *" } };
		expect(cizgi.type).toBe("thematicBreak");
	});

	it("bağlantı satır içi / autolink / GFM literal ayrımını taşıyor", () => {
		const stiller: Link["syntax"][] = [
			{ style: "inline", titleDelimiter: '"' },
			{ style: "autolink" },
			{ style: "literal" },
		];
		expect(stiller).toHaveLength(3);
	});
});

/**
 * mdast şekil uyumluluğu — analiz §5.2'nin stratejik iddiası.
 *
 * `@types/mdast` bir bağımlılık olurdu (çekirdekte 3rd-party yasak, saflık
 * kapısı devDependency'yi geçirse de bu dosya kaydı tutulmalı). Bunun yerine
 * mdast arayüzlerinin ilgili kısmı burada **elle** yazılıp ağacımızın onlara
 * atanabildiği doğrulanıyor.
 *
 * Bu testin kırılması "remark eklentisi ağacımızı okuyamaz" demektir.
 */
describe("mdast uyumluluğu", () => {
	interface MdastPoint {
		line: number;
		column: number;
		offset?: number | undefined;
	}
	interface MdastNode {
		type: string;
		position?: { start: MdastPoint; end: MdastPoint } | undefined;
		data?: { [key: string]: unknown } | undefined;
	}
	interface MdastParagraph extends MdastNode {
		type: "paragraph";
		children: MdastNode[];
	}
	interface MdastHeading extends MdastNode {
		type: "heading";
		depth: 1 | 2 | 3 | 4 | 5 | 6;
		children: MdastNode[];
	}
	interface MdastList extends MdastNode {
		type: "list";
		ordered?: boolean | null | undefined;
		start?: number | null | undefined;
		spread?: boolean | null | undefined;
		children: MdastNode[];
	}
	interface MdastCode extends MdastNode {
		type: "code";
		lang?: string | null | undefined;
		meta?: string | null | undefined;
		value: string;
	}
	interface MdastLink extends MdastNode {
		type: "link";
		url: string;
		title?: string | null | undefined;
		children: MdastNode[];
	}
	interface MdastImage extends MdastNode {
		type: "image";
		url: string;
		alt?: string | null | undefined;
		title?: string | null | undefined;
	}
	interface MdastText extends MdastNode {
		type: "text";
		value: string;
	}
	interface MdastTable extends MdastNode {
		type: "table";
		align?: ("left" | "right" | "center" | null)[] | null | undefined;
		children: MdastNode[];
	}

	it("düğümlerimiz mdast arayüzlerine atanabiliyor", () => {
		const paragraf: Paragraph = { type: "paragraph", children: [] };
		const baslik: Heading = { type: "heading", depth: 3, children: [] };
		const liste: List = {
			type: "list",
			ordered: true,
			start: 1,
			spread: false,
			children: [],
		};
		const kod: Code = { type: "code", lang: "ts", meta: null, value: "" };
		const bag: Link = { type: "link", url: "https://a.b", title: null, children: [] };
		const gorsel: Image = { type: "image", url: "https://a.b/x.png", alt: null, title: null };
		const metin: Text = { type: "text", value: "a" };
		const tablo: Table = { type: "table", align: ["left", null, "center"], children: [] };

		// Asıl iddia bu atamalar. Uyumsuzluk olsaydı derleme burada kırılırdı.
		const mParagraf: MdastParagraph = paragraf;
		const mBaslik: MdastHeading = baslik;
		const mListe: MdastList = liste;
		const mKod: MdastCode = kod;
		const mBag: MdastLink = bag;
		const mGorsel: MdastImage = gorsel;
		const mMetin: MdastText = metin;
		const mTablo: MdastTable = tablo;

		expect([mParagraf, mBaslik, mListe, mKod, mBag, mGorsel, mMetin, mTablo]).toHaveLength(8);
	});

	it("konum bilgisi mdast Point şeklinde", () => {
		const nokta: ast.Point = { line: 1, column: 1, offset: 0 };
		const mNokta: MdastPoint = nokta;
		expect(mNokta.offset).toBe(0);
	});
});

describe("yardımcı tipler", () => {
	it("NodeOf tipe göre düğüm seçiyor", () => {
		const baslik: NodeOf<"heading"> = { type: "heading", depth: 1, children: [] };
		expect(baslik.depth).toBe(1);
	});

	it("Inline ve Block birlikte Node'u oluşturuyor", () => {
		const satirIci: Inline = { type: "text", value: "a" };
		const blok: Block = { type: "paragraph", children: [] };
		const dugumler: Node[] = [satirIci, blok, { type: "root", children: [] }];
		expect(dugumler).toHaveLength(3);
	});
});
