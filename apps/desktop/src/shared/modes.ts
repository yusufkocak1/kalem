/**
 * The assistant's modes: what the user is doing with it now (asking,
 * writing an analysis, reviewing one, preparing a prompt for a coding
 * agent, working on code, using the app). A mode is a few steps the model
 * follows and the tools it leaves out; the user shapes them in Settings
 * (`mode-config.ts`). "auto" picks one for each question
 * (`mode-detect.ts`). Pure.
 */
import type { Strings } from "./i18n.js";
import type { Mode } from "./mode-config.js";

export type { Mode } from "./mode-config.js";
export { isMode, MODES, modeExcluded, modeInstructions } from "./mode-config.js";

export const MODE_LABELS: Readonly<Record<Mode, keyof Strings>> = {
	ask: "modeAsk",
	write: "modeWrite",
	review: "modeReview",
	prompt: "modePrompt",
	code: "modeCode",
	app: "modeApp",
};

/** What each mode is for, in a line, as the picker shows it. */
export const MODE_HINTS: Readonly<Record<Mode, keyof Strings>> = {
	ask: "modeAskHint",
	write: "modeWriteHint",
	review: "modeReviewHint",
	prompt: "modePromptHint",
	code: "modeCodeHint",
	app: "modeAppHint",
};

/** The picker's choices: a mode, or "auto" to pick one for each question. */
export type ModeChoice = Mode | "auto";
