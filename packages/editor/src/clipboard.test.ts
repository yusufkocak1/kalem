/**
 * Pano yükü  (İş listesi: F2-11)
 *
 * İki biçimin de aynı AST parçasından üretildiği burada sabitleniyor.
 * Gerçek pano etkileşimi tarayıcı testinde.
 */
import type { Inline } from "@kalem-editor/core";
import { parse } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import { blocksPayload, inlinePayload } from "./clipboard.js";

describe("blok parçası", () => {
	it("düz metin Markdown veriyor", () => {
		expect(blocksPayload(parse("# Başlık\n\nmetin\n")).text).toBe("# Başlık\n\nmetin");
	});

	it("HTML sunum amaçlı", () => {
		expect(blocksPayload(parse("# Başlık\n")).html).toBe("<h1>Başlık</h1>");
	});

	it("HTML'de düzenleme öznitelikleri yok", () => {
		// Word'e yapıştırılan içerikte `data-kalem-id` işi yok.
		const html = blocksPayload(parse("- bir\n- iki\n")).html;
		expect(html).not.toContain("data-kalem");
		expect(html).not.toContain("contenteditable");
	});

	it("liste yapısı iki biçimde de korunuyor", () => {
		const yuk = blocksPayload(parse("- bir\n- iki\n"));
		expect(yuk.text).toBe("- bir\n- iki");
		expect(yuk.html).toBe("<ul><li>bir</li><li>iki</li></ul>");
	});

	it("sondaki satır sonu atılıyor — bu bir parça, belge değil", () => {
		expect(blocksPayload(parse("metin\n")).text).toBe("metin");
	});
});

describe("satır içi parça", () => {
	const kalin: Inline = { type: "strong", children: [{ type: "text", value: "abc" }] };

	/** Asıl kazanç: not defterine yapıştıran kullanıcı işaretleri görür. */
	it("düz metin biçim işaretlerini koruyor", () => {
		expect(inlinePayload([kalin]).text).toBe("**abc**");
	});

	it("HTML paragraf sarmalayıcısı olmadan geliyor", () => {
		// Cümle ortasından kopyalanan metin yeni paragraf açmamalı.
		expect(inlinePayload([kalin]).html).toBe("<strong>abc</strong>");
	});

	it("karışık içerik", () => {
		const nodes: Inline[] = [{ type: "text", value: "bir " }, kalin];
		expect(inlinePayload(nodes).text).toBe("bir **abc**");
		expect(inlinePayload(nodes).html).toBe("bir <strong>abc</strong>");
	});

	it("bağlantı korunuyor", () => {
		const bag: Inline = {
			type: "link",
			url: "/y",
			title: null,
			children: [{ type: "text", value: "a" }],
		};
		expect(inlinePayload([bag]).text).toBe("[a](/y)");
		expect(inlinePayload([bag]).html).toBe('<a href="/y">a</a>');
	});
});
