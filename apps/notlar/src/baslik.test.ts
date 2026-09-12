import { describe, expect, it } from "vitest";
import { baslikCikar, ozetCikar } from "./baslik.js";

describe("baslikCikar", () => {
	it("ilk başlığı alıyor", () => {
		expect(baslikCikar("# Işık ve Gölge\n\nParagraf.")).toBe("Işık ve Gölge");
		expect(baslikCikar("### Üçüncü seviye")).toBe("Üçüncü seviye");
	});

	it("başlık yoksa ilk anlamlı satırı alıyor", () => {
		expect(baslikCikar("\n\nDüz bir paragraf.\nİkinci satır.")).toBe("Düz bir paragraf.");
	});

	it("liste ve alıntı işaretlerini söküyor", () => {
		expect(baslikCikar("- alışveriş listesi")).toBe("alışveriş listesi");
		expect(baslikCikar("> alıntıyla başlayan not")).toBe("alıntıyla başlayan not");
	});

	it("vurgu işaretleri ada karışmıyor", () => {
		expect(baslikCikar("# **Kalın** başlık")).toBe("Kalın başlık");
		expect(baslikCikar("`kod` ile başlayan")).toBe("kod ile başlayan");
	});

	it("kapanış işaretli başlığı temizliyor", () => {
		expect(baslikCikar("## Başlık ##")).toBe("Başlık");
	});

	it("kod bloğuyla başlayan notta içeriye girmiyor", () => {
		// `# yorum` satırı kod bloğunun içinde ve başlık değil; ad olarak
		// alınsaydı liste yanlış bir şey gösterirdi.
		expect(baslikCikar("```sh\n# yorum\n```")).toBe("Adsız not");
	});

	it("boş belgede yedek adı veriyor", () => {
		expect(baslikCikar("")).toBe("Adsız not");
		expect(baslikCikar("\n\n   \n")).toBe("Adsız not");
		expect(baslikCikar("# \n", "Yeni")).toBe("Yeni");
	});
});

describe("ozetCikar", () => {
	it("başlıktan sonraki ilk satırı alıyor", () => {
		expect(ozetCikar("# Başlık\n\nİlk paragraf.\nİkinci.")).toBe("İlk paragraf.");
	});

	it("uzun satırı kısaltıyor", () => {
		const uzun = `# B\n\n${"a".repeat(200)}`;
		const ozet = ozetCikar(uzun, 20);
		expect(ozet).toHaveLength(20);
		expect(ozet.endsWith("…")).toBe(true);
	});

	it("tek satırlık notta boş dönüyor", () => {
		expect(ozetCikar("# Sadece başlık")).toBe("");
	});
});
