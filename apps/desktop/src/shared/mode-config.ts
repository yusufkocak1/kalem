/**
 * The assistant's modes as the user shapes them in Settings: each mode is
 * a few steps the model follows in order, which can be turned off,
 * reordered, rewritten, and added to; and a few options (how much detail,
 * the reply's language, more instructions, the words that choose it
 * automatically). A step that needs a tool leaves the tool out when it is
 * off. Untouched, a mode says what it always said. Pure.
 */
import type { Strings } from "./i18n.js";

export const MODES = ["ask", "write", "review", "prompt", "code", "app"] as const;
export type Mode = (typeof MODES)[number];

export const isMode = (value: unknown): value is Mode => MODES.includes(value as Mode);

type StringKey = keyof Strings;

/** A step as Kalem ships it: its name in the interface, what the model is told, the tool it needs. */
interface BuiltinStep {
	readonly id: string;
	readonly title: StringKey;
	readonly instruction: string;
	/** On unless the user turns it off; a step off by default is offered in Settings. */
	readonly on: boolean;
	/** A tool only this step uses: left out while the step is off. */
	readonly tool?: string;
}

/** What a mode opens with, before its steps. */
const INTRO: Readonly<Record<Mode, string>> = {
	ask: "",
	write: "## Mode: write an analysis document\nThe user is writing a software analysis document.",
	review:
		"## Mode: review an analysis document\nThe user wants the document reviewed before development starts.",
	prompt:
		"## Mode: prepare a prompt for a coding agent\nTurn the document (or the selected part) into a prompt a coding agent (Claude Code, Copilot, Junie) can act on without asking.",
	code: "## Mode: code\nThe user works on code.",
	app: "## Mode: use the app\nThe user wants something done in Kalem itself (a setting, a panel, a command).",
};

export const BUILTIN_STEPS: Readonly<Record<Mode, readonly BuiltinStep[]>> = {
	ask: [
		{
			id: "look-up",
			title: "stepLookUp",
			instruction:
				"When the answer depends on the document, the workspace, Jira or Confluence, look it up with the tools before answering; do not guess.",
			on: false,
		},
		{
			id: "cite",
			title: "stepCite",
			instruction: "Say where each fact comes from: a file and line, an issue key, a page title.",
			on: false,
		},
	],
	write: [
		{
			id: "outline",
			title: "stepOutline",
			instruction:
				"First agree on an outline with plan_update (call analysis_templates and analysis_template to follow the user's template; the user's own templates come first).",
			on: true,
		},
		{
			id: "gather",
			title: "stepGather",
			instruction:
				"Gather facts with the tools (the workspace's code, Jira issues, Confluence pages) before writing, and cite where they come from.",
			on: true,
		},
		{
			id: "sections",
			title: "stepSections",
			instruction:
				"Write each section and put it in the document with document_edit (or reply with it for the user to insert).",
			on: true,
		},
		{
			id: "no-invention",
			title: "stepNoInvention",
			instruction:
				"Never invent requirements: put what is unknown under the template's open questions.",
			on: true,
		},
		{
			id: "ids-criteria",
			title: "stepIdsCriteria",
			instruction:
				"Give requirements ids (as the template says, e.g. FR-01) and acceptance criteria that can be tested (Given/When/Then).",
			on: true,
		},
		{
			id: "self-check",
			title: "stepSelfCheck",
			instruction:
				"When a section is done, run analysis_lint and fix what it finds in what you wrote.",
			on: false,
			tool: "analysis_lint",
		},
	],
	review: [
		{
			id: "lint",
			title: "stepLint",
			instruction:
				"First call analysis_lint (it finds vague words, missing sections, requirements without acceptance criteria, duplicate ids).",
			on: true,
			tool: "analysis_lint",
		},
		{
			id: "scope",
			title: "stepScope",
			instruction:
				"Check the scope: that what is in and out is said, and that every requirement belongs to it.",
			on: true,
		},
		{
			id: "contradictions",
			title: "stepContradictions",
			instruction:
				"Read the document part by part and look for contradictions, and rules that the flows do not follow.",
			on: true,
		},
		{
			id: "edge-cases",
			title: "stepEdgeCases",
			instruction:
				"Look for missing error and edge cases (empty, too long, no permission, timeout, duplicate, concurrent change).",
			on: true,
		},
		{
			id: "testability",
			title: "stepTestability",
			instruction: "Look for requirements that cannot be measured or tested.",
			on: true,
		},
		{
			id: "security",
			title: "stepSecurity",
			instruction: "Look for missing security, privacy (personal data) and permission needs.",
			on: true,
		},
		{
			id: "code",
			title: "stepCodeCompare",
			instruction: "With a workspace, find where the code differs from the document.",
			on: true,
		},
		{
			id: "report",
			title: "stepReport",
			instruction:
				"Report every problem with report_findings: quote the exact text, say why it is a problem, suggest a fix and, when the answer must come from the business, a question.",
			on: true,
			tool: "report_findings",
		},
		{
			id: "summary",
			title: "stepSummary",
			instruction:
				"Then reply with a short summary (how ready it is for development, the most important problems); do not repeat each finding in the reply.",
			on: true,
		},
	],
	prompt: [
		{
			id: "goal",
			title: "stepGoal",
			instruction: "Include the goal, in one or two sentences.",
			on: true,
		},
		{
			id: "context",
			title: "stepContext",
			instruction: "Include the context: only the rules and terms that matter, with their ids.",
			on: true,
		},
		{
			id: "scope",
			title: "stepScope",
			instruction: "Include what is in and out of scope.",
			on: true,
		},
		{
			id: "code",
			title: "stepCodeFiles",
			instruction:
				"Include the code it will touch: find the files and their patterns with the workspace tools and name their paths.",
			on: true,
		},
		{
			id: "tests",
			title: "stepTests",
			instruction: "Include the acceptance criteria as test cases, the error cases too.",
			on: true,
		},
		{
			id: "constraints",
			title: "stepConstraints",
			instruction: "Include the constraints (performance, security, compatibility).",
			on: true,
		},
		{
			id: "hand-back",
			title: "stepHandBack",
			instruction: "Include what it should hand back (a plan first, tests, a PR description).",
			on: true,
		},
		{
			id: "format",
			title: "stepFormat",
			instruction:
				"Reply with the prompt alone in one fenced ```markdown block, then one line on what you assumed.",
			on: true,
		},
		{
			id: "save",
			title: "stepSave",
			instruction: "Offer save_prompt when the user wants it kept.",
			on: true,
			tool: "save_prompt",
		},
	],
	code: [
		{
			id: "read-first",
			title: "stepReadFirst",
			instruction: "Read before you answer (search, then read_file).",
			on: true,
		},
		{
			id: "cite",
			title: "stepCite",
			instruction: "Name files with their paths and lines.",
			on: true,
		},
		{
			id: "propose",
			title: "stepPropose",
			instruction: "Propose each change with propose_edit; the user reviews and applies it.",
			on: true,
			tool: "propose_edit",
		},
		{
			id: "keep-scope",
			title: "stepKeepScope",
			instruction: "Keep to what was asked and to the document's requirements when there is one.",
			on: true,
		},
	],
	app: [
		{
			id: "find",
			title: "stepFindSetting",
			instruction: "Find it with settings_find or kalem_tools.",
			on: true,
		},
		{
			id: "do",
			title: "stepDoIt",
			instruction: "Do it with the tool; say in one line what changed.",
			on: true,
		},
	],
};

/** Tools only some modes may have at all, whatever their steps. */
const ONLY_IN: Readonly<Record<string, readonly Mode[]>> = {
	report_findings: ["review"],
	analysis_lint: ["review", "write"],
	save_prompt: ["prompt", "code"],
	// Code is changed only where the user works on code.
	propose_edit: ["ask", "code"],
};

export const DETAILS = ["short", "normal", "detailed"] as const;
export type Detail = (typeof DETAILS)[number];
export const REPLY_LANGUAGES = ["auto", "tr", "en"] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];
export const SEVERITY_FLOORS = ["low", "medium", "high"] as const;
export type SeverityFloor = (typeof SEVERITY_FLOORS)[number];

/** A step as the user keeps it: one of Kalem's (by id, maybe rewritten) or one of their own. */
export interface StoredStep {
	readonly id: string;
	readonly on: boolean;
	/** The user's own step, or a rewritten one of Kalem's: its name and what the model is told. */
	readonly title?: string;
	readonly instruction?: string;
	readonly custom?: boolean;
}

/** A mode as the user shaped it; a missing field is the default. */
export interface StoredMode {
	/** Offered in the picker and by the automatic choice. */
	readonly enabled?: boolean;
	/** Its steps in the user's order; Kalem's steps left out are added at the end. */
	readonly steps?: readonly StoredStep[];
	readonly detail?: Detail;
	readonly language?: ReplyLanguage;
	/** More instructions, said after the steps. */
	readonly extra?: string;
	/** More words that choose it automatically. */
	readonly keywords?: readonly string[];
	/** Review: the least important findings reported. */
	readonly minSeverity?: SeverityFloor;
	/** Review: at most this many findings; 0 for no limit. */
	readonly maxFindings?: number;
}

export type ModeSettings = Readonly<Partial<Record<Mode, StoredMode>>>;

/** A step as it is used and shown: Kalem's or the user's, with its text resolved. */
export interface ResolvedStep {
	readonly id: string;
	readonly on: boolean;
	readonly custom: boolean;
	/** The user's name for it, or `null` for Kalem's own name (translated in the interface). */
	readonly title: string | null;
	readonly titleKey: StringKey | null;
	readonly instruction: string;
	/** The text Kalem ships, for a reset; empty for the user's own. */
	readonly defaultInstruction: string;
	readonly tool?: string;
}

export interface ResolvedMode {
	readonly mode: Mode;
	readonly enabled: boolean;
	readonly steps: readonly ResolvedStep[];
	readonly detail: Detail;
	readonly language: ReplyLanguage;
	readonly extra: string;
	readonly keywords: readonly string[];
	readonly minSeverity: SeverityFloor;
	readonly maxFindings: number;
}

const MAX_STEPS = 40;
const MAX_TEXT = 2000;

const clean = (value: unknown, max: number): string =>
	typeof value === "string" ? value.trim().slice(0, max) : "";

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
	values.includes(value as T) ? (value as T) : undefined;

/** The modes as the settings file holds them, validated: anything else is dropped. */
export function parseModeSettings(raw: unknown): ModeSettings {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const result: Partial<Record<Mode, StoredMode>> = {};
	for (const [name, value] of Object.entries(raw)) {
		if (!isMode(name) || typeof value !== "object" || value === null) continue;
		const stored = value as Record<string, unknown>;
		const seen = new Set<string>();
		const steps = Array.isArray(stored.steps)
			? stored.steps
					.flatMap((item): StoredStep[] => {
						if (typeof item !== "object" || item === null) return [];
						const step = item as Record<string, unknown>;
						const id = clean(step.id, 60);
						if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || seen.has(id)) return [];
						seen.add(id);
						const custom = step.custom === true;
						const title = clean(step.title, 120);
						const instruction = clean(step.instruction, MAX_TEXT);
						if (custom && instruction === "") return [];
						return [
							{
								id,
								on: step.on !== false,
								...(title === "" ? {} : { title }),
								...(instruction === "" ? {} : { instruction }),
								...(custom ? { custom: true } : {}),
							},
						];
					})
					.slice(0, MAX_STEPS)
			: undefined;
		const keywords = Array.isArray(stored.keywords)
			? [
					...new Set(stored.keywords.map((word) => clean(word, 60)).filter((word) => word !== "")),
				].slice(0, 50)
			: undefined;
		const detail = oneOf(DETAILS, stored.detail);
		const language = oneOf(REPLY_LANGUAGES, stored.language);
		const minSeverity = oneOf(SEVERITY_FLOORS, stored.minSeverity);
		const extra = clean(stored.extra, MAX_TEXT * 2);
		const maxFindings =
			typeof stored.maxFindings === "number" && Number.isFinite(stored.maxFindings)
				? Math.max(0, Math.min(200, Math.round(stored.maxFindings)))
				: undefined;
		result[name] = {
			...(typeof stored.enabled === "boolean" ? { enabled: stored.enabled } : {}),
			...(steps === undefined ? {} : { steps }),
			...(detail === undefined ? {} : { detail }),
			...(language === undefined ? {} : { language }),
			...(extra === "" ? {} : { extra }),
			...(keywords === undefined ? {} : { keywords }),
			...(minSeverity === undefined ? {} : { minSeverity }),
			...(maxFindings === undefined ? {} : { maxFindings }),
		};
	}
	return result;
}

/** A mode with the user's changes on Kalem's defaults. */
export function resolveMode(mode: Mode, settings: ModeSettings = {}): ResolvedMode {
	const stored = settings[mode] ?? {};
	const builtins = BUILTIN_STEPS[mode];
	const byId = new Map(builtins.map((step) => [step.id, step]));
	const steps: ResolvedStep[] = [];
	const placed = new Set<string>();
	for (const step of stored.steps ?? []) {
		const builtin = step.custom === true ? undefined : byId.get(step.id);
		if (builtin !== undefined) {
			placed.add(builtin.id);
			steps.push({
				id: builtin.id,
				on: step.on,
				custom: false,
				title: step.title ?? null,
				titleKey: builtin.title,
				instruction: step.instruction ?? builtin.instruction,
				defaultInstruction: builtin.instruction,
				...(builtin.tool === undefined ? {} : { tool: builtin.tool }),
			});
		} else if (step.custom === true && step.instruction !== undefined) {
			steps.push({
				id: step.id,
				on: step.on,
				custom: true,
				title: step.title ?? step.instruction.slice(0, 60),
				titleKey: null,
				instruction: step.instruction,
				defaultInstruction: "",
			});
		}
	}
	// Kalem's steps the user has not placed (new ones too) keep their default place at the end.
	for (const builtin of builtins) {
		if (placed.has(builtin.id)) continue;
		steps.push({
			id: builtin.id,
			on: builtin.on,
			custom: false,
			title: null,
			titleKey: builtin.title,
			instruction: builtin.instruction,
			defaultInstruction: builtin.instruction,
			...(builtin.tool === undefined ? {} : { tool: builtin.tool }),
		});
	}
	return {
		mode,
		enabled: stored.enabled ?? true,
		steps,
		detail: stored.detail ?? "normal",
		language: stored.language ?? "auto",
		extra: stored.extra ?? "",
		keywords: stored.keywords ?? [],
		minSeverity: stored.minSeverity ?? "low",
		maxFindings: stored.maxFindings ?? 0,
	};
}

/** A resolved mode as the settings keep it: only what differs from Kalem's defaults. */
export function storeMode(resolved: ResolvedMode): StoredMode {
	const defaults = resolveMode(resolved.mode);
	const sameSteps =
		resolved.steps.length === defaults.steps.length &&
		resolved.steps.every((step, index) => {
			const base = defaults.steps[index];
			return (
				base !== undefined &&
				!step.custom &&
				step.id === base.id &&
				step.on === base.on &&
				step.title === null &&
				step.instruction === base.instruction
			);
		});
	return {
		...(resolved.enabled ? {} : { enabled: false }),
		...(sameSteps
			? {}
			: {
					steps: resolved.steps.map((step) => ({
						id: step.id,
						on: step.on,
						...(step.custom || step.title !== null ? { title: step.title ?? "" } : {}),
						...(step.custom || step.instruction !== step.defaultInstruction
							? { instruction: step.instruction }
							: {}),
						...(step.custom ? { custom: true } : {}),
					})),
				}),
		...(resolved.detail === "normal" ? {} : { detail: resolved.detail }),
		...(resolved.language === "auto" ? {} : { language: resolved.language }),
		...(resolved.extra === "" ? {} : { extra: resolved.extra }),
		...(resolved.keywords.length === 0 ? {} : { keywords: resolved.keywords }),
		...(resolved.minSeverity === "low" ? {} : { minSeverity: resolved.minSeverity }),
		...(resolved.maxFindings === 0 ? {} : { maxFindings: resolved.maxFindings }),
	};
}

/** An id for a new step of the user's, not yet used in the mode. */
export function newStepId(resolved: ResolvedMode): string {
	const taken = new Set(resolved.steps.map((step) => step.id));
	for (let n = 1; ; n++) {
		const id = `custom-${n}`;
		if (!taken.has(id)) return id;
	}
}

/** The tools a mode leaves out: those of other modes, and those of its steps that are off. */
export function modeExcluded(mode: unknown, settings: ModeSettings = {}): ReadonlySet<string> {
	const current: Mode = isMode(mode) ? mode : "ask";
	const excluded = new Set(
		Object.entries(ONLY_IN)
			.filter(([, modes]) => !modes.includes(current))
			.map(([name]) => name),
	);
	const steps = resolveMode(current, settings).steps;
	for (const step of steps) {
		// A tool stays when another step that is on needs it.
		if (step.tool !== undefined && !step.on && !steps.some((s) => s.on && s.tool === step.tool)) {
			excluded.add(step.tool);
		}
	}
	return excluded;
}

const DETAIL_LINES: Readonly<Record<Detail, string>> = {
	short: "Keep the reply short: the essentials only, no preamble.",
	normal: "",
	detailed: "Be thorough: explain your reasoning and cover the details.",
};

const LANGUAGE_LINES: Readonly<Record<ReplyLanguage, string>> = {
	auto: "",
	tr: "Reply in Turkish.",
	en: "Reply in English.",
};

/** What the model is told about the mode it works in: its intro, its steps in order, its options. */
export function modeInstructions(mode: unknown, settings: ModeSettings = {}): string {
	const current: Mode = isMode(mode) ? mode : "ask";
	const resolved = resolveMode(current, settings);
	const steps = resolved.steps.filter((step) => step.on);
	const lines: string[] = [];
	if (steps.length > 0) {
		lines.push(
			INTRO[current] === "" ? "## How to answer" : "Work in these steps, in order:",
			...steps.map((step, index) => `${index + 1}. ${step.instruction}`),
		);
	}
	if (current === "review") {
		if (resolved.minSeverity !== "low") {
			lines.push(
				resolved.minSeverity === "high"
					? "Report only high-severity problems."
					: "Report only medium- and high-severity problems.",
			);
		}
		if (resolved.maxFindings > 0) {
			lines.push(`Report at most ${resolved.maxFindings} problems, the most important first.`);
		}
	}
	const detail = DETAIL_LINES[resolved.detail];
	if (detail !== "") lines.push(detail);
	const language = LANGUAGE_LINES[resolved.language];
	if (language !== "") lines.push(language);
	if (resolved.extra !== "") lines.push(resolved.extra);
	if (lines.length === 0) return INTRO[current];
	return [INTRO[current], ...lines].filter((part) => part !== "").join("\n");
}
