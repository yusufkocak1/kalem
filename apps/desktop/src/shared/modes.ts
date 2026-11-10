/**
 * The assistant's modes: what the user is doing with it now (asking,
 * writing an analysis, reviewing one, preparing a prompt for a coding
 * agent, working on code, using the app). A mode is a few steps the model
 * follows and the tools it leaves out; the user shapes them in Settings
 * (`mode-config.ts`). "auto" picks one for each question
 * (`mode-detect.ts`). Pure.
 */
import type { CustomMode } from "./custom-modes.js";
import { customExcluded, customInstructions, isCustomModeId } from "./custom-modes.js";
import type { Strings } from "./i18n.js";
import type { Mode, ModeSettings } from "./mode-config.js";
import { modeExcluded, modeInstructions } from "./mode-config.js";

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

/** The picker's choices: one of Kalem's modes, one of the user's (`custom-…`), or "auto". */
export type ModeChoice = Mode | "auto" | string;

/** The user's mode a choice names; `null` for Kalem's modes, or one that is gone. */
export function customModeOf(mode: unknown, custom: readonly CustomMode[] = []): CustomMode | null {
	return isCustomModeId(mode) ? (custom.find((each) => each.id === mode) ?? null) : null;
}

/** What the model is told for a mode: one of Kalem's, as the user shaped it, or one of the user's. */
export function modePrompt(
	mode: unknown,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
): string {
	const own = customModeOf(mode, custom);
	return own === null ? modeInstructions(mode, modes) : customInstructions(own);
}

/** The tools a mode leaves out; for the user's own, every Kalem tool it did not choose. */
export function modeToolsExcluded(
	mode: unknown,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
	allTools: readonly string[] = [],
): ReadonlySet<string> {
	const own = customModeOf(mode, custom);
	return own === null ? modeExcluded(mode, modes) : customExcluded(own, allTools);
}
