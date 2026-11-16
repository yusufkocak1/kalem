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
import type { McpServer } from "./mcp-servers.js";
import { serversNamed } from "./mcp-servers.js";
import type { Mode, ModeSettings, StoredMode } from "./mode-config.js";
import {
	isMode,
	MODES,
	modeExcluded,
	modeInstructions,
	resolveMode,
	storeMode,
} from "./mode-config.js";

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

/**
 * The modes a question is asked in: one, or several when the automatic mode
 * found the question asks for several kinds of work. A mode named twice
 * counts once; none is "ask".
 */
export function modeList(mode: unknown): readonly unknown[] {
	if (!Array.isArray(mode)) return [mode];
	const list = [...new Set(mode.filter((each) => typeof each === "string"))];
	return list.length === 0 ? ["ask"] : list;
}

/** What the request names: its several modes when it has them, else its one. */
export function requestedModes(request: {
	readonly mode?: unknown;
	readonly modes?: unknown;
}): unknown {
	const several = Array.isArray(request.modes) ? modeList(request.modes) : [];
	return several.length > 1 ? several : (several[0] ?? request.mode);
}

const SEVERAL =
	"## Several modes for this question\nThe question asks for several kinds of work. Do every part, each by the steps of the mode it belongs to (below), in the order the user asked for them, in this one reply, each part under its own heading. What an earlier part produced is what the later parts work on.";

/** What the model is told for a mode: one of Kalem's, as the user shaped it, or one of the user's. */
export function modePrompt(
	mode: unknown,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
): string {
	const one = (each: unknown): string => {
		const own = customModeOf(each, custom);
		return own === null ? modeInstructions(each, modes) : customInstructions(own);
	};
	const list = modeList(mode);
	if (list.length === 1) return one(list[0]);
	return [SEVERAL, ...list.map(one)].filter((part) => part !== "").join("\n\n");
}

/**
 * The tools a mode leaves out; for the user's own, every Kalem tool it did
 * not choose. Several modes leave out only what all of them do.
 */
export function modeToolsExcluded(
	mode: unknown,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
	allTools: readonly string[] = [],
): ReadonlySet<string> {
	const sets = modeList(mode).map((each): ReadonlySet<string> => {
		const own = customModeOf(each, custom);
		return own === null ? modeExcluded(each, modes) : customExcluded(own, allTools);
	});
	const [first = new Set<string>(), ...rest] = sets;
	return rest.length === 0
		? first
		: new Set([...first].filter((name) => rest.every((set) => set.has(name))));
}

/**
 * The names of the assistant's MCP servers a mode uses: one of Kalem's, as
 * the user shaped it, or one of the user's. Several modes use all of theirs.
 */
export function modeServerNames(
	mode: unknown,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
): readonly string[] {
	const names = modeList(mode).flatMap((each) => {
		const own = customModeOf(each, custom);
		return own !== null ? own.mcp : resolveMode(isMode(each) ? each : "ask", modes).mcp;
	});
	return [...new Set(names)];
}

/** The assistant's MCP servers a mode connects the CLI to. */
export function modeServers(
	mode: unknown,
	modes: ModeSettings = {},
	custom: readonly CustomMode[] = [],
	all: readonly McpServer[] = [],
): readonly McpServer[] {
	return serversNamed(modeServerNames(mode, modes, custom), all);
}

/** Every mode, Kalem's and the user's, by its name, with the servers it uses. */
export function modesUsingServers(
	t: Strings,
	modes: ModeSettings,
	custom: readonly CustomMode[],
): { readonly id: string; readonly name: string; readonly mcp: readonly string[] }[] {
	return [
		...MODES.map((mode) => ({
			id: mode as string,
			name: t[MODE_LABELS[mode]],
			mcp: resolveMode(mode, modes).mcp,
		})),
		...custom.map((mode) => ({ id: mode.id, name: mode.name, mcp: mode.mcp })),
	];
}

/**
 * The modes once a server of the assistant's is renamed (`to`) or removed
 * (`null`): each mode that used it uses it by its new name, or no longer.
 */
export function renameServerRefs(
	modes: ModeSettings,
	custom: readonly CustomMode[],
	from: string,
	to: string | null,
): { assistantModes: ModeSettings; assistantCustomModes: readonly CustomMode[] } {
	const swap = (names: readonly string[]): string[] =>
		names.flatMap((name) =>
			name !== from ? [name] : to === null || names.includes(to) ? [] : [to],
		);
	const assistantModes: Partial<Record<Mode, StoredMode>> = {};
	for (const mode of MODES) {
		const resolved = resolveMode(mode, modes);
		const stored = resolved.mcp.includes(from)
			? storeMode({ ...resolved, mcp: swap(resolved.mcp) })
			: modes[mode];
		if (stored !== undefined && Object.keys(stored).length > 0) assistantModes[mode] = stored;
	}
	return {
		assistantModes,
		assistantCustomModes: custom.map((mode) =>
			mode.mcp.includes(from) ? { ...mode, mcp: swap(mode.mcp) } : mode,
		),
	};
}
