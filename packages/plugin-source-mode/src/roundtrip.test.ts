/**
 * Kaynak kipinin dayandığı garanti — testler  (İş listesi: F4-06)
 *
 * Eklentinin kendisi DOM'da yaşıyor ve tarayıcı testleriyle ölçülüyor.
 * Burada sabitlenen şey, "içerik kaybı yok" kabul kriterinin **altındaki**
 * varsayım: belge → metin → belge dönüşü kayıpsız.
 *
 * Çekirdeğin kendi gidiş-dönüş testleri var (F1-07); bu dosya aynı şeyi
 * **eklentinin kullandığı çağrılarla** yapıyor. Bir gün serileştirici
 * değişirse, kırılan testlerden biri burada olsun: kaynak kipi o
 * garantiyi kaybettiği anda kullanıcının belgesini bozmaya başlıyor.
 */
import { parse, serialize } from "@kalem-editor/core";
import { assignIds } from "@kalem-editor/editor";
import { describe, expect, it } from "vitest";

/** Eklentinin yaptığı tam dönüş: belge → metin → belge → metin. */
function tur(md: string): string {
	const doc = assignIds(parse(md));
	const metin = serialize(doc);
	return serialize(assignIds(parse(metin)));
}

const BELGELER: Readonly<Record<string, string>> = {
	baslik: "# Işık ve Gölge\n\nParagraf.\n",
	listeler: "* yıldız\n* işareti\n\n1) parantez\n2) ayracı\n\n- [x] görev\n- [ ] açık\n",
	bicimler: "**kalın**, _eğik_, ~~üstü çizili~~ ve `kod`\n",
	baglanti: "[metin](https://ornek.com) ve ![alt](x.png)\n",
	alinti: "> Alıntı\n>\n> ikinci paragraf\n",
	kod: "```ts\nconst x: number = 1;\n```\n",
	tablo: "| a | b |\n| --- | --- |\n| c | d |\n",
	cizgi: "bir\n\n---\n\niki\n",
	turkce: "ığüşöç İĞÜŞÖÇ — tırnak “çift” ve ‘tek’\n",
	sert: "satır sonu  \nzorlanmış\n",
};

describe("belge → metin → belge", () => {
	for (const [ad, md] of Object.entries(BELGELER)) {
		it(`${ad}: ikinci tur ilkiyle aynı`, () => {
			expect(tur(md)).toBe(serialize(assignIds(parse(md))));
		});

		it(`${ad}: kaynak metni girdiyle aynı`, () => {
			// Daha güçlü iddia: yazılan Markdown'ın kendisi korunuyor, yani
			// kullanıcı kaynağa geçip geri döndüğünde dosyası değişmiyor.
			expect(serialize(assignIds(parse(md)))).toBe(md);
		});
	}
});

describe("gereksiz kaçış normalleşiyor", () => {
	/**
	 * Tek bilinen fark ve bir kayıp **değil**.
	 *
	 * `yıldız \* kaçırılmış` içindeki ters bölü gereksiz: o yıldız zaten
	 * vurgu başlatmıyor (iki yanında boşluk var). Serileştirici onu
	 * atıyor, metin aynı kalıyor ve ikinci tur kararlı.
	 *
	 * Kaynak kipine bunun bir bedeli yok: kullanıcı kaynağa bakıp
	 * değiştirmeden dönerse belgeye hiç dokunulmuyor, değiştirirse zaten
	 * editörün her kaydetmede yaptığı normalleştirme oluyor.
	 */
	const md = "yıldız \\* kaçırılmış\n";

	it("ters bölü düşüyor ama metin aynı", () => {
		expect(serialize(assignIds(parse(md)))).toBe("yıldız * kaçırılmış\n");
	});

	it("ikinci tur kararlı", () => {
		expect(tur(md)).toBe(serialize(assignIds(parse(md))));
	});
});

describe("kimlikler", () => {
	it("her blok kimlik alıyor", () => {
		// Eklenti `applyEdit`e kimliksiz bir belge verirse editörün eleman
		// haritası (F2-05) eşleşmeyi kaybediyor.
		const doc = assignIds(parse("# Bir\n\niki\n"));
		expect(doc.children.every((b) => typeof b.id === "string" && b.id !== "")).toBe(true);
	});
});
