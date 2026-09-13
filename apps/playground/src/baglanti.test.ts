import { describe, expect, it } from "vitest";
import { baglantiUret, coz, GUVENLI_UZUNLUK, kodla } from "./baglanti.js";
import { TANITIM, uzunBelge } from "./ornekler.js";

describe("bağlantı kodlaması", () => {
	it("gidiş-dönüş metni birebir koruyor", async () => {
		const metin = "# Başlık\n\n* yıldız\n* işareti\n\n1) ayraç\n";
		expect(await coz(await kodla(metin))).toBe(metin);
	});

	it("Türkçe karakterler bozulmuyor", async () => {
		// base64 bayt taşıyor, karakter değil: `ışİĞÜ` gibi çok baytlı
		// karakterlerin doğru dönmesi UTF-8 kodlamasının doğru yapıldığının
		// kanıtı.
		const metin = "ışık İŞİK ğüşçö ĞÜŞÇÖ — em tire ve “tırnak”";
		expect(await coz(await kodla(metin))).toBe(metin);
	});

	it("boş belge de kodlanıyor", async () => {
		expect(await coz(await kodla(""))).toBe("");
	});

	it("çok satırlı gerçek belgeyi koruyor", async () => {
		expect(await coz(await kodla(TANITIM))).toBe(TANITIM);
	});

	it("sıkıştırma gerçekten kazandırıyor", async () => {
		// Tekrarlı metin deflate'in en iyi olduğu yer; bin bloklu belgede
		// bağlantının paylaşılabilir kalması buna bağlı.
		const belge = uzunBelge(200);
		const kodlanmis = await kodla(belge);
		expect(kodlanmis.length).toBeLessThan(belge.length / 4);
	});

	it("kodlanmış metin adreste güvenli", async () => {
		// base64url: `+` `/` `=` yok, yani karma parçasında kaçışa gerek yok.
		const kodlanmis = await kodla(TANITIM);
		expect(kodlanmis).toMatch(/^[01][A-Za-z0-9_-]*$/);
	});
});

describe("coz", () => {
	it("baştaki `#` işaretini kabul ediyor", async () => {
		const kodlanmis = await kodla("# Merhaba");
		expect(await coz(`#${kodlanmis}`)).toBe("# Merhaba");
	});

	it("boş karmada null dönüyor", async () => {
		expect(await coz("")).toBeNull();
		expect(await coz("#")).toBeNull();
	});

	it("bozuk veride atmıyor, null dönüyor", async () => {
		// Kullanıcının eline kırpılmış bir bağlantı geçmiş olabilir;
		// uygulamanın açılmaması bundan kötü.
		expect(await coz("1bozuk!!!veri")).toBeNull();
		expect(await coz("9gecersizOnEk")).toBeNull();
		expect(await coz("1")).toBeNull();
	});

	it("düz (sıkıştırılmamış) biçimi de okuyor", async () => {
		// Eski ya da sıkıştırmasız üretilmiş bağlantılar açılmaya devam
		// etmeli; ön ek bunun için var.
		const ham = new TextEncoder().encode("# Düz");
		let ikili = "";
		for (const b of ham) ikili += String.fromCharCode(b);
		const base64url = btoa(ikili).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
		expect(await coz(`0${base64url}`)).toBe("# Düz");
	});
});

describe("baglantiUret", () => {
	it("var olan karmayı değiştiriyor, çoğaltmıyor", async () => {
		const adres = await baglantiUret("# Yeni", "https://ornek.com/playground/#eskiKarma");
		expect(adres.startsWith("https://ornek.com/playground/#")).toBe(true);
		expect(adres.split("#")).toHaveLength(2);
		expect(await coz(adres.split("#")[1] ?? "")).toBe("# Yeni");
	});

	it("tanıtım belgesi güvenli uzunluğun altında kalıyor", async () => {
		const adres = await baglantiUret(TANITIM, "https://kalem.dev/playground/");
		expect(adres.length).toBeLessThan(GUVENLI_UZUNLUK);
	});
});
