/**
 * A review run side by side: the rule checks first, then a reviewer (a CLI
 * process) for each check, all at once. Their findings reach the user as
 * they come, as one list; how each check is going (running, what it did
 * last, what it found, how long it took, what it cost, why it failed) is
 * sent along as it changes. A check that failed can be run again on its
 * own, after the answer too: its findings join the same list.
 */
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type { CheckProgress, ClaudeEvent } from "../shared/claude.js";
import type { Strings } from "../shared/i18n.js";
import type { ResolvedStep } from "../shared/mode-config.js";
import type { ReviewPlan } from "../shared/review-plan.js";
import { FindingMerger, reviewerQuestion } from "../shared/review-plan.js";
import type { ToolDefinition } from "../shared/tool-protocol.js";
import type { McpRun } from "./assistant-mcp.js";
import type { ToolContext, ToolResult } from "./assistant-tools.js";
import { allTools, runTool, toolsFor } from "./assistant-tools.js";

/** Tools a reviewer has no use for: it reads and reports, and Kalem runs the rules itself. */
const NOT_FOR_REVIEWERS: ReadonlySet<string> = new Set([
	"plan_update",
	"analysis_lint",
	"propose_edit",
	"app_state",
	"settings_get",
	"settings_find",
	"kalem_tools",
]);

export interface ReviewRunOptions {
	readonly plan: ReviewPlan;
	readonly t: Strings;
	/** The answer's own tools: the reviewers get the ones among them that only read. */
	readonly tools: ToolContext;
	/** The window the review was asked in: only it may run a check again. */
	readonly sender: WebContents;
	open(
		definitions: readonly ToolDefinition[],
		run: (name: string, input: unknown) => Promise<ToolResult>,
	): Promise<McpRun>;
	forward(event: ClaudeEvent): void;
	/** What a reviewer is told, for its part of the review and its tools. */
	instructions(modes: ReviewPlan["summary"], tools: readonly ToolDefinition[]): string;
	/** The question with the whole document in it. */
	readonly question: string;
	/** Runs one reviewer to its end; its events go to `send`. */
	ask(
		system: string,
		question: string,
		run: McpRun,
		tools: readonly string[],
		send: (event: ClaudeEvent) => void,
		stopped: () => boolean,
	): Promise<void>;
	/** The clock, for the tests. */
	now?(): number;
}

/** What the answer is told once the reviewers are done. */
export interface Reviewed {
	readonly checks: readonly string[];
	readonly failed: readonly string[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class ReviewRun {
	readonly id = randomUUID();
	readonly merger: FindingMerger;
	readonly sender: WebContents;
	readonly #options: ReviewRunOptions;
	readonly #checks: Mutable<CheckProgress>[];
	readonly #now: () => number;
	#question = "";
	#definitions: readonly ToolDefinition[] = [];

	constructor(options: ReviewRunOptions) {
		this.#options = options;
		this.sender = options.sender;
		this.merger = new FindingMerger(options.plan.maxFindings);
		this.#now = options.now ?? Date.now;
		const title = (step: ResolvedStep): string =>
			step.title ?? (step.titleKey === null ? step.id : options.t[step.titleKey]);
		this.#checks = options.plan.reviewers.map((reviewer) => ({
			title: reviewer.steps.map(title).join(", "),
			status: "running",
			started: 0,
			findings: 0,
		}));
	}

	/** How the checks are going, as the user sees them. */
	get checks(): readonly CheckProgress[] {
		return this.#checks.map((check) => ({ ...check }));
	}

	#publish(): void {
		this.#options.forward({
			kind: "checks",
			review: this.id,
			checks: this.checks,
			rules: this.#options.plan.lint,
		});
	}

	/** The answer's tool context with its own way to send events, and its own tools left out. */
	#derived(emit: (event: ClaudeEvent) => void, excluded: ReadonlySet<string>): ToolContext {
		const tools = this.#options.tools;
		return {
			...tools,
			excluded,
			emit,
			// What a reviewer read from Jira or Confluence counts for the answer too.
			get readExternal() {
				return tools.readExternal;
			},
			set readExternal(value: boolean) {
				tools.readExternal = value;
			},
		};
	}

	/** The tools a reviewer may call: the answer's tools that only read, less those it has no use for. */
	#reviewerExcluded(): ReadonlySet<string> {
		const allowed = new Set(
			toolsFor(this.#options.tools)
				.filter((tool) => tool.risk === "read" && !NOT_FOR_REVIEWERS.has(tool.definition.name))
				.map((tool) => tool.definition.name),
		);
		return new Set(
			allTools()
				.map((tool) => tool.definition.name)
				.filter((name) => !allowed.has(name)),
		);
	}

	/**
	 * The rules, then every reviewer at once. `null` when no reviewer could
	 * run: the review is then left to the answer itself.
	 */
	async run(stopped: () => boolean): Promise<Reviewed | null> {
		const { plan, forward } = this.#options;
		let lint = "";
		if (plan.lint) {
			const result = await runTool(
				"analysis_lint",
				{},
				this.#derived((event) => {
					if (event.kind !== "findings") return;
					this.merger.seed(event.findings);
					forward({ ...event, review: this.id });
				}, this.#options.tools.excluded),
			);
			if (!result.isError) lint = result.text;
		}
		const excluded = this.#reviewerExcluded();
		this.#definitions = toolsFor(this.#derived(() => {}, excluded)).map((tool) => tool.definition);
		if (!this.#definitions.some((tool) => tool.name === "report_findings")) return null;
		this.#question = reviewerQuestion(this.#options.question, lint);
		const before = this.merger.all.length;
		const failed = await Promise.all(
			plan.reviewers.map((_reviewer, index) => this.#review(index, stopped, true)),
		);
		// Nothing came of any of them: the CLI cannot be run this way.
		if (failed.every(Boolean) && this.merger.all.length === before) return null;
		const titles = this.#checks.map((check) => check.title);
		return { checks: titles, failed: titles.filter((_title, index) => failed[index] === true) };
	}

	/** Runs a check again that failed; its findings join the list. */
	async retry(index: number, stopped: () => boolean): Promise<void> {
		const check = this.#checks[index];
		if (check === undefined || check.status !== "failed" || this.#question === "") return;
		await this.#review(index, stopped, false);
	}

	/** Runs one reviewer; whether it failed. */
	async #review(index: number, stopped: () => boolean, live: boolean): Promise<boolean> {
		const reviewer = this.#options.plan.reviewers[index];
		const check = this.#checks[index];
		if (reviewer === undefined || check === undefined) return true;
		const { forward } = this.#options;
		Object.assign(check, { status: "running", started: this.#now(), findings: check.findings });
		delete check.ended;
		delete check.error;
		delete check.last;
		this.#publish();
		const context = this.#derived((event) => {
			if (event.kind !== "findings") return;
			const added = this.merger.add(event.findings);
			if (added.length === 0) return;
			check.findings += added.length;
			forward({ kind: "findings", findings: added, review: this.id });
			this.#publish();
		}, this.#reviewerExcluded());
		const outcome: { error: string | null } = { error: null };
		const run = await this.#options
			.open(this.#definitions, (name, input) => runTool(name, input, context))
			.catch((cause: unknown) => {
				outcome.error = cause instanceof Error ? cause.message : String(cause);
				return null;
			});
		if (run !== null) {
			try {
				if (!stopped()) {
					await this.#options.ask(
						this.#options.instructions(reviewer.modes, this.#definitions),
						this.#question,
						run,
						this.#definitions.map((tool) => tool.name),
						(event) => {
							if (event.kind === "error") outcome.error = event.message;
							else if (event.kind === "step") {
								check.last = { tool: event.tool, detail: event.detail };
								// The answer's own list of what was looked at has the reviewers' too.
								if (live) forward(event);
								this.#publish();
							} else if (event.kind === "usage") {
								const was = check.usage ?? { input: 0, output: 0, cached: 0 };
								check.usage = {
									input: was.input + event.input,
									output: was.output + event.output,
									cached: was.cached + event.cached,
								};
								if (live) forward(event);
							}
						},
						stopped,
					);
				}
			} finally {
				await run.close();
			}
		}
		const failed = outcome.error !== null || stopped();
		check.status = failed ? "failed" : "done";
		check.ended = this.#now();
		if (outcome.error !== null) {
			check.error = outcome.error.replace(/\s+/g, " ").trim().slice(0, 300);
		} else if (stopped()) check.error = this.#options.t.checksStopped;
		this.#publish();
		return failed;
	}
}

/** The latest review runs, to run a check of one again; older ones are forgotten. */
export class ReviewRuns {
	readonly #runs = new Map<string, ReviewRun>();
	readonly #max: number;

	constructor(max = 20) {
		this.#max = max;
	}

	add(run: ReviewRun): void {
		this.#runs.set(run.id, run);
		for (const id of this.#runs.keys()) {
			if (this.#runs.size <= this.#max) break;
			this.#runs.delete(id);
		}
	}

	/** The run, if the window asking is the one it was asked in. */
	get(id: unknown, sender: WebContents): ReviewRun | null {
		const run = typeof id === "string" ? this.#runs.get(id) : undefined;
		return run !== undefined && run.sender === sender ? run : null;
	}
}
