import type { Settings } from "./bridge.js";
import { DEFAULT_SETTINGS } from "./bridge.js";
import type { Strings } from "./i18n.js";
import type { SettingCategory } from "./settings-schema.js";
import { CATEGORY_LABELS, resettable, SETTING_DEFS } from "./settings-schema.js";

/**
 * The pages of the Settings window. Most are a category of the schema; the
 * assistant's category is long, so its MCP servers and its tools have pages
 * of their own. The categories stay what the assistant's permissions name
 * (`settings:assistant`): the pages only arrange the window.
 */
export type SettingPage = SettingCategory | "mcp" | "assistantTools";

type StringKey = keyof Strings;

export interface SettingGroup {
	/** Its heading in the list at the left; `null` for pages that stand on their own. */
	readonly label: StringKey | null;
	readonly pages: readonly SettingPage[];
}

/** The list at the left, in groups. */
export const SETTING_GROUPS: readonly SettingGroup[] = [
	{ label: "settingsGroupInterface", pages: ["appearance", "typography", "panels"] },
	{ label: "settingsGroupDocument", pages: ["editor", "page", "templates"] },
	{ label: "settingsCatAssistant", pages: ["assistant", "modes", "mcp", "assistantTools"] },
	{ label: null, pages: ["connections", "system"] },
];

export const SETTING_PAGES: readonly SettingPage[] = SETTING_GROUPS.flatMap((group) => group.pages);

/** Settings of the assistant's category that are shown on a page of their own. */
const MOVED: Partial<Record<keyof Settings, SettingPage>> = {
	assistantMcpServers: "mcp",
	assistantPermissions: "assistantTools",
	assistantToolPolicies: "assistantTools",
	assistantApprovals: "assistantTools",
	copilotTools: "assistantTools",
};

/** The page a setting is shown on. */
export function pageOf(key: keyof Settings): SettingPage {
	const moved = MOVED[key];
	if (moved !== undefined) return moved;
	return SETTING_DEFS.find((def) => def.key === key)?.category ?? "system";
}

/** The group a page is in. */
export const groupOf = (page: SettingPage): SettingGroup =>
	SETTING_GROUPS.find((group) => group.pages.includes(page)) ??
	(SETTING_GROUPS.at(-1) as SettingGroup);

/** A page's name in the list at the left. */
export function pageLabel(t: Strings, page: SettingPage): string {
	switch (page) {
		case "assistant":
			return t.settingsPageService;
		case "modes":
			return t.settingsPageModes;
		case "mcp":
			return t.mcpTitle;
		case "assistantTools":
			return t.settingsPageTools;
		default:
			return t[CATEGORY_LABELS[page]];
	}
}

/** A page's heading: the assistant's pages say they are the assistant's, as a search lists them all. */
export function pageTitle(t: Strings, page: SettingPage): string {
	const group = groupOf(page);
	return group.label === "settingsCatAssistant"
		? `${t[group.label]} › ${pageLabel(t, page)}`
		: pageLabel(t, page);
}

/** The settings a page's "Reset" puts back. */
export function pageResettable(page: SettingPage): (keyof Settings)[] {
	const categories = new Set(SETTING_DEFS.map((def) => def.category));
	const all = [...categories].flatMap((category) => resettable(category));
	return all.filter((key) => pageOf(key) === page);
}

/** The patch that puts a page's settings back as they were when the app was installed. */
export function pageResetPatch(page: SettingPage): Partial<Settings> {
	return Object.fromEntries(
		pageResettable(page).map((key) => [key, DEFAULT_SETTINGS[key]]),
	) as Partial<Settings>;
}

/** Whether two stored values are the same, whatever order an object's keys were written in. */
export function sameValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((each, index) => sameValue(each, b[index]));
	}
	const left = Object.keys(a);
	const right = Object.keys(b);
	return (
		left.length === right.length &&
		left.every(
			(key) =>
				Object.hasOwn(b, key) &&
				sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
		)
	);
}

/** The settings among `keys` that differ from their defaults. */
export const changedKeys = (
	settings: Settings,
	keys: readonly (keyof Settings)[],
): (keyof Settings)[] => keys.filter((key) => !sameValue(settings[key], DEFAULT_SETTINGS[key]));
