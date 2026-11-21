import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

/**
 * Gidiş-dönüş test koşucusu  (İş listesi: F1-08)
 *
 * **Projenin en önemli test altyapısı.**
 *
 * Vaat şu: `serialize(parse(md)) === md`, byte düzeyinde. Kullanıcının
 * dosyasını açıp kapatmak onu değiştirmemeli. marked ve markdown-it bunu
 * veremez — kendi ayrıştırıcımızı yazma gerekçemiz buydu (analiz §5.3).
 *
 * Kabul kriteri: korpusun **≥ %95'i** byte-birebir; kalan kısım bilinçli
 * ve burada dokümante edilmiş istisna olmalı.
 */

const FIXTURES = new URL("../fixtures/", import.meta.url);

/** Korpustaki her dosya: ad ve içerik. */
function korpus(): { ad: string; icerik: string }[] {
	return readdirSync(FIXTURES)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((ad) => ({ ad, icerik: readFileSync(new URL(ad, FIXTURES), "utf8") }));
}

/**
 * Bilinçli istisnalar.
 *
 * Buraya bir dosya eklemek **karar** demektir: neden byte-birebir olamadığı
 * yazılmalı. Liste büyüyorsa serileştirici geriliyor demektir.
 */
const ISTISNALAR: Record<string, string> = {};

describe("gidiş-dönüş sadakati", () => {
	const dosyalar = korpus();

	it("korpus boş değil", () => {
		expect(dosyalar.length).toBeGreaterThan(0);
	});

	for (const { ad, icerik } of dosyalar) {
		const sebep = ISTISNALAR[ad];
		const test = sebep === undefined ? it : it.skip;

		test(`${ad} byte-birebir korunuyor`, () => {
			expect(serialize(parse(icerik))).toBe(icerik);
		});
	}

	/**
	 * Oran raporu: tek tek testler hangi dosyanın bozulduğunu söyler, bu test
	 * kabul kriterini (%95) sayısal olarak zorlar.
	 */
	it("korpusun en az %95'i byte-birebir", () => {
		const basarili = dosyalar.filter(({ icerik }) => serialize(parse(icerik)) === icerik);
		const oran = basarili.length / dosyalar.length;
		expect(
			oran,
			`${basarili.length}/${dosyalar.length} dosya birebir — bozulanlar: ${dosyalar
				.filter(({ icerik }) => serialize(parse(icerik)) !== icerik)
				.map((d) => d.ad)
				.join(", ")}`,
		).toBeGreaterThanOrEqual(0.95);
	});
});

/**
 * İdempotans: bir kez serileştirilmiş metin ikinci turda değişmemeli.
 *
 * Gidiş-dönüş bozulsa bile idempotans tutmalı — aksi hâlde dosya her
 * kaydetmede biraz daha kayar ve bu, sadakat kaybından çok daha kötüdür.
 */
describe("idempotans", () => {
	for (const { ad, icerik } of korpus()) {
		it(`${ad} ikinci turda değişmiyor`, () => {
			const birinci = serialize(parse(icerik));
			const ikinci = serialize(parse(birinci));
			expect(ikinci).toBe(birinci);
		});
	}
});

/** Korpus dışı, elle yazılmış kritik durumlar. */
describe("gidiş-dönüş — nokta atışı", () => {
	const birebir = (md: string) => expect(serialize(parse(md))).toBe(md);

	it("işaret tercihi korunuyor", () => {
		birebir("* yıldız\n* madde\n");
		birebir("+ artı\n+ madde\n");
		birebir("_italik_ ve __kalın__\n");
	});

	it("başlık biçimi korunuyor", () => {
		birebir("Setext\n======\n");
		birebir("## Kapanışlı ##\n");
	});

	it("kod çiti korunuyor", () => {
		birebir("~~~\nkod\n~~~\n");
		birebir("````\nkod\n````\n");
	});

	it("yatay çizgi yazılışı korunuyor", () => {
		birebir("* * *\n");
		birebir("___\n");
	});

	it("başvuru biçimi korunuyor", () => {
		birebir("[a][b]\n\n[b]: /url\n");
		birebir("[b][]\n\n[b]: /url\n");
		birebir("[b]\n\n[b]: /url\n");
	});

	it("son satır sonu olmayan dosya", () => {
		birebir("metin");
	});

	it("CRLF satır sonu korunuyor", () => {
		birebir("bir\r\n\r\niki\r\n");
	});

	it("boş belge", () => {
		birebir("");
	});

	it("işaretten sonra sekme: içerik yenmiyor, sekme korunuyor", () => {
		// Sekme sütun olarak sayılıp karakter olarak kesiliyordu:
		// `-\tsekmeli` → `- meli`.
		const madde = parse("-\tsekmeli madde\n").children[0];
		expect(JSON.stringify(madde)).toContain('"sekmeli madde"');
		birebir("-\tsekmeli madde\n-\tikinci\n");
		birebir("1.\tbir\n2.\tiki\n");
		birebir("-\ta\n\n\tdevam paragrafı\n");
		birebir("-\ta\n\t-\tiç madde\n");
	});

	it("girintili kod çiti ve sekmeyle girintili kod korunuyor", () => {
		birebir("  ```\n  a\n    b\n  ```\n");
		birebir("   ~~~js\n   x\n\n   y\n   ~~~\n");
		birebir("\tkod\n\n\tikinci\n");
		birebir("- a\n\n  ```\n  x\n  ```\n");
	});

	it("paragrafın baştaki boşluğu korunuyor", () => {
		birebir("   üç boşluk\n");
		birebir("- a\n\n   b\n");
	});

	it("alıntının baştaki boş satırları korunuyor", () => {
		birebir("> \n> boş satırdan sonra\n");
		birebir(">\n>\n> iki boş satır\n");
		birebir("> > \n> > iç alıntı\n");
		birebir(">\n");
	});

	it("yazarın koyduğu gereksiz kaçışlar korunuyor", () => {
		birebir("\\* \\_ \\# \\\\ \\> \\- \\+ \\. \\| \\~ \\{ \\}\n");
		birebir("1\\. bu liste değil\n");
		birebir("[\\[köşeli\\]](/u)\n");
		birebir("$$\n\\int x \\, dx\n$$\n");
	});

	it("düzenlenmiş metinde eski kaçış kaydı kullanılmıyor", () => {
		const root = parse("a \\* b\n");
		const text = (root.children[0] as { children: { value: string }[] }).children[0];
		if (text === undefined) throw new Error("metin yok");
		text.value = "yeni * metin";
		expect(serialize(root)).toBe("yeni * metin\n");
	});
});
