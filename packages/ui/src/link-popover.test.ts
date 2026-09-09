/**
 * Bağlantı adresi normalleştirme  (İş listesi: F3-02)
 *
 * Popover'ın DOM tarafı tarayıcı testinde; burada yalnızca "kullanıcı ne
 * yazarsa ne olur" kuralı sabitleniyor. Bu kural, kullanıcıların şema
 * yazmama alışkanlığıyla göreli yol niyetini ayırmak zorunda.
 */
import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./link-popover.js";

describe("şema ekleme", () => {
	it("şemasız alan adına https ekliyor", () => {
		expect(normalizeUrl("ornek.com")).toBe("https://ornek.com");
	});

	it("yollu alan adına da ekliyor", () => {
		expect(normalizeUrl("www.ornek.com/yol")).toBe("https://www.ornek.com/yol");
	});

	it("var olan şemaya dokunmuyor", () => {
		expect(normalizeUrl("https://ornek.com")).toBe("https://ornek.com");
		expect(normalizeUrl("http://ornek.com")).toBe("http://ornek.com");
		expect(normalizeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
	});

	it("büyük harfli şemayı tanıyor", () => {
		expect(normalizeUrl("HTTPS://ornek.com")).toBe("HTTPS://ornek.com");
	});
});

describe("göreli adresler", () => {
	it("mutlak yola dokunmuyor", () => {
		expect(normalizeUrl("/yol/dosya.md")).toBe("/yol/dosya.md");
	});

	it("çapaya dokunmuyor", () => {
		expect(normalizeUrl("#bolum")).toBe("#bolum");
	});

	it("sorgu dizesine dokunmuyor", () => {
		expect(normalizeUrl("?q=1")).toBe("?q=1");
	});

	/** Noktasız tek kelime alan adı değil; dokunulmuyor. */
	it("noktasız metne şema eklemiyor", () => {
		expect(normalizeUrl("sayfa")).toBe("sayfa");
	});
});

describe("kenar durumlar", () => {
	it("boş girdi boş kalıyor", () => {
		expect(normalizeUrl("")).toBe("");
		expect(normalizeUrl("   ")).toBe("");
	});

	it("baştaki ve sondaki boşluk kırpılıyor", () => {
		expect(normalizeUrl("  ornek.com  ")).toBe("https://ornek.com");
	});

	/**
	 * `javascript:` burada **engellenmiyor**: normalleştirme yalnızca şema
	 * ekliyor. Güvenlik kararı `isSafeUrl`'e ait ve popover onu ayrıca
	 * çağırıyor — iki sorumluluğu karıştırmak, birini atlamayı kolaylaştırır.
	 */
	it("güvenlik kararı vermiyor", () => {
		expect(normalizeUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
	});
});
