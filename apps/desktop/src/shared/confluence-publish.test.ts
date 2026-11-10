import { describe, expect, it } from "vitest";
import { markdownToStorage } from "./confluence.js";
import { proposedTitle, publishPlan } from "./confluence-publish.js";

describe("publishing a local document", () => {
	it("attaches its local pictures and files, each under a name of its own", () => {
		const plan = publishPlan(
			[
				"# Analiz",
				"",
				"![akış](images/akis.png) ve ![](other/akis.png) ve yine ![](images/akis.png)",
				"",
				"[ek](docs/Rapor%20Son.pdf), [diğer belge](notlar.md), [site](https://example.com/a.png)",
				"",
				"![web](https://example.com/b.png) ![yapıştır](data:image/png;base64,AAAA)",
				"",
				"```",
				"![kod](images/kod.png)",
				"```",
			].join("\n"),
		);
		expect(plan.files).toEqual([
			{ url: "images/akis.png", name: "akis.png", image: true },
			{ url: "other/akis.png", name: "akis-2.png", image: true },
			{ url: "docs/Rapor%20Son.pdf", name: "Rapor Son.pdf", image: false },
			{ url: "data:image/png;base64,AAAA", name: "image-1.png", image: true },
		]);
		expect(plan.markdown).toContain("![akış](akis.png)");
		expect(plan.markdown).toContain("![](akis-2.png)");
		expect(plan.markdown).toContain("[ek](Rapor%20Son.pdf)");
		expect(plan.markdown).toContain("[diğer belge](notlar.md)");
		expect(plan.markdown).toContain("![kod](images/kod.png)");
		const storage = markdownToStorage(plan.markdown);
		expect(storage).toContain('<ri:attachment ri:filename="akis-2.png" />');
		expect(storage).toContain('<ri:attachment ri:filename="Rapor Son.pdf" />');
		expect(storage).toContain('<ri:url ri:value="https://example.com/b.png" />');
	});

	it("proposes the opening heading as the title, or the file's name", () => {
		expect(proposedTitle("# Ücretsiz *Koltuk* Seçimi\n\nMetin.\n", "x.md")).toEqual({
			title: "Ücretsiz Koltuk Seçimi",
			fromHeading: true,
			rest: "Metin.\n",
		});
		expect(proposedTitle("Metin.\n\n# Sonra\n", "analiz notu.md")).toMatchObject({
			title: "analiz notu",
			fromHeading: false,
		});
	});
});
