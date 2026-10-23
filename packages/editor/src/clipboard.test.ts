/**
 * Pano yükü  (İş listesi: F2-11)
 *
 * Üç biçimin de aynı AST parçasından üretildiği burada sabitleniyor.
 * Gerçek pano etkileşimi tarayıcı testinde.
 */
import type { Inline } from "@kalem-editor/core";
import { parse } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import { blocksPayload, inlinePayload, plainText } from "./clipboard.js";

describe("blok parçası", () => {
	it("düz metin biçim işaretsiz, Markdown ayrıca geliyor", () => {
		const yuk = blocksPayload(parse("# Başlık\n\n**kalın** ve *eğik* metin\n"));
		expect(yuk.text).toBe("Başlık\n\nkalın ve eğik metin");
		expect(yuk.markdown).toBe("# Başlık\n\n**kalın** ve *eğik* metin");
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

	it("liste yapısı üç biçimde de korunuyor", () => {
		const yuk = blocksPayload(parse("- bir\n- iki\n"));
		expect(yuk.text).toBe("• bir\n• iki");
		expect(yuk.markdown).toBe("- bir\n- iki");
		expect(yuk.html).toBe("<ul><li>bir</li><li>iki</li></ul>");
	});

	it("sondaki satır sonu atılıyor — bu bir parça, belge değil", () => {
		expect(blocksPayload(parse("metin\n")).text).toBe("metin");
		expect(blocksPayload(parse("metin\n")).markdown).toBe("metin");
	});
});

describe("düz metin", () => {
	it("numaralı, iç içe ve görev listeleri", () => {
		expect(plainText(parse("3. üç\n4. dört\n   - alt\n"))).toBe("3. üç\n4. dört\n\t• alt");
		expect(plainText(parse("- [x] bitti\n- [ ] kaldı\n"))).toBe("☑ bitti\n☐ kaldı");
	});

	it("tablo hücreleri sekmeyle, satırları satır sonuyla ayrılıyor", () => {
		expect(plainText(parse("| Ad | Yaş |\n| --- | --- |\n| Ali | 3 |\n"))).toBe("Ad\tYaş\nAli\t3");
	});

	it("kod olduğu gibi, alıntı işaretsiz, bağlantı metniyle, görsel açıklamasıyla", () => {
		expect(plainText(parse("```js\nlet a = 1;\n```\n\n> alıntı\n"))).toBe("let a = 1;\n\nalıntı");
		expect(plainText(parse("[site](https://a.b) ve ![logo](l.png) `kod`\n"))).toBe(
			"site ve logo kod",
		);
	});
});

describe("satır içi parça", () => {
	const kalin: Inline = { type: "strong", children: [{ type: "text", value: "abc" }] };

	/** Not defterine yapıştıran kullanıcı ekranda gördüğünü alır; işaretler Markdown'da. */
	it("düz metin biçim işaretlerini atıyor, Markdown koruyor", () => {
		expect(inlinePayload([kalin]).text).toBe("abc");
		expect(inlinePayload([kalin]).markdown).toBe("**abc**");
	});

	it("HTML paragraf sarmalayıcısı olmadan geliyor", () => {
		// Cümle ortasından kopyalanan metin yeni paragraf açmamalı.
		expect(inlinePayload([kalin]).html).toBe("<strong>abc</strong>");
	});

	it("karışık içerik", () => {
		const nodes: Inline[] = [{ type: "text", value: "bir " }, kalin];
		expect(inlinePayload(nodes).text).toBe("bir abc");
		expect(inlinePayload(nodes).markdown).toBe("bir **abc**");
		expect(inlinePayload(nodes).html).toBe("bir <strong>abc</strong>");
	});

	it("bağlantı korunuyor", () => {
		const bag: Inline = {
			type: "link",
			url: "/y",
			title: null,
			children: [{ type: "text", value: "a" }],
		};
		expect(inlinePayload([bag]).text).toBe("a");
		expect(inlinePayload([bag]).markdown).toBe("[a](/y)");
		expect(inlinePayload([bag]).html).toBe('<a href="/y">a</a>');
	});
});
