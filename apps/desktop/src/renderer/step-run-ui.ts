/**
 * How a mode's steps run, in Settings: each step sequential or parallel,
 * the parallel steps that run together drawn joined, and the order they
 * run in.
 */
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { stagesLine, stagesOf } from "../shared/step-stages.js";
import { el } from "./dom.js";

/** A step's run choice, as a pill: sequential (on its own, in order) or parallel. */
export function stepRunButton(
	t: Strings,
	parallel: boolean,
	onChange: (parallel: boolean) => void,
): HTMLElement {
	const button = el("button", {
		class: `mode-step-run${parallel ? " mode-step-run-parallel" : ""}`,
		text: parallel ? t.stepParallel : t.stepSequential,
		attrs: { type: "button", "aria-pressed": String(parallel), title: t.stepRunToggle },
	});
	button.addEventListener("click", () => onChange(!parallel));
	return button;
}

/**
 * Marks for a step row that runs in a parallel group: the group's rows are
 * drawn joined, so the steps that run at once are seen together.
 */
export function parallelMarks(
	on: boolean,
	steps: readonly { readonly on: boolean; readonly parallel?: boolean }[],
	index: number,
): Record<string, string> {
	const step = steps[index];
	if (!on || step === undefined || !step.on || step.parallel !== true) return {};
	const neighbour = (from: number, by: number): boolean => {
		for (let at = from + by; at >= 0 && at < steps.length; at += by) {
			const other = steps[at];
			if (other === undefined) return false;
			if (other.on) return other.parallel === true;
		}
		return false;
	};
	const before = neighbour(index, -1);
	const after = neighbour(index, 1);
	if (!before && !after) return {};
	return {
		"data-parallel": before && after ? "middle" : before ? "last" : "first",
	};
}

/** The order the steps run in, by number: "1 → 2 → 3 ‖ 4 ‖ 5 → 6". */
export function runOrder(
	t: Strings,
	steps: readonly { readonly on: boolean; readonly parallel?: boolean }[],
	review = false,
): HTMLElement {
	const stages = stagesOf(steps.map((step) => ({ ...step, parallel: step.parallel === true })));
	const any = stages.some((stage) => stage.parallel);
	return el("p", {
		class: "mode-run-order",
		text: any || review ? format(t.modeRunOrder, stagesLine(stages)) : t.modeRunOrderNone,
	});
}
