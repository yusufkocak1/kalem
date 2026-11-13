import { describe, expect, it } from "vitest";
import { findingsText, headingAnchor, lintAnalysis } from "./analysis-lint.js";
import { noteBlock, parseFindings, questionLine, readiness } from "./findings.js";
import {
	asTemplate,
	builtinTemplate,
	documentFromTemplate,
	splitTemplate,
	templateFileName,
	templateMeta,
} from "./templates.js";

const DOC = `# Sipariş İptali

## Amaç ve Kapsam

Müşteri siparişini hızlı bir şekilde iptal edebilmeli.

## Terimler Sözlüğü

## Fonksiyonel Gereksinimler

### FR-01: İptal talebi

Kullanıcı iptal ister.

### FR-03: İade

**Kabul kriterleri:**

- Diyelim ki sipariş kargoda, eğer iptal istenirse, o zaman iade başlar.

### FR-03: Bildirim

Given an order, when it is cancelled, then an e-mail goes. Süre TBD.

<!-- yönerge: hızlı yazmayın -->

\`\`\`
kolay
\`\`\`

Bkz. [akış](#akışlar) ve [amaç](#amaç-ve-kapsam).
`;

describe("lintAnalysis", () => {
	const template = templateMeta(builtinTemplate("tr"), "x");
	const findings = lintAnalysis(DOC, template);
	const problems = findings.map((finding) => finding.problem);

	it("finds the template's missing sections and the empty ones", () => {
		expect(problems).toContain('The template\'s section "İş Kuralları" is missing.');
		expect(problems).toContain('The section "Terimler Sözlüğü" is empty.');
		expect(problems).not.toContain('The section "Amaç ve Kapsam" is empty.');
		// A missing section names itself, so the list can add it; an empty one does not.
		expect(findings.find((finding) => finding.problem.includes("İş Kuralları"))).toMatchObject({
			missingSection: "İş Kuralları",
		});
		expect(
			findings.find((finding) => finding.problem.includes("Terimler Sözlüğü"))?.missingSection,
		).toBeUndefined();
	});

	it("quotes vague words and open points exactly, outside code and comments", () => {
		const vague = findings.find((finding) => finding.kind === "ambiguity");
		expect(vague).toMatchObject({
			section: "Amaç ve Kapsam",
			quote: "Müşteri siparişini hızlı bir şekilde iptal edebilmeli.",
			problem: 'Not measurable: "hızlı".',
		});
		expect(DOC).toContain(vague?.quote);
		expect(findings.filter((finding) => finding.kind === "ambiguity")).toHaveLength(1);
		expect(findings.some((finding) => finding.problem.startsWith("An open point"))).toBe(true);
	});

	it("finds ids defined twice or skipped, and requirements without acceptance criteria", () => {
		expect(problems.some((problem) => problem.startsWith("FR-03 is defined 2 times"))).toBe(true);
		expect(problems).toContain("Ids skipped: FR-02.");
		expect(problems).toContain("FR-01 has no acceptance criteria.");
		expect(problems).not.toContain("FR-03 has no acceptance criteria.");
	});

	it("finds links to headings that are not there", () => {
		expect(headingAnchor("Amaç ve Kapsam")).toBe("amaç-ve-kapsam");
		const links = findings.filter((finding) => finding.problem.startsWith("The link"));
		expect(links.map((finding) => finding.quote)).toEqual(["[akış](#akışlar)"]);
	});

	it("puts the most important first, numbered, and writes them for the model", () => {
		expect(findings[0]?.severity).toBe("high");
		expect(findings.map((finding) => finding.id).slice(0, 2)).toEqual(["L-01", "L-02"]);
		expect(findings.every((finding) => finding.rule === true)).toBe(true);
		expect(findingsText(findings)).toContain("L-01 [high, missing]: The template's section");
		expect(findingsText([])).toBe("The rules found nothing.");
	});
});

describe("findings", () => {
	it("are read from what a model sends, with what it leaves out filled in", () => {
		expect(
			parseFindings([
				{ problem: "Ölçülemez", quote: "hızlı", severity: "high", suggestion: "2 sn içinde" },
				{ quote: "no problem given" },
				{ problem: "Eksik", kind: "nonsense" },
			]),
		).toEqual([
			{
				id: "F-01",
				severity: "high",
				kind: "other",
				section: "",
				quote: "hızlı",
				problem: "Ölçülemez",
				suggestion: "2 sn içinde",
				question: "",
			},
			{
				id: "F-03",
				severity: "medium",
				kind: "other",
				section: "",
				quote: "",
				problem: "Eksik",
				suggestion: "",
				question: "",
			},
		]);
	});

	it("become open questions and notes, and weigh on the readiness", () => {
		const [finding] = parseFindings([
			{
				id: "F-07",
				problem: "Kargodaki sipariş belirsiz",
				question: "Kargodaki sipariş iptal edilebilir mi?",
				section: "4.2 İptal",
			},
		]);
		if (finding === undefined) throw new Error("no finding");
		expect(questionLine(finding)).toBe(
			"- [ ] F-07: Kargodaki sipariş iptal edilebilir mi? (4.2 İptal)",
		);
		expect(noteBlock(finding, "İnceleme")).toBe(
			"> 📝 **İnceleme F-07:** Kargodaki sipariş belirsiz\n>\n> ? Kargodaki sipariş iptal edilebilir mi?",
		);
		expect(readiness([finding, { ...finding, severity: "high" }])).toBe(83);
	});
});

describe("templates", () => {
	it("read their front matter: name, required sections, ids and the open questions' heading", () => {
		const meta = templateMeta(builtinTemplate("en"), "file");
		expect(meta.name).toBe("Software Analysis Document (best practice)");
		expect(meta.required).toContain("Functional Requirements");
		expect(meta.ids).toEqual({ BR: "BR-", FR: "FR-", NFR: "NFR-" });
		expect(meta.questions).toBe("Open Questions");
		const listed = splitTemplate(
			"---\nkalem-template: Kurum\nrequired:\n  - Amaç\n  - 'Kapsam'\n---\n# x\n",
		);
		expect(listed.meta).toEqual({ "kalem-template": "Kurum", required: ["Amaç", "Kapsam"] });
		expect(templateMeta("# Bare\n", "Dosya adı").name).toBe("Dosya adı");
	});

	it("make documents without their front matter, and documents into templates", () => {
		expect(
			documentFromTemplate(builtinTemplate("tr"), "Sipariş İptali").startsWith(
				"# Sipariş İptali\n",
			),
		).toBe(true);
		expect(asTemplate("# Kurum şablonu\n", "Kurum")).toBe(
			'---\nkalem-template: "Kurum"\nrequired: []\n---\n\n# Kurum şablonu\n',
		);
		expect(asTemplate(builtinTemplate("tr"), "x")).toBe(builtinTemplate("tr"));
		expect(templateFileName('Kurum: "Analiz" v3')).toBe("Kurum- -Analiz- v3.md");
	});
});

describe("findings put into the document", () => {
	it("go under the open questions, replacing an empty item, or make the section", async () => {
		const { addToQuestions } = await import("./findings.js");
		const doc = "# A\n\n## Açık Sorular\n\n- [ ] \n\n## Ek\n\nx\n";
		const once = addToQuestions(doc, "- [ ] F-01: Ne zaman?", "Açık Sorular");
		expect(once).toBe("# A\n\n## Açık Sorular\n\n- [ ] F-01: Ne zaman?\n\n## Ek\n\nx\n");
		expect(addToQuestions(once, "- [ ] F-02: Kim?", "Açık Sorular")).toBe(
			"# A\n\n## Açık Sorular\n\n- [ ] F-01: Ne zaman?\n- [ ] F-02: Kim?\n\n## Ek\n\nx\n",
		);
		expect(addToQuestions("# A\n\nmetin\n", "- [ ] F-03: Neden?", "Open Questions")).toBe(
			"# A\n\nmetin\n\n## Open Questions\n\n- [ ] F-03: Neden?\n",
		);
		expect(addToQuestions("# A\n\n## Sorular Listesi\n", "- x", "Q", "sorular listesi")).toBe(
			"# A\n\n## Sorular Listesi\n\n- x\n",
		);
	});

	it("go after the paragraph a finding quotes", async () => {
		const { withNoteAfter } = await import("./findings.js");
		expect(withNoteAfter("# A\n\nBir iki\nüç.\n\nSon\n", "iki", "> not")).toBe(
			"# A\n\nBir iki\nüç.\n\n> not\n\nSon\n",
		);
		expect(withNoteAfter("Son satır", "satır", "> not")).toBe("Son satır\n\n> not\n");
		expect(withNoteAfter("x", "yok", "> not")).toBeNull();
	});

	it("are taken back one by one, later edits kept", async () => {
		const { addToQuestions, revertFindingEdit, withNoteAfter } = await import("./findings.js");
		// A note, with an edit made after it elsewhere.
		const noted = `${withNoteAfter("# A\n\nBir iki\nüç.\n\nSon\n", "iki", "> not") ?? ""}Ek\n`;
		expect(revertFindingEdit(noted, { kind: "noted", note: "> not" })).toBe(
			"# A\n\nBir iki\nüç.\n\nSon\nEk\n",
		);
		expect(revertFindingEdit("# A\n", { kind: "noted", note: "> not" })).toBeNull();
		// A fix: the suggestion nearest to where the quote was goes back.
		expect(
			revertFindingEdit("yeni x yeni", { kind: "fixed", quote: "eski", suggestion: "yeni", at: 7 }),
		).toBe("yeni x eski");
		expect(
			revertFindingEdit("eski", { kind: "fixed", quote: "eski", suggestion: "yeni", at: 0 }),
		).toBeNull();
		// A question, with the section made for it.
		const asked = addToQuestions("# A\n\nmetin\n", "- [ ] F-03: Neden?", "Open Questions");
		expect(
			revertFindingEdit(asked, {
				kind: "asked",
				line: "- [ ] F-03: Neden?",
				heading: "Open Questions",
				madeHeading: true,
			}),
		).toBe("# A\n\nmetin\n");
		// A section that was there stays.
		const kept = addToQuestions("# A\n\n## Sorular\n\n- [ ] eski\n", "- [ ] F-04: Ne?", "Sorular");
		expect(
			revertFindingEdit(kept, {
				kind: "asked",
				line: "- [ ] F-04: Ne?",
				heading: "Sorular",
				madeHeading: false,
			}),
		).toBe("# A\n\n## Sorular\n\n- [ ] eski\n");
	});
});
