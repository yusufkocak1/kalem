import { describe, expect, it } from "vitest";
import { definedIds } from "./analysis-lint.js";
import {
	chooseProfile,
	sourceOf,
	specCoverage,
	specFiles,
	specFolder,
	specSlug,
	withSource,
} from "./spec-export.js";

const ANALYSIS = `# Ödeme İadesi

## Fonksiyonel Gereksinimler

### FR-01: Tutar doğrulama

Kabul kriterleri: iade tutarı ödemeyi aşamaz.

### FR-02: Kısmi iade

- **FR-03** İade olayı kuyruğa yazılır.

\`\`\`
FR-09 is an example in code, not a requirement.
\`\`\`

## İş Kuralları

- BR-01 İade 30 gün içinde yapılır.

## NFR

- NFR-01 Yanıt 300 ms altında.
`;

describe("spec layout", () => {
	it("makes a folder name from a Turkish title", () => {
		expect(specSlug("Ödeme İadesi: kısmi & tam")).toBe("odeme-iadesi-kismi-tam");
		expect(specSlug("  ???  ")).toBe("spec");
		expect(specSlug("a ".repeat(40)).length).toBeLessThanOrEqual(50);
	});

	it("chooses the layout the user set, else the one the folder uses, else Spec Kit", () => {
		expect(chooseProfile("kiro", { kiro: false, specKit: true })).toBe("kiro");
		expect(chooseProfile("auto", { kiro: true, specKit: false })).toBe("kiro");
		expect(chooseProfile("auto", { kiro: true, specKit: true })).toBe("spec-kit");
		expect(chooseProfile("auto", { kiro: false, specKit: false })).toBe("spec-kit");
		expect(chooseProfile("nonsense", { kiro: false, specKit: false })).toBe("spec-kit");
	});

	it("numbers Spec Kit's folders and updates one of the same name", () => {
		expect(specFolder("spec-kit", "Ödeme iadesi", [])).toEqual({
			folder: "specs/001-odeme-iadesi",
			exists: false,
		});
		expect(specFolder("spec-kit", "Yeni iş", ["001-a", "007-b", "notes"])).toEqual({
			folder: "specs/008-yeni-is",
			exists: false,
		});
		expect(specFolder("spec-kit", "Ödeme iadesi", ["003-odeme-iadesi", "004-x"])).toEqual({
			folder: "specs/003-odeme-iadesi",
			exists: true,
		});
	});

	it("keeps Kiro's and Kalem's specs by name", () => {
		expect(specFolder("kiro", "Ödeme iadesi", ["odeme-iadesi"])).toEqual({
			folder: ".kiro/specs/odeme-iadesi",
			exists: true,
		});
		expect(specFiles("kiro", ".kiro/specs/a")).toEqual({
			requirements: ".kiro/specs/a/requirements.md",
			design: ".kiro/specs/a/design.md",
			tasks: ".kiro/specs/a/tasks.md",
		});
		expect(specFiles("spec-kit", "specs/001-a")).toEqual({
			requirements: "specs/001-a/spec.md",
			design: "specs/001-a/plan.md",
			tasks: "specs/001-a/tasks.md",
		});
		expect(specFolder("kalem", "X", []).folder).toBe(".kalem/specs/x");
	});
});

describe("the source line", () => {
	it("names the document and its hash, once, and ends the file with a new line", () => {
		const first = withSource("# Spec", { name: "iade.md", hash: "abc123" });
		expect(first).toBe('<!-- kalem-source: "iade.md" hash=abc123 -->\n\n# Spec\n');
		expect(sourceOf(first)).toEqual({ name: "iade.md", hash: "abc123" });
		const again = withSource(first, { name: "iade.md", hash: "def456" });
		expect(again).toBe('<!-- kalem-source: "iade.md" hash=def456 -->\n\n# Spec\n');
	});

	it("cannot be broken out of by the document's name", () => {
		const text = withSource("x", { name: 'a"-->b\nc', hash: "" });
		expect(text.split("\n")[0]).toBe('<!-- kalem-source: "a  b c" -->');
		expect(sourceOf("# no source")).toBeNull();
	});
});

describe("coverage of the analysis by the tasks", () => {
	it("finds the requirement ids an analysis defines, not those in code", () => {
		expect([...definedIds(ANALYSIS, null).keys()]).toEqual([
			"FR-01",
			"FR-02",
			"FR-03",
			"BR-01",
			"NFR-01",
		]);
	});

	it("passes when every functional requirement has a task", () => {
		const tasks = `- [ ] T1 (FR-1) Validate the amount
- [ ] T2 (FR-02, FR-03, BR-01) Partial refund and the event
- [x] T3 (NFR-01) Measure
`;
		expect(specCoverage(ANALYSIS, tasks, null)).toEqual({
			tasks: 3,
			required: ["FR-01", "FR-02", "FR-03"],
			uncovered: [],
			unknown: [],
		});
	});

	it("names requirements without a task and ids the analysis does not have", () => {
		const tasks =
			"- [ ] T1 (FR-01) Validate\n- [ ] T2 (FR-07) Something invented\n* plain line FR-02\n";
		const coverage = specCoverage(ANALYSIS, tasks, null);
		expect(coverage.tasks).toBe(2);
		expect(coverage.uncovered).toEqual(["FR-03"]);
		expect(coverage.unknown).toEqual(["FR-07"]);
	});

	it("uses the template's prefixes", () => {
		const analysis = "## Gereksinimler\n\n### GR-1: A\n\n### GR-2: B\n";
		const template = { ids: { FR: "GR-" } };
		const coverage = specCoverage(analysis, "- [ ] do GR-1\n", template);
		expect(coverage.required).toEqual(["GR-1", "GR-2"]);
		expect(coverage.uncovered).toEqual(["GR-2"]);
	});

	it("only counts the tasks without the analysis", () => {
		expect(specCoverage(null, "- [ ] a\n- [ ] b (FR-99)\n", null)).toEqual({
			tasks: 2,
			required: [],
			uncovered: [],
			unknown: [],
		});
	});
});
