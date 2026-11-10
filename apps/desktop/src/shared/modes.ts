/**
 * The assistant's modes: what the user is doing with it now (asking,
 * writing an analysis, reviewing one, preparing a prompt for a coding
 * agent, working on code, using the app). A mode is a few lines of
 * instructions and the tools it leaves out. Pure.
 */
import type { Strings } from "./i18n.js";

export const MODES = ["ask", "write", "review", "prompt", "code", "app"] as const;
export type Mode = (typeof MODES)[number];

export const isMode = (value: unknown): value is Mode => MODES.includes(value as Mode);

export const MODE_LABELS: Readonly<Record<Mode, keyof Strings>> = {
	ask: "modeAsk",
	write: "modeWrite",
	review: "modeReview",
	prompt: "modePrompt",
	code: "modeCode",
	app: "modeApp",
};

/** Tools only some modes need; the others are left out of a mode not listed. */
const ONLY_IN: Readonly<Record<string, readonly Mode[]>> = {
	report_findings: ["review"],
	analysis_lint: ["review", "write"],
	save_prompt: ["prompt", "code"],
	// Code is changed only where the user works on code.
	propose_edit: ["ask", "code"],
};

/** The tools a mode leaves out. */
export function modeExcluded(mode: unknown): ReadonlySet<string> {
	const current: Mode = isMode(mode) ? mode : "ask";
	return new Set(
		Object.entries(ONLY_IN)
			.filter(([, modes]) => !modes.includes(current))
			.map(([name]) => name),
	);
}

/** What the model is told about the mode it works in. */
export function modeInstructions(mode: unknown): string {
	switch (isMode(mode) ? mode : "ask") {
		case "write":
			return `## Mode: write an analysis document
The user is writing a software analysis document. Work section by section: first agree on an outline with plan_update (call analysis_templates and analysis_template to follow the user's template; the user's own templates come first), then write each section and put it in the document with document_edit (or reply with it for the user to insert). Gather facts with the tools (the workspace's code, Jira issues, Confluence pages) before writing, cite where they come from, and never invent requirements: put what is unknown under the template's open questions. Give requirements ids (as the template says, e.g. FR-01) and acceptance criteria that can be tested (Given/When/Then).`;
		case "review":
			return `## Mode: review an analysis document
The user wants the document reviewed before development starts. First call analysis_lint (it finds vague words, missing sections, requirements without acceptance criteria, duplicate ids). Then read the document part by part and look for what a rule cannot: contradictions, missing error and edge cases, rules that the flows do not follow, requirements that cannot be measured or tested, missing security, privacy and permission needs, and (with a workspace) where the code differs from the document. Report every problem with report_findings: quote the exact text, say why it is a problem, suggest a fix and, when the answer must come from the business, a question. Then reply with a short summary (how ready it is for development, the most important problems); do not repeat each finding in the reply.`;
		case "prompt":
			return `## Mode: prepare a prompt for a coding agent
Turn the document (or the selected part) into a prompt a coding agent (Claude Code, Copilot, Junie) can act on without asking. Include: the goal; the context and only the rules and terms that matter; what is in and out of scope; the code it will touch (find the files and their patterns with the workspace tools and name their paths); the acceptance criteria as test cases; constraints (performance, security, compatibility); and what it should hand back (a plan first, tests, a PR description). Reply with the prompt alone in one fenced \`\`\`markdown block, then one line on what you assumed. Offer save_prompt when the user wants it kept.`;
		case "code":
			return `## Mode: code
The user works on code. Read before you answer (search, then read_file), name files with their paths and lines, and propose each change with propose_edit; the user reviews and applies it. Keep to what was asked and to the document's requirements when there is one.`;
		case "app":
			return `## Mode: use the app
The user wants something done in Kalem itself (a setting, a panel, a command). Find it with settings_find or kalem_tools, then do it with the tool; say in one line what changed.`;
		default:
			return "";
	}
}
