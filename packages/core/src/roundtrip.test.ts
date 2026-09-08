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
});
