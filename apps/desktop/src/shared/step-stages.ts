/**
 * A mode's steps run by workers: steps marked parallel that stand next to
 * each other run at the same time, a worker each; every other step runs
 * on its own, after the ones before it. For steps 1 2 (sequential), 3 4 5
 * (parallel) and 6 (sequential) that is: 1, then 2, then 3 4 5 at once,
 * then 6 once they are all done. What each step produced is handed to the
 * steps after it; the conversation itself does the last step (or puts
 * the last parallel steps together) and answers. The review runs its
 * checks this way too (`review-plan.ts`). Pure.
 */
import type { CustomMode } from "./custom-modes.js";
import { isCustomModeId } from "./custom-modes.js";
import type { ModeSettings, ResolvedStep } from "./mode-config.js";
import { isMode, resolveMode, storeMode } from "./mode-config.js";

/** At most this many workers run at once; more parallel steps wait for a free one. */
export const MAX_WORKERS = 6;

export interface Stage<S> {
	readonly steps: readonly S[];
	/** Its steps run at the same time; a stage of one step runs on its own. */
	readonly parallel: boolean;
}

/** The steps that are on, in stages: parallel steps next to each other share one. */
export function stagesOf<S extends { readonly on: boolean; readonly parallel: boolean }>(
	steps: readonly S[],
): Stage<S>[] {
	const stages: S[][] = [];
	let open = false;
	for (const step of steps) {
		if (!step.on) continue;
		const last = stages[stages.length - 1];
		if (step.parallel && open && last !== undefined) last.push(step);
		else stages.push([step]);
		open = step.parallel;
	}
	return stages.map((group) => ({ steps: group, parallel: group.length > 1 }));
}

/** How the stages run, by step number: "1 → 2 → 3 ‖ 4 ‖ 5 → 6". */
export function stagesLine<S>(stages: readonly Stage<S>[]): string {
	let n = 0;
	return stages
		.map((stage) =>
			stage.steps
				.map(() => {
					n += 1;
					return String(n);
				})
				.join(" ‖ "),
		)
		.join(" → ");
}

/** A mode's steps as they run: Kalem's (as the user shaped them) or those of a mode of the user's. */
function modeSteps(
	mode: unknown,
	modes: ModeSettings,
	custom: readonly CustomMode[],
): { readonly steps: readonly ResolvedStep[]; readonly parallel: boolean } | null {
	if (isMode(mode)) {
		const resolved = resolveMode(mode, modes);
		return { steps: resolved.steps, parallel: resolved.parallel };
	}
	const own = isCustomModeId(mode) ? custom.find((each) => each.id === mode) : undefined;
	if (own === undefined) return null;
	return {
		parallel: own.parallel,
		steps: own.steps.map((step) => ({
			id: step.id,
			on: step.on,
			custom: true,
			title: step.title ?? null,
			titleKey: null,
			instruction: step.instruction ?? "",
			defaultInstruction: "",
			parallel: step.parallel === true,
		})),
	};
}

export interface StepPlan {
	/** Every stage, the last one included. */
	readonly stages: readonly Stage<ResolvedStep>[];
}

/**
 * How a mode other than the review runs its steps by workers; `null` when
 * it answers as one reply: the user did not turn this on, or no two steps
 * are to run at the same time.
 */
export function stepPlan(
	mode: unknown,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
): StepPlan | null {
	if (mode === "review") return null;
	const found = modeSteps(mode, modes, custom);
	if (found === null || !found.parallel) return null;
	const stages = stagesOf(found.steps);
	if (!stages.some((stage) => stage.parallel)) return null;
	return { stages };
}

/** Whether a question in this mode may be run by workers (the review's checks, or a mode's steps). */
export function runsByWorkers(
	mode: unknown,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
): boolean {
	if (mode === "review") return resolveMode("review", modes).parallel;
	return stepPlan(mode, modes, custom) !== null;
}

/**
 * The modes with one of them cut down to the steps in `keep`, and `note`
 * said after them: what a worker, or the final answer, is told.
 */
export function withOnlySteps(
	mode: unknown,
	keep: ReadonlySet<string>,
	note: string,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
): { readonly modes: ModeSettings; readonly custom: readonly CustomMode[] } {
	if (isMode(mode)) {
		const resolved = resolveMode(mode, modes);
		return {
			modes: {
				...modes,
				[mode]: storeMode({
					...resolved,
					steps: resolved.steps.map((step) => ({ ...step, on: step.on && keep.has(step.id) })),
					extra: [note, resolved.extra].filter((part) => part !== "").join("\n"),
				}),
			},
			custom,
		};
	}
	return {
		modes,
		custom: custom.map((own) =>
			own.id === mode
				? {
						...own,
						steps: own.steps.map((step) => ({ ...step, on: step.on && keep.has(step.id) })),
						prompt: [own.prompt, note].filter((part) => part !== "").join("\n\n"),
					}
				: own,
		),
	};
}

/** What a worker is told after its step. */
export function workerNote(parallel: boolean): string {
	return [
		"This is one step of a larger piece of work that is split into steps; other workers do the other steps, one after another" +
			(parallel ? ", and some of them at this very moment, next to you" : "") +
			". Do only the step above.",
		"What the earlier steps produced is in <earlier-steps> in the question: build on it.",
		"Reply with what this step produced, complete and to the point: your reply is handed on to the next steps and to the final answer, and the user does not see it as it is. Do not ask the user anything: do what you can and say what is missing.",
		...(parallel ? ["Do not change anything outside your own step."] : []),
	].join(" ");
}

/** What the final answer is told when steps are left for it. */
export const FINAL_REST_NOTE =
	"The earlier steps of this work were already done by other workers; what they produced is in <earlier-steps> in the question, and the user has not seen it. Do the steps above, building on it, and give the user the answer, bringing in what matters from the earlier steps.";

/** What the final answer is told when every step is done. */
export const FINAL_COMBINE_NOTE =
	"Every step of this work was already done by other workers; what they produced is in <earlier-steps> in the question, and the user has not seen it. Do not do the steps again: put what they produced together into the answer the user asked for.";

const MAX_RESULT = 20_000;

/** The question with what the earlier steps produced. */
export function withEarlierSteps(
	question: string,
	results: readonly { readonly title: string; readonly text: string }[],
): string {
	if (results.length === 0) return question;
	const blocks = results.map(
		(result, index) =>
			`<step n="${index + 1}" title="${result.title.replace(/"/g, "'").replace(/\s+/g, " ").trim()}">\n${
				result.text.trim().slice(0, MAX_RESULT) || "(it produced nothing)"
			}\n</step>`,
	);
	return `${question}\n\n<earlier-steps>\n${blocks.join("\n")}\n</earlier-steps>`;
}
