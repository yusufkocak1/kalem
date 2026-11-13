/**
 * A review run side by side: each check of the review mode goes to a
 * reviewer of its own (a CLI process), all of them at once, and what they
 * find is put together into one list. The conversation itself then only
 * sums up. This says who checks what and what each is told; running them
 * is the main process's work. Pure.
 */
import type { Finding, FindingKind } from "./findings.js";
import type { ModeSettings, ResolvedMode, ResolvedStep } from "./mode-config.js";
import { resolveMode, storeMode } from "./mode-config.js";

/** At most this many reviewers run at once; more checks share them. */
export const MAX_REVIEWERS = 6;

/** The review's steps that are not checks: Kalem runs the rules itself, and the conversation sums up. */
const LINT = "lint";
const REPORT = "report";
const SUMMARY = "summary";
/** The check that needs code to compare with. */
const CODE = "code";

export interface Reviewer {
	/** The checks it makes: one, or a few when there are more checks than reviewers. */
	readonly steps: readonly ResolvedStep[];
	/** The modes with the review cut down to its checks and the report. */
	readonly modes: ModeSettings;
}

export interface ReviewPlan {
	/** Whether the rule checks run first. */
	readonly lint: boolean;
	readonly reviewers: readonly Reviewer[];
	/** The modes with the review cut down to its summary, for the conversation. */
	readonly summary: ModeSettings;
	/** Whether the user wants a summary at all. */
	readonly hasSummary: boolean;
	/** At most this many findings in all; 0 for no limit. */
	readonly maxFindings: number;
}

const REVIEWER_NOTE =
	"You are one of several reviewers reading this document at the same time, each with a check of its own: do only the check above and leave the rest to the others. Report problems with report_findings as you find them (you may call it more than once). The whole document is in the question: do not read it again with the tools. Do not change the document or anything else. When you are done, reply with one short line.";

const SUMMARY_NOTE =
	"The checks of this review were already made, side by side, and the user sees the findings in the review list: do not check the document again, and do not call report_findings or analysis_lint.";

function variant(
	settings: ModeSettings,
	resolved: ResolvedMode,
	keep: ReadonlySet<string>,
	note: string,
	maxFindings: number,
): ModeSettings {
	return {
		...settings,
		review: storeMode({
			...resolved,
			steps: resolved.steps.map((step) => ({ ...step, on: step.on && keep.has(step.id) })),
			extra: [note, resolved.extra].filter((part) => part !== "").join("\n"),
			maxFindings,
		}),
	};
}

/**
 * Who checks what; `null` when the review is to run as one answer: the
 * user turned this off, there is no report to put findings in, or there
 * are fewer than two checks to share out.
 */
export function reviewPlan(
	settings: ModeSettings,
	options: { readonly hasWorkspace: boolean },
): ReviewPlan | null {
	const resolved = resolveMode("review", settings);
	if (!resolved.parallel) return null;
	const on = resolved.steps.filter((step) => step.on);
	const builtin = (id: string): boolean => on.some((step) => !step.custom && step.id === id);
	if (!builtin(REPORT)) return null;
	const checks = on.filter(
		(step) =>
			step.custom ||
			(step.id !== LINT &&
				step.id !== REPORT &&
				step.id !== SUMMARY &&
				(step.id !== CODE || options.hasWorkspace)),
	);
	if (checks.length < 2) return null;
	const groups: ResolvedStep[][] = [];
	checks.forEach((step, index) => {
		if (index < MAX_REVIEWERS) groups.push([step]);
		else groups[index % MAX_REVIEWERS]?.push(step);
	});
	const each =
		resolved.maxFindings === 0 ? 0 : Math.max(1, Math.ceil(resolved.maxFindings / groups.length));
	return {
		lint: builtin(LINT),
		reviewers: groups.map((steps) => ({
			steps,
			modes: variant(
				settings,
				resolved,
				new Set([...steps.map((step) => step.id), REPORT]),
				REVIEWER_NOTE,
				each,
			),
		})),
		summary: variant(settings, resolved, new Set([SUMMARY]), SUMMARY_NOTE, 0),
		hasSummary: builtin(SUMMARY),
		maxFindings: resolved.maxFindings,
	};
}

/** Kinds that are about how a sentence is worded: two reviewers often report the same sentence under two of them. */
const WORDING: ReadonlySet<FindingKind> = new Set([
	"ambiguity",
	"testability",
	"consistency",
	"missing",
	"other",
]);

const squeeze = (text: string): string => text.replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");

/**
 * The reviewers' findings as one list: numbered in the order they come,
 * the same problem reported twice kept once, and no more than the user
 * wants.
 */
export class FindingMerger {
	readonly #max: number;
	readonly #quotes = new Map<string, FindingKind[]>();
	readonly #problems = new Set<string>();
	readonly #all: Finding[] = [];
	#count = 0;

	constructor(maxFindings = 0) {
		this.#max = maxFindings;
	}

	/** Every finding so far, the rules' included. */
	get all(): readonly Finding[] {
		return this.#all;
	}

	#isNew(finding: Finding): boolean {
		const quote = squeeze(finding.quote);
		if (quote === "") {
			const key = `${finding.kind}\n${squeeze(finding.section)}\n${squeeze(finding.problem)}`;
			if (this.#problems.has(key)) return false;
			this.#problems.add(key);
			return true;
		}
		const kinds = this.#quotes.get(quote) ?? [];
		const twice = kinds.some(
			(kind) => kind === finding.kind || (WORDING.has(kind) && WORDING.has(finding.kind)),
		);
		if (twice) return false;
		this.#quotes.set(quote, [...kinds, finding.kind]);
		return true;
	}

	/**
	 * Findings the rules made, kept as they are. A reviewer is told of them
	 * and asked not to repeat them; what it reports about the same sentence
	 * all the same stays, as it may say more (a fix, a question).
	 */
	seed(findings: readonly Finding[]): void {
		this.#all.push(...findings);
	}

	/** A reviewer's findings: the new ones among them, numbered. */
	add(findings: readonly Finding[]): Finding[] {
		const added: Finding[] = [];
		for (const finding of findings) {
			if (this.#max > 0 && this.#count >= this.#max) break;
			if (!this.#isNew(finding)) continue;
			this.#count += 1;
			const numbered = { ...finding, id: `F-${String(this.#count).padStart(2, "0")}` };
			added.push(numbered);
			this.#all.push(numbered);
		}
		return added;
	}
}

const tag = (text: string): string => text.replace(/\s+/g, " ").trim();

/** What a reviewer is asked: the question with the document, and what the rules found already. */
export function reviewerQuestion(prompt: string, lint: string): string {
	if (lint.trim() === "") return prompt;
	return `${prompt}\n\n<already-found>\nKalem's rule checks found these and the user sees them: do not report them again.\n${lint.trim()}\n</already-found>`;
}

/** What the conversation is asked once the reviewers are done: the question, and what they found. */
export function summaryQuestion(
	asked: string,
	options: {
		readonly findings: readonly Finding[];
		/** The checks that were made, by name. */
		readonly checks: readonly string[];
		/** The checks that could not be made. */
		readonly failed: readonly string[];
		readonly hasSummary: boolean;
	},
): string {
	const lines = options.findings.map((finding) => {
		const where = finding.section === "" ? "" : ` §${tag(finding.section)}`;
		const quote = finding.quote === "" ? "" : ` — "${tag(finding.quote).slice(0, 200)}"`;
		return `${finding.id} [${finding.severity}, ${finding.kind}]${where}: ${tag(finding.problem).slice(0, 400)}${quote}`;
	});
	const parts = [
		asked,
		`<review-findings checks="${options.checks.map(tag).join("; ").replace(/"/g, "'")}">\n${
			lines.length === 0 ? "No problems were found." : lines.join("\n")
		}\n</review-findings>`,
	];
	if (options.failed.length > 0) {
		parts.push(`These checks could not be made, say so: ${options.failed.map(tag).join("; ")}.`);
	}
	if (!options.hasSummary) {
		parts.push(
			"Reply with one short line: the review is done, and how many findings are in the review list.",
		);
	}
	return parts.join("\n\n");
}
