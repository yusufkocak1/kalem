import type { Settings } from "./bridge.js";
import { DEFAULT_SETTINGS } from "./bridge.js";
import type { Strings } from "./i18n.js";
import { format } from "./i18n.js";
import type { SettingCategory } from "./settings-schema.js";
import { resettable, SETTING_DEFS } from "./settings-schema.js";

/**
 * The pages of the Settings window, in groups: what a setting is about (the
 * app as a whole, the window's look, the document, the assistant, the
 * services it connects to). A setting's category stays what the assistant's
 * permissions name (`settings:appearance`): the pages only arrange the
 * window, so what the user always allowed is kept.
 */
export type SettingPage =
	| "general"
	| "appearance"
	| "window"
	| "panels"
	| "documentView"
	| "typography"
	| "editor"
	| "page"
	| "assistant"
	| "modes"
	| "mcp"
	| "assistantTools"
	| "connections"
	| "proxy"
	| "extensions";

type StringKey = keyof Strings;

export interface SettingGroup {
	/** Its heading in the list at the left; `null` for pages that stand on their own. */
	readonly label: StringKey | null;
	readonly pages: readonly SettingPage[];
}

/** The list at the left, in groups. */
export const SETTING_GROUPS: readonly SettingGroup[] = [
	{ label: null, pages: ["general"] },
	{ label: "settingsGroupInterface", pages: ["appearance", "window", "panels"] },
	{ label: "settingsGroupDocument", pages: ["documentView", "typography", "editor", "page"] },
	{ label: "settingsCatAssistant", pages: ["assistant", "modes", "mcp", "assistantTools"] },
	{ label: "settingsCatConnections", pages: ["connections", "proxy"] },
	{ label: null, pages: ["extensions"] },
];

export const SETTING_PAGES: readonly SettingPage[] = SETTING_GROUPS.flatMap((group) => group.pages);

/** The page of a category's settings, unless one is put elsewhere (`MOVED`). */
const CATEGORY_PAGE: Readonly<Record<SettingCategory, SettingPage>> = {
	appearance: "appearance",
	typography: "typography",
	editor: "editor",
	panels: "panels",
	assistant: "assistant",
	modes: "modes",
	connections: "connections",
	page: "page",
	templates: "page",
	system: "general",
};

/** Settings shown on another page than their category's: where a person looks for them. */
const MOVED: Partial<Record<keyof Settings, SettingPage>> = {
	// The app as a whole, not its look.
	language: "general",
	// How the window is laid out: its title bar and its ribbon.
	tabsInTitleBar: "window",
	ribbonSimple: "window",
	// How the document is shown on the screen.
	zoom: "documentView",
	fullWidth: "documentView",
	lineNumbers: "documentView",
	codeLineNumbers: "documentView",
	documentMap: "documentView",
	typewriterScroll: "documentView",
	// Saving to Confluence is set up with Confluence.
	confluenceReviewBeforeSave: "connections",
	// Git, a connection of its own.
	proxyMode: "proxy",
	proxyServer: "proxy",
	proxyBypass: "proxy",
	// The assistant's panel takes a side as the other panels do: it is set up with them.
	assistant: "panels",
	assistantPlace: "panels",
	assistantWidth: "panels",
	assistantHeight: "panels",
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
	const category = SETTING_DEFS.find((def) => def.key === key)?.category;
	return category === undefined ? "general" : CATEGORY_PAGE[category];
}

/** The group a page is in. */
export const groupOf = (page: SettingPage): SettingGroup =>
	SETTING_GROUPS.find((group) => group.pages.includes(page)) ??
	(SETTING_GROUPS.at(-1) as SettingGroup);

const PAGE_LABELS: Readonly<Record<SettingPage, StringKey>> = {
	general: "settingsPageGeneral",
	appearance: "settingsPageThemeColors",
	window: "settingsPageWindow",
	panels: "settingsCatPanels",
	documentView: "settingsPageDocumentView",
	typography: "settingsCatTypography",
	editor: "settingsPageEditing",
	page: "settingsPagePageTemplates",
	assistant: "settingsPageService",
	modes: "settingsPageModes",
	mcp: "mcpTitle",
	assistantTools: "settingsPageTools",
	connections: "settingsPageConfluenceJira",
	proxy: "settingsPageProxy",
	extensions: "settingsPageExtensions",
};

/** A page's name in the list at the left. */
export const pageLabel = (t: Strings, page: SettingPage): string => t[PAGE_LABELS[page]];

/** A page's heading: with its group's name, as a search lists the pages of every group. */
export function pageTitle(t: Strings, page: SettingPage): string {
	const group = groupOf(page);
	return group.label === null ? pageLabel(t, page) : `${t[group.label]} › ${pageLabel(t, page)}`;
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

/**
 * What the user allows the assistant to change, a page at a time: the
 * settings as they are found in the window, so "always allow" on a change of
 * the theme covers Theme & Colours and not, as a category would, the
 * language too.
 */
export const pagePermission = (page: SettingPage): string => `settings/${page}`;

const isPage = (value: string): value is SettingPage =>
	SETTING_PAGES.includes(value as SettingPage);

/** The page a page permission names; `null` for another permission. */
export function permissionPage(permission: string): SettingPage | null {
	if (!permission.startsWith("settings/")) return null;
	const page = permission.slice("settings/".length);
	return isPage(page) ? page : null;
}

/**
 * Permissions kept by an earlier version, a category at a time
 * (`settings:appearance`), as page permissions. A page is allowed when the
 * old permissions covered every setting the assistant may change on it, so
 * nothing is allowed that was not before: a page that brings two categories
 * together (General: the language and the session) is asked about again
 * unless both were allowed. Permissions that already name a page, and the
 * others (the document, the commands), are kept as they are.
 */
export function migratePermissions(permissions: readonly string[]): string[] {
	const old = new Set<string>();
	const kept: string[] = [];
	for (const permission of permissions) {
		const name = permission.startsWith("settings:") ? permission.slice("settings:".length) : null;
		if (name === null || name.startsWith("sensitive:")) kept.push(permission);
		else old.add(name);
	}
	if (old.size === 0) return [...permissions];
	const pages = SETTING_PAGES.filter((page) => {
		// The modes' and the MCP servers' own tools asked by their page's name.
		if (old.has(page) && (page === "mcp" || page === "modes")) return true;
		const changeable = SETTING_DEFS.filter(
			(def) => pageOf(def.key) === page && def.assistant !== "hidden",
		);
		return changeable.length > 0 && changeable.every((def) => old.has(def.category));
	});
	return [...new Set([...kept, ...pages.map(pagePermission)])];
}

/** A kind of change the assistant may be allowed, as the user reads it. */
export function permissionLabel(t: Strings, permission: string): string {
	const page = permissionPage(permission);
	if (page !== null) return format(t.permissionSettings, pageTitle(t, page));
	if (permission === "view") return t.permissionView;
	if (permission === "commands") return t.permissionCommands;
	if (permission === "document") return t.permissionDocument;
	if (permission === "prompts") return t.permissionPrompts;
	return permission;
}
