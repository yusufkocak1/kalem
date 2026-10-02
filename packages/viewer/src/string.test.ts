/**
 * `renderToString` testleri  (İş listesi: F2-02)
 *
 * Bu dosya DOM'a hiç dokunmaz — `renderToString`'in sözü de tam olarak bu:
 * Node'da, shim olmadan çalışır. DOM tarafıyla eşitlik ayrı bir testte,
 * gerçek tarayıcıda ölçülüyor (`e2e/viewer.spec.ts`).
 */
import type { Root } from "@kalem-editor/core";
import { parse } from "@kalem-editor/core";
import { describe, expect, it } from "vitest";
import type { ViewerOptions } from "./plan.js";
import { renderToString } from "./string.js";

/** Markdown'ı doğrudan HTML'e çevirir — testlerin ortak kısayolu. */
function html(markdown: string, options: ViewerOptions = {}): string {
	return renderToString(parse(markdown), options);
}

describe("bloklar", () => {
	it("paragraf", () => {
		expect(html("merhaba")).toBe("<p>merhaba</p>");
	});

	it("altı başlık seviyesi", () => {
		for (let depth = 1; depth <= 6; depth++) {
			const markdown = `${"#".repeat(depth)} başlık`;
			expect(html(markdown)).toBe(`<h${depth}>başlık</h${depth}>`);
		}
	});

	it("setext başlık da aynı etikete gider", () => {
		expect(html("başlık\n===")).toBe("<h1>başlık</h1>");
	});

	it("yatay çizgi void etiket olarak yazılır", () => {
		expect(html("---")).toBe("<hr>");
	});

	it("alıntı", () => {
		expect(html("> söz")).toBe("<blockquote><p>söz</p></blockquote>");
	});

	it("iç içe alıntı", () => {
		expect(html(">> derin")).toBe("<blockquote><blockquote><p>derin</p></blockquote></blockquote>");
	});

	it("kod bloğu dili `language-` önekiyle yazar", () => {
		expect(html("```ts\nconst a = 1;\n```")).toBe(
			'<pre><code class="language-ts">const a = 1;\n</code></pre>',
		);
	});

	it("dilsiz kod bloğunda sınıf yok", () => {
		expect(html("```\nx\n```")).toBe("<pre><code>x\n</code></pre>");
	});

	it("girintili kod bloğu da aynı yapıyı verir", () => {
		expect(html("    girintili")).toBe("<pre><code>girintili\n</code></pre>");
	});

	it("kod bloğu içeriği kaçışlanır", () => {
		expect(html("```\n<script>&\n```")).toBe("<pre><code>&lt;script&gt;&amp;\n</code></pre>");
	});
});

describe("listeler", () => {
	it("sıkı listede madde paragrafı sarmalanmaz", () => {
		expect(html("- bir\n- iki")).toBe("<ul><li>bir</li><li>iki</li></ul>");
	});

	it("gevşek listede madde paragrafı sarmalanır", () => {
		expect(html("- bir\n\n- iki")).toBe("<ul><li><p>bir</p></li><li><p>iki</p></li></ul>");
	});

	it("sıralı liste", () => {
		expect(html("1. bir\n2. iki")).toBe("<ol><li>bir</li><li>iki</li></ol>");
	});

	it("1'den farklı başlangıç `start` özniteliği yazar", () => {
		expect(html("3. üç")).toBe('<ol start="3"><li>üç</li></ol>');
	});

	it("1'den başlayan listede `start` yazılmaz", () => {
		expect(html("1. bir")).toBe("<ol><li>bir</li></ol>");
	});

	it("iç içe liste", () => {
		expect(html("- dış\n  - iç")).toBe("<ul><li>dış<ul><li>iç</li></ul></li></ul>");
	});

	it("görev listesi devre dışı kutu üretir", () => {
		expect(html("- [ ] yapılacak\n- [x] bitti")).toBe(
			"<ul>" +
				'<li class="kalem-task"><input type="checkbox" disabled="" aria-label="yapılacak"> yapılacak</li>' +
				'<li class="kalem-task"><input type="checkbox" checked="" disabled="" aria-label="bitti"> bitti</li>' +
				"</ul>",
		);
	});
});

describe("satır içi", () => {
	it("vurgu, kalın, üstü çizili, kod", () => {
		expect(html("*a* **b** ~~c~~ `d`")).toBe(
			"<p><em>a</em> <strong>b</strong> <del>c</del> <code>d</code></p>",
		);
	});

	it("sert satır sonu `<br>` verir", () => {
		expect(html("bir  \niki")).toBe("<p>bir<br>iki</p>");
	});

	it("yumuşak satır sonu satır sonu karakteri olarak kalır", () => {
		expect(html("bir\niki")).toBe("<p>bir\niki</p>");
	});

	it("bağlantı ve başlığı", () => {
		expect(html('[a](/y "b")')).toBe('<p><a href="/y" title="b">a</a></p>');
	});

	it("görselde `alt` her zaman yazılır", () => {
		expect(html("![](/r.png)")).toBe('<p><img src="/r.png" alt=""></p>');
	});

	it("görsel alt ve başlık", () => {
		expect(html('![kedi](/k.png "başlık")')).toBe(
			'<p><img src="/k.png" alt="kedi" title="başlık"></p>',
		);
	});

	it("otomatik bağlantı", () => {
		expect(html("<https://ornek.com>")).toBe(
			'<p><a href="https://ornek.com">https://ornek.com</a></p>',
		);
	});
});

describe("referanslar", () => {
	it("tanımlı referans çözülür ve tanım görünmez", () => {
		expect(html("[a][k]\n\n[k]: /yol")).toBe('<p><a href="/yol">a</a></p>');
	});

	it("kısayol referans", () => {
		expect(html("[k]\n\n[k]: /yol")).toBe('<p><a href="/yol">k</a></p>');
	});

	it("görsel referansı", () => {
		expect(html("![alt][k]\n\n[k]: /r.png")).toBe('<p><img src="/r.png" alt="alt"></p>');
	});

	it("tanımsız referans düz metne döner", () => {
		expect(html("[a][k]")).toBe("<p>[a][k]</p>");
	});

	it("tanımsız kısayol referans", () => {
		expect(html("[k]")).toBe("<p>[k]</p>");
	});

	it("tanımsız daraltılmış referans", () => {
		expect(html("[k][]")).toBe("<p>[k][]</p>");
	});

	it("aynı kimlikli ikinci tanım yok sayılır", () => {
		expect(html("[k]\n\n[k]: /ilk\n\n[k]: /ikinci")).toBe('<p><a href="/ilk">k</a></p>');
	});
});

describe("tablo", () => {
	it("başlık ve gövde ayrılır, hizalama sınıfa yazılır", () => {
		const markdown = "| a | b |\n| :-- | --: |\n| 1 | 2 |";
		expect(html(markdown)).toBe(
			"<table><thead><tr>" +
				'<th class="kalem-align-left">a</th><th class="kalem-align-right">b</th>' +
				"</tr></thead><tbody><tr>" +
				'<td class="kalem-align-left">1</td><td class="kalem-align-right">2</td>' +
				"</tr></tbody></table>",
		);
	});

	it("hizalamasız sütun sınıf almaz", () => {
		expect(html("| a |\n| --- |\n| 1 |")).toBe(
			"<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
		);
	});

	it("gövdesiz tabloda `tbody` yazılmaz", () => {
		expect(html("| a |\n| --- |")).toBe("<table><thead><tr><th>a</th></tr></thead></table>");
	});
});

describe("güvenlik", () => {
	it("javascript: bağlantısı etkisizleştirilir, metin korunur", () => {
		expect(html("[tıkla](javascript:alert(1))")).toBe('<p><a href="#">tıkla</a></p>');
	});

	it("svg data URI'si görselde kabul edilmez", () => {
		expect(html("![x](data:image/svg+xml,%3Csvg%20onload=x%3E)")).toBe(
			'<p><img src="#" alt="x"></p>',
		);
	});

	it("izinli data URI'si korunur", () => {
		expect(html("![x](data:image/png;base64,AAA)")).toBe(
			'<p><img src="data:image/png;base64,AAA" alt="x"></p>',
		);
	});

	it("ham HTML varsayılan olarak metne çevrilir", () => {
		expect(html("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	it("`strip` politikası ham HTML'i atar", () => {
		expect(html("<div>x</div>", { html: "strip" })).toBe("");
	});

	it("`allow` politikası ham HTML'i olduğu gibi basar", () => {
		expect(html("<div>x</div>", { html: "allow" })).toBe("<div>x</div>");
	});

	it("`allow` politikasında temizleme kancası çağrılır", () => {
		const result = html("<div>x</div>", {
			html: "allow",
			sanitizeHtml: (value) => value.split("div").join("section"),
		});
		expect(result).toBe("<section>x</section>");
	});

	it("satır içi ham HTML de politikaya uyar", () => {
		expect(html("a <b>x</b> b")).toBe("<p>a &lt;b&gt;x&lt;/b&gt; b</p>");
	});
});

describe("kaçışlama", () => {
	it("metinde yalnızca &, < ve > kaçışlanır", () => {
		// `'` ve `"` bilerek kaçışlanmıyor: tarayıcının `innerHTML` çıktısı
		// da kaçışlamıyor ve iki hedefin eşitliği buna bağlı.
		expect(html("a & b < c > d ' e \" f")).toBe("<p>a &amp; b &lt; c &gt; d ' e \" f</p>");
	});

	it("öznitelikte tırnak kaçışlanır", () => {
		expect(html('[a](/y "tır\\"nak")')).toBe('<p><a href="/y" title="tır&quot;nak">a</a></p>');
	});

	it("öznitelikte & kaçışlanır", () => {
		expect(html("[a](/y?x=1&z=2)")).toBe('<p><a href="/y?x=1&amp;z=2">a</a></p>');
	});

	it("bölünmez boşluk varlığa çevrilir", () => {
		const nbsp = String.fromCharCode(0xa0);
		expect(html(`a${nbsp}b`)).toBe("<p>a&nbsp;b</p>");
	});

	it("Türkçe karakterler olduğu gibi kalır", () => {
		expect(html("ığüşöç İĞÜŞÖÇ")).toBe("<p>ığüşöç İĞÜŞÖÇ</p>");
	});
});

describe("frontmatter", () => {
	it("varsayılan olarak gizlenir", () => {
		expect(html("---\na: 1\n---\n\nmetin")).toBe("<p>metin</p>");
	});

	it("istenirse kod bloğu olarak gösterilir", () => {
		expect(html("---\na: 1\n---\n", { frontmatter: true })).toBe(
			'<pre><code class="language-yaml">a: 1\n</code></pre>',
		);
	});
});

describe("seçenekler", () => {
	it("sınıf öneki değiştirilebilir", () => {
		expect(html("- [x] a", { classPrefix: "md-" })).toBe(
			'<ul><li class="md-task"><input type="checkbox" checked="" disabled="" aria-label="a"> a</li></ul>',
		);
	});
});

describe("boş girdi", () => {
	it("boş belge boş çıktı verir", () => {
		expect(html("")).toBe("");
	});
});

/**
 * Erişilebilirlik ayrıntıları  (İş listesi: F2-04)
 *
 * Buradaki iddiaların çoğu axe taramasının (`e2e/viewer-a11y.spec.ts`)
 * bulduğu gerçek kusurlardan doğdu; birim testi olarak burada duruyorlar
 * ki hangi işaretlemenin neden üretildiği tek bakışta görünsün.
 */
describe("erişilebilirlik", () => {
	it("görev kutusunun erişilebilir adı maddenin metni", () => {
		expect(html("- [x] Faturayı öde")).toContain('aria-label="Faturayı öde"');
	});

	it("ad üretilirken satır içi biçimlendirme düzleştiriliyor", () => {
		expect(html("- [ ] **kalın** ve `kod`")).toContain('aria-label="kalın ve kod"');
	});

	it("çok satırlı maddede boşluklar tek boşluğa iniyor", () => {
		expect(html("- [ ] bir\n  iki")).toContain('aria-label="bir iki"');
	});

	/**
	 * Boş görev maddesi ayrıştırıcıdan gelmez (`- [ ]` GFM'de görev sayılmaz)
	 * ama **editörden gelir**: kullanıcı Enter'a basınca oluşan ilk şey boş
	 * bir maddedir. Ağaç bu yüzden elle kuruluyor.
	 */
	it("metinsiz görev kutusu erişilebilirlik ağacından çıkarılıyor", () => {
		const kok: Root = {
			type: "root",
			children: [
				{
					type: "list",
					ordered: false,
					start: null,
					spread: false,
					children: [{ type: "listItem", checked: false, spread: false, children: [] }],
				},
			],
		};
		const cikti = renderToString(kok);
		expect(cikti).toContain('aria-hidden="true"');
		expect(cikti).not.toContain("aria-label");
	});

	it("görsel `alt` boş bile olsa yazılıyor", () => {
		// `alt`'sız görseli ekran okuyucu dosya adıyla okur.
		expect(html("![](/uzun-dosya-adi.png)")).toContain('alt=""');
	});
});

describe("text color", () => {
	it("renders a color span even when raw HTML is escaped", () => {
		expect(renderToString(parse('a <span style="color:#c00">**b**</span>\n'))).toBe(
			'<p>a <span style="color:#c00"><strong>b</strong></span></p>',
		);
	});

	it("drops the wrapper when the color is not safe", () => {
		const root: Root = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{
							type: "color",
							color: "red;background:url(x)",
							children: [{ type: "text", value: "a" }],
						},
					],
				},
			],
		};
		expect(renderToString(root)).toBe("<p>a</p>");
	});
});
