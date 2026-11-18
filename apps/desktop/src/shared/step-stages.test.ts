import { describe, expect, it } from "vitest";
import { parseCustomModes } from "./custom-modes.js";
import { modeInstructions, parseModeSettings, resolveMode, storeMode } from "./mode-config.js";
import { modePrompt } from "./modes.js";
import { reviewerQuestion, reviewPlan } from "./review-plan.js";
import {
	runsByWorkers,
	stagesLine,
	stagesOf,
	stepPlan,
	withEarlierSteps,
	withOnlySteps,
} from "./step-stages.js";

const step = (id: string, parallel = false, on = true) => ({ id, on, parallel });

describe("stagesOf", () => {
	it("runs 1 and 2 one by one, 3 4 5 at once, then 6 on its own", () => {
		const stages = stagesOf([
			step("a"),
			step("b"),
			step("c", true),
			step("d", true),
			step("e", true),
			step("f"),
		]);
		expect(stages.map((stage) => [stage.steps.map((s) => s.id), stage.parallel])).toEqual([
			[["a"], false],
			[["b"], false],
			[["c", "d", "e"], true],
			[["f"], false],
		]);
		expect(stagesLine(stages)).toBe("1 → 2 → 3 ‖ 4 ‖ 5 → 6");
	});

	it("leaves out steps that are off, and a parallel step alone runs on its own", () => {
		const stages = stagesOf([step("a", true), step("b", true, false), step("c"), step("d", true)]);
		expect(stages.map((stage) => stage.parallel)).toEqual([false, false, false]);
		// Two parallel steps with a step that is off between them still run together.
		const joined = stagesOf([step("a", true), step("b", false, false), step("c", true)]);
		expect(joined).toHaveLength(1);
		expect(joined[0]?.parallel).toBe(true);
	});
});

describe("a step's parallel choice", () => {
	it("is off in every mode but the review, whose checks run parallel", () => {
		expect(resolveMode("write").parallel).toBe(false);
		expect(resolveMode("write").steps.every((each) => !each.parallel)).toBe(true);
		const review = resolveMode("review");
		expect(review.parallel).toBe(true);
		const parallel = review.steps.filter((each) => each.parallel).map((each) => each.id);
		expect(parallel).not.toContain("lint");
		expect(parallel).not.toContain("report");
		expect(parallel).toContain("scope");
	});

	it("is kept only where it differs from the default, and read back", () => {
		const write = resolveMode("write");
		const changed = {
			...write,
			parallel: true,
			steps: write.steps.map((each) =>
				each.id === "gather" || each.id === "sections" ? { ...each, parallel: true } : each,
			),
		};
		const stored = storeMode(changed);
		expect(stored.parallel).toBe(true);
		const parsed = parseModeSettings({ write: stored });
		const back = resolveMode("write", parsed);
		expect(back.parallel).toBe(true);
		expect(back.steps.filter((each) => each.parallel).map((each) => each.id)).toEqual([
			"gather",
			"sections",
		]);
		expect(storeMode(resolveMode("review"))).toEqual({});
	});

	it("never makes the review's rules, report or summary parallel", () => {
		const parsed = parseModeSettings({
			review: { steps: [{ id: "lint", on: true, parallel: true }] },
		});
		expect(resolveMode("review", parsed).steps.find((each) => each.id === "lint")?.parallel).toBe(
			false,
		);
	});
});

describe("stepPlan", () => {
	const writeWith = (ids: readonly string[], parallel = true) => {
		const write = resolveMode("write");
		return {
			write: storeMode({
				...write,
				parallel,
				steps: write.steps.map((each) => ({ ...each, parallel: ids.includes(each.id) })),
			}),
		};
	};

	it("is there only with the mode's switch on and two parallel steps next to each other", () => {
		expect(stepPlan("write", writeWith(["gather", "sections"], false))).toBeNull();
		expect(stepPlan("write", writeWith(["gather"]))).toBeNull();
		const plan = stepPlan("write", writeWith(["gather", "sections"]));
		expect(plan?.stages.map((stage) => stage.steps.map((each) => each.id))).toEqual([
			["outline"],
			["gather", "sections"],
			["no-invention"],
			["ids-criteria"],
		]);
		expect(runsByWorkers("write", writeWith(["gather", "sections"]))).toBe(true);
		expect(runsByWorkers("write", {})).toBe(false);
		expect(runsByWorkers("review", {})).toBe(true);
		expect(stepPlan("review", {})).toBeNull();
	});

	it("works for the user's own modes", () => {
		const custom = parseCustomModes([
			{
				id: "custom-1",
				name: "Mine",
				parallel: true,
				steps: [
					{ id: "step-1", instruction: "One" },
					{ id: "step-2", instruction: "Two", parallel: true },
					{ id: "step-3", instruction: "Three", parallel: true },
				],
			},
		]);
		expect(custom[0]?.parallel).toBe(true);
		const plan = stepPlan("custom-1", {}, custom);
		expect(plan?.stages.map((stage) => stage.parallel)).toEqual([false, true]);
		const cut = withOnlySteps("custom-1", new Set(["step-2"]), "NOTE", {}, custom);
		const said = modePrompt("custom-1", cut.modes, cut.custom);
		expect(said).toContain("Two");
		expect(said).not.toContain("1. One");
		expect(said).toContain("NOTE");
	});

	it("cuts one of Kalem's modes down to the steps given, with a note", () => {
		const cut = withOnlySteps("write", new Set(["sections"]), "ONLY THIS", {});
		const said = modeInstructions("write", cut.modes);
		expect(said).toContain("document_edit");
		expect(said).not.toContain("plan_update");
		expect(said).toContain("ONLY THIS");
	});

	it("hands the earlier steps' results on", () => {
		expect(withEarlierSteps("Q", [])).toBe("Q");
		const asked = withEarlierSteps("Q", [{ title: 'Out"line', text: "an outline" }]);
		expect(asked).toContain("<earlier-steps>");
		expect(asked).toContain(`title="Out'line"`);
		expect(asked).toContain("an outline");
	});
});

describe("the review in stages", () => {
	it("runs a check that is not parallel after the parallel ones before it", () => {
		const review = resolveMode("review");
		const settings = {
			review: storeMode({
				...review,
				steps: review.steps.map((each) =>
					each.id === "security" ? { ...each, parallel: false } : each,
				),
			}),
		};
		const plan = reviewPlan(settings, { hasWorkspace: true });
		expect(plan?.reviewers.map((reviewer) => [reviewer.steps[0]?.id, reviewer.stage])).toEqual([
			["scope", 0],
			["contradictions", 0],
			["edge-cases", 0],
			["testability", 0],
			["security", 1],
			["code", 2],
		]);
		// By default every check runs at once, as before.
		const all = reviewPlan({}, { hasWorkspace: true });
		expect(new Set(all?.reviewers.map((reviewer) => reviewer.stage))).toEqual(new Set([0]));
	});

	it("tells a later check what the earlier ones found", () => {
		const asked = reviewerQuestion("Q", "", [
			{
				id: "F-01",
				severity: "high",
				kind: "ambiguity",
				section: "",
				quote: "fast",
				problem: "Vague",
				suggestion: "",
				question: "",
			},
		]);
		expect(asked).toContain("<found-by-earlier-checks>");
		expect(asked).toContain("F-01");
		expect(reviewerQuestion("Q", "")).toBe("Q");
	});
});
