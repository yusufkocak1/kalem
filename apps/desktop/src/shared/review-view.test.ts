import { describe, expect, it } from "vitest";
import type { Finding } from "./findings.js";
import { revertFindingEdit, sectionHeading, withSections } from "./findings.js";
import { firstSentence, reviewLayout } from "./review-view.js";

let count = 0;
const finding = (over: Partial<Finding>): Finding => ({
	id: `F-${++count}`,
	severity: "medium",
	kind: "ambiguity",
	section: "",
	quote: "",
	problem: "A problem.",
	suggestion: "",
	question: "",
	...over,
});
const section = (name: string): Finding =>
	finding({ severity: "high", kind: "missing", rule: true, missingSection: name });

describe("the review list's layout", () => {
	it("puts the model's findings before the rules' of the same severity, the sections together", () => {
		const rule = finding({ severity: "high", rule: true, problem: "No criteria." });
		const model = finding({ severity: "high", kind: "contradiction" });
		const low = finding({ severity: "low" });
		const sections = [section("Scope"), section("Glossary")];
		const layout = reviewLayout([...sections, rule, low, model], () => true);
		expect(
			layout.open.map((item) => (item.kind === "finding" ? item.finding : "sections")),
		).toEqual([model, "sections", rule, low]);
		expect(layout.severities).toEqual({ high: 4, medium: 0, low: 1 });
		expect(layout.kinds).toEqual([
			["ambiguity", 2],
			["missing", 2],
			["contradiction", 1],
		]);
	});

	it("lists a single missing section as a finding of its own", () => {
		const one = section("Scope");
		expect(reviewLayout([one], () => true).open).toEqual([{ kind: "finding", finding: one }]);
	});

	it("moves what was dealt with to the end, the sections once all are added", () => {
		const fixed = finding({});
		const open = finding({});
		const sections = [section("Scope"), section("Glossary")];
		const done = new Set<Finding>([fixed, sections[0] as Finding]);
		let layout = reviewLayout([fixed, open, ...sections], (f) => !done.has(f));
		expect(layout.open.map((item) => item.kind)).toEqual(["sections", "finding"]);
		expect(layout.done).toEqual([{ kind: "finding", finding: fixed }]);
		done.add(sections[1] as Finding);
		layout = reviewLayout([fixed, open, ...sections], (f) => !done.has(f));
		// Still in severity order: the sections are high, the fixed one medium.
		expect(layout.done.map((item) => item.kind)).toEqual(["sections", "finding"]);
		// The counts are of what is still open.
		expect(layout.severities.high).toBe(0);
	});

	it("leaves what the filter lets through, and says how many it hides", () => {
		const high = finding({ severity: "high", kind: "security" });
		const medium = finding({ severity: "medium", kind: "security" });
		const other = finding({ severity: "high", kind: "ambiguity" });
		const layout = reviewLayout([high, medium, other], () => true, {
			severities: new Set(["high"]),
			kinds: new Set(["security"]),
		});
		expect(layout.open).toEqual([{ kind: "finding", finding: high }]);
		expect(layout.hidden).toBe(2);
		// The chips still count everything open.
		expect(layout.severities).toEqual({ high: 2, medium: 1, low: 0 });
	});

	it("shows a problem in a line", () => {
		expect(firstSentence("Not measurable. Say how fast.")).toBe("Not measurable.");
		expect(firstSentence("v1.2 is   wrong")).toBe("v1.2 is wrong");
		expect(firstSentence("x".repeat(200), 20)).toHaveLength(20);
	});
});

describe("the template's missing sections", () => {
	it("are added at the end, and each taken back on its own while still empty", () => {
		const text = withSections("# Order\n\nText.\n", ["Scope", "Glossary"]);
		expect(text).toBe("# Order\n\nText.\n\n## Scope\n\n## Glossary\n");
		const scope = { kind: "added", heading: sectionHeading("Scope") } as const;
		const glossary = { kind: "added", heading: sectionHeading("Glossary") } as const;
		expect(revertFindingEdit(text, scope)).toBe("# Order\n\nText.\n\n## Glossary\n");
		expect(revertFindingEdit(text, glossary)).toBe("# Order\n\nText.\n\n## Scope\n");
		// Once the user wrote in it, it is theirs: only the finding reopens.
		expect(revertFindingEdit(text.replace("## Scope\n", "## Scope\n\nWho uses it.\n"), scope)).toBe(
			null,
		);
	});
});

describe("sections the document has by now", () => {
	it("are not added again", () => {
		const text = "# Order\n\n## Open Questions\n\n- [ ] F-02\n";
		expect(withSections(text, ["Open Questions", "Scope"])).toBe(`${text}\n## Scope\n`);
		expect(withSections(text, ["open questions"])).toBe(text);
	});

	it("keep an opened finding in the list after it was dealt with", () => {
		const fixed = finding({});
		const layout = reviewLayout(
			[fixed],
			() => false,
			undefined,
			(f) => f === fixed,
		);
		expect(layout.open).toEqual([{ kind: "finding", finding: fixed }]);
		expect(layout.done).toEqual([]);
		// Counted as dealt with all the same.
		expect(layout.severities.medium).toBe(0);
	});
});
