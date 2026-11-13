import { describe, expect, it } from "vitest";
import type { Finding } from "./findings.js";
import { modeInstructions, parseModeSettings } from "./mode-config.js";
import {
	FindingMerger,
	MAX_REVIEWERS,
	reviewerQuestion,
	reviewPlan,
	summaryQuestion,
} from "./review-plan.js";

const finding = (over: Partial<Finding>): Finding => ({
	id: "F-01",
	severity: "medium",
	kind: "ambiguity",
	section: "",
	quote: "",
	problem: "A problem",
	suggestion: "",
	question: "",
	...over,
});

describe("a review run side by side", () => {
	it("gives each check a reviewer of its own, and the summary to the answer", () => {
		const plan = reviewPlan({}, { hasWorkspace: false });
		expect(plan).not.toBeNull();
		if (plan === null) return;
		expect(plan.lint).toBe(true);
		expect(plan.hasSummary).toBe(true);
		// Without code to compare with, nobody is asked to compare.
		expect(plan.reviewers.map((reviewer) => reviewer.steps.map((step) => step.id))).toEqual([
			["scope"],
			["contradictions"],
			["edge-cases"],
			["testability"],
			["security"],
		]);
		const told = modeInstructions("review", plan.reviewers[1]?.modes);
		expect(told).toContain("look for contradictions");
		expect(told).toContain("report_findings");
		expect(told).toContain("one of several reviewers");
		expect(told).not.toContain("analysis_lint");
		expect(told).not.toContain("Check the scope");
		expect(told).not.toContain("short summary");
		const summary = modeInstructions("review", plan.summary);
		expect(summary).toContain("short summary");
		expect(summary).toContain("do not check the document again");
		expect(summary).not.toContain("look for contradictions");
	});

	it("compares with the code when there is a workspace", () => {
		const plan = reviewPlan({}, { hasWorkspace: true });
		expect(plan?.reviewers.at(-1)?.steps[0]?.id).toBe("code");
	});

	it("is left to one answer when turned off, without a report, or with one check", () => {
		expect(
			reviewPlan(parseModeSettings({ review: { parallel: false } }), { hasWorkspace: true }),
		).toBeNull();
		expect(
			reviewPlan(parseModeSettings({ review: { steps: [{ id: "report", on: false }] } }), {
				hasWorkspace: true,
			}),
		).toBeNull();
		const one = parseModeSettings({
			review: {
				steps: ["scope", "contradictions", "edge-cases", "testability"].map((id) => ({
					id,
					on: false,
				})),
			},
		});
		expect(reviewPlan(one, { hasWorkspace: false })).toBeNull();
	});

	it("shares more checks than reviewers among them, the user's own included", () => {
		const settings = parseModeSettings({
			review: {
				steps: [1, 2, 3].map((n) => ({
					id: `own-${n}`,
					on: true,
					custom: true,
					instruction: `Check ${n}.`,
				})),
			},
		});
		const plan = reviewPlan(settings, { hasWorkspace: true });
		expect(plan?.reviewers).toHaveLength(MAX_REVIEWERS);
		expect(plan?.reviewers.flatMap((reviewer) => reviewer.steps)).toHaveLength(9);
	});

	it("shares the most findings wanted among the reviewers", () => {
		const settings = parseModeSettings({ review: { maxFindings: 10, minSeverity: "high" } });
		const plan = reviewPlan(settings, { hasWorkspace: false });
		const told = modeInstructions("review", plan?.reviewers[0]?.modes);
		expect(told).toContain("Report at most 2 problems");
		expect(told).toContain("Report only high-severity problems.");
		expect(plan?.maxFindings).toBe(10);
	});
});

describe("the reviewers' findings as one list", () => {
	it("numbers them in the order they come", () => {
		const merger = new FindingMerger();
		expect(merger.add([finding({ quote: "a" }), finding({ quote: "b" })]).map((f) => f.id)).toEqual(
			["F-01", "F-02"],
		);
		expect(merger.add([finding({ quote: "c" })]).map((f) => f.id)).toEqual(["F-03"]);
		expect(merger.all).toHaveLength(3);
	});

	it("keeps a sentence reported twice once, but not two different problems in it", () => {
		const merger = new FindingMerger();
		merger.add([finding({ quote: "The system  must be fast.", kind: "ambiguity" })]);
		expect(
			merger.add([finding({ quote: "the system must be fast.", kind: "testability" })]),
		).toEqual([]);
		expect(
			merger.add([finding({ quote: "The system must be fast.", kind: "security" })]),
		).toHaveLength(1);
		expect(
			merger.add([finding({ problem: "No scope" }), finding({ problem: "No scope" })]),
		).toHaveLength(1);
	});

	it("keeps what the rules found, and stops at the most wanted", () => {
		const merger = new FindingMerger(2);
		merger.seed([finding({ id: "L-01", quote: "TBD", rule: true })]);
		expect(
			merger.add([finding({ quote: "a" }), finding({ quote: "b" }), finding({ quote: "c" })]),
		).toHaveLength(2);
		expect(merger.all.map((f) => f.id)).toEqual(["L-01", "F-01", "F-02"]);
	});
});

describe("what is asked", () => {
	it("tells a reviewer what the rules found", () => {
		expect(reviewerQuestion("Review it", "")).toBe("Review it");
		expect(reviewerQuestion("Review it", "L-01 …")).toContain("<already-found>");
	});

	it("gives the answer the findings to sum up", () => {
		const text = summaryQuestion("Review it", {
			findings: [finding({ id: "F-01", severity: "high", section: "Scope", quote: "fast" })],
			checks: ["Scope", "Security"],
			failed: ["Security"],
			hasSummary: false,
		});
		expect(text).toContain('F-01 [high, ambiguity] §Scope: A problem — "fast"');
		expect(text).toContain("could not be made, say so: Security");
		expect(text).toContain("one short line");
		expect(
			summaryQuestion("Review it", { findings: [], checks: [], failed: [], hasSummary: true }),
		).toContain("No problems were found.");
	});
});
