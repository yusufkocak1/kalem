/**
 * A mode's steps run by workers (CLI processes), stage by stage: a stage
 * of one step runs on its own, the steps of a parallel stage at once (at
 * most `MAX_WORKERS` at a time). Each worker gets the question and what
 * the earlier stages produced, and does its own step only. The last step,
 * when it runs on its own, is left to the conversation, which answers;
 * after a last parallel stage the conversation puts the results together.
 * A stage that fails stops the run: the conversation does what is left.
 * How each step is going is sent along as it changes, on the review's
 * checks card.
 */
import { randomUUID } from "node:crypto";
import type { CheckProgress, ClaudeEvent } from "../shared/claude.js";
import type { Strings } from "../shared/i18n.js";
import type { ResolvedStep } from "../shared/mode-config.js";
import type { StepPlan } from "../shared/step-stages.js";
import { MAX_WORKERS, withEarlierSteps } from "../shared/step-stages.js";
import type { ToolDefinition } from "../shared/tool-protocol.js";
import type { McpRun } from "./assistant-mcp.js";
import type { ToolContext, ToolResult } from "./assistant-tools.js";
import { runTool, toolsFor } from "./assistant-tools.js";

/** Tools a worker has no use for: the plan and the mode are the conversation's. */
const NOT_FOR_WORKERS: readonly string[] = ["plan_update", "use_mode"];

export interface StepRunOptions {
	readonly plan: StepPlan;
	readonly t: Strings;
	/** The answer's own tools: the workers get them too, less the conversation's own. */
	readonly tools: ToolContext;
	/** Opens Kalem's MCP server (and the mode's) for a worker; `null` when it needs none. */
	open(
		definitions: readonly ToolDefinition[],
		run: (name: string, input: unknown) => Promise<ToolResult>,
	): Promise<McpRun | null>;
	forward(event: ClaudeEvent): void;
	/** What a worker is told: the mode cut down to its step. */
	instructions(step: ResolvedStep, parallel: boolean, tools: readonly ToolDefinition[]): string;
	/** The question as the conversation got it, with the document in it. */
	readonly question: string;
	/** Runs one worker to its end; its events go to `send`. */
	ask(
		system: string,
		question: string,
		run: McpRun | null,
		tools: readonly string[],
		send: (event: ClaudeEvent) => void,
		stopped: () => boolean,
	): Promise<void>;
	/** The clock, for the tests. */
	now?(): number;
}

export interface StepResult {
	readonly id: string;
	readonly title: string;
	readonly text: string;
}

/** What the workers did, for the answer. */
export interface StepsDone {
	/** What each step that was done produced, in order. */
	readonly results: readonly StepResult[];
	/** The steps left for the answer, by id. */
	readonly left: ReadonlySet<string>;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class StepRun {
	readonly id = randomUUID();
	readonly #options: StepRunOptions;
	readonly #now: () => number;
	/** The stages the workers run: all but a last one of a single step. */
	readonly #stages: StepPlan["stages"];
	readonly #checks: Mutable<CheckProgress>[];

	constructor(options: StepRunOptions) {
		this.#options = options;
		this.#now = options.now ?? Date.now;
		const stages = options.plan.stages;
		const last = stages[stages.length - 1];
		this.#stages = last !== undefined && !last.parallel ? stages.slice(0, -1) : stages;
		this.#checks = this.#stages.flatMap((stage) =>
			stage.steps.map((step) => ({
				title: this.title(step),
				status: "waiting" as const,
				started: 0,
				findings: 0,
				noRetry: true,
				...(stage.parallel ? { parallel: true } : {}),
			})),
		);
	}

	title(step: ResolvedStep): string {
		return step.title ?? (step.titleKey === null ? step.id : this.#options.t[step.titleKey]);
	}

	get checks(): readonly CheckProgress[] {
		return this.#checks.map((check) => ({ ...check }));
	}

	#publish(): void {
		this.#options.forward({
			kind: "checks",
			review: this.id,
			checks: this.checks,
			rules: false,
			steps: true,
		});
	}

	#context(): ToolContext {
		const tools = this.#options.tools;
		return {
			...tools,
			excluded: new Set([...tools.excluded, ...NOT_FOR_WORKERS]),
			auto: false,
			emit: (event) => this.#options.forward(event),
			get readExternal() {
				return tools.readExternal;
			},
			set readExternal(value: boolean) {
				tools.readExternal = value;
			},
		};
	}

	/**
	 * The stages, one after another. `null` when not one step could be done:
	 * the answer then does them all itself, as before.
	 */
	async run(stopped: () => boolean): Promise<StepsDone | null> {
		const all = this.#options.plan.stages.flatMap((stage) => stage.steps);
		const results: StepResult[] = [];
		const context = this.#context();
		const definitions = toolsFor(context).map((tool) => tool.definition);
		this.#publish();
		let at = 0;
		for (const stage of this.#stages) {
			if (stopped()) break;
			const first = at;
			at += stage.steps.length;
			const question = withEarlierSteps(this.#options.question, results);
			const outcomes: (string | null)[] = stage.steps.map(() => null);
			let next = 0;
			const worker = async (): Promise<void> => {
				for (;;) {
					const index = next++;
					const step = stage.steps[index];
					if (step === undefined) return;
					outcomes[index] = await this.#work(
						first + index,
						step,
						stage.parallel,
						question,
						definitions,
						context,
						stopped,
					);
				}
			};
			await Promise.all(
				Array.from({ length: Math.min(MAX_WORKERS, stage.steps.length) }, () => worker()),
			);
			stage.steps.forEach((step, index) => {
				const text = outcomes[index];
				if (text !== null && text !== undefined)
					results.push({ id: step.id, title: this.title(step), text });
			});
			// A step that could not be done: the answer does it, and those after it.
			if (outcomes.some((text) => text === null)) break;
		}
		// Steps no worker got to are the answer's: they leave the card.
		const waiting = this.#checks.filter((check) => check.status === "waiting");
		if (waiting.length > 0) {
			this.#checks.splice(
				0,
				this.#checks.length,
				...this.#checks.filter((c) => c.status !== "waiting"),
			);
			this.#publish();
		}
		if (results.length === 0) return null;
		const done = new Set(results.map((result) => result.id));
		return { results, left: new Set(all.filter((step) => !done.has(step.id)).map((s) => s.id)) };
	}

	/** Runs one step's worker; what it produced, or `null` when it failed. */
	async #work(
		index: number,
		step: ResolvedStep,
		parallel: boolean,
		question: string,
		definitions: readonly ToolDefinition[],
		context: ToolContext,
		stopped: () => boolean,
	): Promise<string | null> {
		const check = this.#checks[index];
		if (check === undefined) return null;
		const { forward } = this.#options;
		Object.assign(check, { status: "running", started: this.#now() });
		this.#publish();
		const outcome: { error: string | null; text: string } = { error: null, text: "" };
		const run = await this.#options
			.open(definitions, (name, input) => runTool(name, input, context))
			.catch((cause: unknown) => {
				outcome.error = cause instanceof Error ? cause.message : String(cause);
				return null;
			});
		try {
			if (outcome.error === null && !stopped()) {
				await this.#options.ask(
					this.#options.instructions(step, parallel, definitions),
					question,
					run,
					definitions.map((tool) => tool.name),
					(event) => {
						if (event.kind === "error") outcome.error = event.message;
						else if (event.kind === "text") outcome.text += event.text;
						else if (event.kind === "step") {
							check.last = { tool: event.tool, detail: event.detail };
							forward(event);
							this.#publish();
						} else if (event.kind === "usage") {
							const was = check.usage ?? { input: 0, output: 0, cached: 0 };
							check.usage = {
								input: was.input + event.input,
								output: was.output + event.output,
								cached: was.cached + event.cached,
							};
							forward(event);
						}
					},
					stopped,
				);
			}
		} finally {
			await run?.close();
		}
		const failed = outcome.error !== null || stopped();
		check.status = failed ? "failed" : "done";
		check.ended = this.#now();
		if (outcome.error !== null) {
			check.error = outcome.error.replace(/\s+/g, " ").trim().slice(0, 300);
		} else if (stopped()) check.error = this.#options.t.checksStopped;
		this.#publish();
		return failed ? null : outcome.text;
	}
}
