/**
 * Dış vurgulayıcı adaptörleri — testler  (İş listesi: F4-02)
 *
 * Girdiler elle yazıldı: `prismjs` ve `shiki` bu paketin bağımlılığı değil
 * ve testin onları kurmasına izin vermek, "bağımlılığımız değil" iddiasını
 * sessizce çürütürdü. Yapılar iki aracın belgelenmiş çıktısı.
 */
import { describe, expect, it } from "vitest";
import type { PrismToken } from "./adapters.js";
import { prismTokens, shikiTokens } from "./adapters.js";

describe("prismTokens", () => {
	it("düz dizeler metin belirteci oluyor", () => {
		expect(prismTokens(["a b"])).toEqual([{ type: "text", text: "a b" }]);
	});

	it("boş dize belirteç üretmiyor", () => {
		expect(prismTokens([""])).toEqual([]);
	});

	it("Prism türlerini bizimkilere çeviriyor", () => {
		const girdi: readonly (string | PrismToken)[] = [
			{ type: "keyword", content: "const" },
			" ",
			{ type: "class-name", content: "Sayac" },
		];
		expect(prismTokens(girdi)).toEqual([
			{ type: "keyword", text: "const" },
			{ type: "text", text: " " },
			{ type: "type", text: "Sayac" },
		]);
	});

	it("bilinmeyen tür düz metne düşüyor", () => {
		expect(prismTokens([{ type: "kim-bu", content: "x" }])).toEqual([{ type: "text", text: "x" }]);
	});

	it("takma ad tür yerine geçiyor", () => {
		const girdi: PrismToken = { type: "kim-bu", content: "x", alias: ["bilinmeyen", "keyword"] };
		expect(prismTokens([girdi])).toEqual([{ type: "keyword", text: "x" }]);
	});

	it("tek dize takma adı da çalışıyor", () => {
		expect(prismTokens([{ type: "yok", content: "x", alias: "comment" }])).toEqual([
			{ type: "comment", text: "x" },
		]);
	});

	it("iç içe belirteçleri düzleştiriyor, iç tür korunuyor", () => {
		const girdi: PrismToken = {
			type: "string",
			content: ["'a", { type: "punctuation", content: "\\n" }, "b'"],
		};
		expect(prismTokens([girdi])).toEqual([
			{ type: "string", text: "'a" },
			{ type: "punctuation", text: "\\n" },
			{ type: "string", text: "b'" },
		]);
	});

	it("tanınmayan iç tür dıştakine düşüyor", () => {
		const girdi: PrismToken = {
			type: "string",
			content: ["'a", { type: "kim-bu", content: "b" }, "c'"],
		};
		expect(prismTokens([girdi]).map((t) => t.type)).toEqual(["string", "string", "string"]);
	});

	it("tek düğümlü iç içe içerik de çözülüyor", () => {
		const girdi: PrismToken = { type: "comment", content: { type: "yok", content: "// x" } };
		expect(prismTokens([girdi])).toEqual([{ type: "comment", text: "// x" }]);
	});

	it("metin kaybolmuyor", () => {
		const girdi: readonly (string | PrismToken)[] = [
			{ type: "keyword", content: "let" },
			" x = ",
			{ type: "number", content: "1" },
			{ type: "punctuation", content: ";" },
		];
		expect(
			prismTokens(girdi)
				.map((t) => t.text)
				.join(""),
		).toBe("let x = 1;");
	});
});

describe("shikiTokens", () => {
	it("rengi belirtece taşıyor", () => {
		expect(shikiTokens([[{ content: "const", color: "#c678dd" }]])).toEqual([
			{ type: "text", text: "const", color: "#c678dd" },
		]);
	});

	it("rengi olmayan belirtece renk alanı eklemiyor", () => {
		const [token] = shikiTokens([[{ content: "x" }]]);
		expect(token).toEqual({ type: "text", text: "x" });
		expect(token).not.toHaveProperty("color");
	});

	it("satırların arasına satır sonu koyuyor", () => {
		const cikti = shikiTokens([[{ content: "a" }], [{ content: "b" }]]);
		expect(cikti.map((t) => t.text).join("")).toBe("a\nb");
	});

	it("boş satır yalnızca satır sonu üretiyor", () => {
		const cikti = shikiTokens([[{ content: "a" }], [], [{ content: "b" }]]);
		expect(cikti.map((t) => t.text).join("")).toBe("a\n\nb");
	});

	it("boş içerikli belirteci atlıyor", () => {
		expect(shikiTokens([[{ content: "" }, { content: "a" }]])).toEqual([
			{ type: "text", text: "a" },
		]);
	});
});
