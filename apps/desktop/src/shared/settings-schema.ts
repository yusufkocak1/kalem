/**
 * Every setting of the app described once: its category in the Settings
 * window, the values it takes, the words it is found by, and what the
 * assistant may do with it. The stored file is validated from it, the
 * Settings window is built from it, and the assistant reads it to find a
 * setting without having every setting in its prompt. Pure.
 */
import type { ConfluenceFavorite, JiraFavorite, Settings } from "./bridge.js";
import {
	DEFAULT_SETTINGS,
	MAX_ASSISTANT_WIDTH,
	MAX_NAVIGATION_WIDTH,
	MAX_ZOOM,
	MIN_ASSISTANT_WIDTH,
	MIN_NAVIGATION_WIDTH,
	MIN_ZOOM,
	PAGE_MARGINS,
	PAGE_SIZES,
	ZOOM_STEP,
} from "./bridge.js";
import { parseCustomModes } from "./custom-modes.js";
import { groupName } from "./favorites.js";
import type { Strings } from "./i18n.js";
import { format } from "./i18n.js";
import { parseIssueLayout } from "./jira-layout.js";
import { liftModeServers, parseMcpServers } from "./mcp-servers.js";
import { DEFAULT_MODE_SERVERS, isMode, parseModeSettings } from "./mode-config.js";
/** The Settings window's categories, in its order. */
import { PALETTE_IDS, parsePaletteCustom } from "./palette.js";
import { MAX_DOCK_SIZE, MIN_DOCK_SIZE, parsePanePlaces, TOOL_PANES } from "./panes.js";
import { SPEC_PROFILE_CHOICES } from "./spec-export.js";
import { parseToolPolicies } from "./tool-protocol.js";
import { DOCUMENT_FONTS, TYPOGRAPHY_RANGES } from "./typography.js";
export const SETTING_CATEGORIES = [
	"appearance",
	"typography",
	"editor",
	"panels",
	"assistant",
	"modes",
	"connections",
	"page",
	"templates",
	"system",
] as const;
export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

/**
 * What the assistant may do with a setting: read it, change it (always
 * with the user's approval), or not see it at all (paths of programs it
 * would run, lists that are the user's own data).
 */
export type AssistantAccess = "read" | "write" | "hidden";

type StringKey = keyof Strings;

interface BaseDef {
	readonly key: keyof Settings;
	readonly category: SettingCategory;
	/** Its name in the interface; `null` for one the Settings window does not show on its own row. */
	readonly label: StringKey | null;
	/** More words it is found by, in both languages: "koyu" and "dark" find the theme. */
	readonly keywords: readonly string[];
	readonly assistant: AssistantAccess;
}

export interface BooleanDef extends BaseDef {
	readonly type: "boolean";
}

export interface EnumDef extends BaseDef {
	readonly type: "enum";
	readonly values: readonly unknown[];
	/** Each value's name in the interface, in the order of `values`; the value itself when missing. */
	readonly valueLabels?: readonly (StringKey | null)[];
}

export interface NumberDef extends BaseDef {
	readonly type: "number";
	readonly min: number;
	readonly max: number;
	/** Values are rounded to a multiple of it. */
	readonly step: number;
}

export interface StringDef extends BaseDef {
	readonly type: "string";
	readonly maxLength: number;
}

/** A value with a shape of its own (where the panes dock, favorites), read by its own parser. */
export interface CustomDef extends BaseDef {
	readonly type: "custom";
	parse(raw: unknown): unknown;
}

export type SettingDef = BooleanDef | EnumDef | NumberDef | StringDef | CustomDef;

/** Each setting's description under its own name; enum values must be the setting's own. */
type Schema = {
	readonly [K in keyof Settings]: SettingDef & { readonly key: K } & (
			| { readonly type: "boolean" | "number" | "string" | "custom" }
			| { readonly type: "enum"; readonly values: readonly Settings[K][] }
		);
};

const MAX_FAVORITES = 200;

export function parseConfluenceFavorites(value: unknown): ConfluenceFavorite[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value
		.flatMap((item): ConfluenceFavorite[] => {
			if (typeof item !== "object" || item === null) return [];
			const { site, id, title, group } = item as Record<string, unknown>;
			if (typeof site !== "string" || typeof id !== "string" || !/^\d+$/.test(id)) return [];
			const key = `${site}\n${id}`;
			if (seen.has(key)) return [];
			seen.add(key);
			const name = groupName(group);
			return [
				{
					site,
					id,
					title: typeof title === "string" ? title.slice(0, 500) : "",
					...(name === null ? {} : { group: name }),
				},
			];
		})
		.slice(0, MAX_FAVORITES);
}

/** The pinned documents: absolute paths, each once, at most a few dozen. */
export function parsePinnedFiles(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const paths = value.filter(
		(item): item is string =>
			typeof item === "string" &&
			item !== "" &&
			item.length < 4096 &&
			/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(item),
	);
	return [...new Set(paths)].slice(0, 30);
}

export function parseTrustedFolders(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const paths = value.filter(
		(item): item is string =>
			typeof item === "string" &&
			item.length < 4096 &&
			/^(\/|[A-Za-z]:[\\/])/.test(item) &&
			!item.startsWith("//"),
	);
	return [...new Set(paths)].slice(0, 500);
}

export function parseJiraFavorites(value: unknown): JiraFavorite[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value
		.flatMap((item): JiraFavorite[] => {
			if (typeof item !== "object" || item === null) return [];
			const { site, key, summary, type } = item as Record<string, unknown>;
			if (typeof site !== "string" || typeof key !== "string") return [];
			if (!/^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key)) return [];
			const id = `${site}\n${key}`;
			if (seen.has(id)) return [];
			seen.add(id);
			return [
				{
					site,
					key,
					summary: typeof summary === "string" ? summary.slice(0, 500) : "",
					type: typeof type === "string" ? type.slice(0, 100) : "",
				},
			];
		})
		.slice(0, MAX_FAVORITES);
}

/** The kinds of change allowed always: short names, no repeats. */
export function parsePermissions(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value.filter(
				(item): item is string => typeof item === "string" && /^[a-z][a-z:-]{0,63}$/.test(item),
			),
		),
	].slice(0, 100);
}

const PANE_LABELS = ["outlineTab", "filesTab", "confluenceTab", "jiraTab"] as const;

const dockSize = <K extends "rightWidth" | "bottomHeight">(
	key: K,
	label: StringKey,
	keywords: readonly string[],
): NumberDef & { readonly key: K } => ({
	key,
	category: "panels",
	label,
	type: "number",
	min: MIN_DOCK_SIZE,
	max: MAX_DOCK_SIZE,
	step: 1,
	keywords,
	assistant: "write",
});

const dockPane = <K extends "sidePane" | "rightPane" | "bottomPane">(
	key: K,
): EnumDef & { readonly key: K; readonly values: typeof TOOL_PANES } => ({
	key,
	category: "panels",
	label: null,
	type: "enum",
	values: TOOL_PANES,
	valueLabels: PANE_LABELS,
	keywords: [],
	assistant: "write",
});

/** Every setting, keyed by name; the type makes sure none is left out. */
export const SETTINGS_SCHEMA: Schema = {
	theme: {
		key: "theme",
		category: "appearance",
		label: "theme",
		type: "enum",
		values: ["system", "light", "dark"],
		valueLabels: ["themeSystem", "themeLight", "themeDark"],
		keywords: ["tema", "theme", "koyu", "dark", "açık", "light", "gece", "night", "renk", "color"],
		assistant: "write",
	},
	palette: {
		key: "palette",
		category: "appearance",
		label: null,
		type: "enum",
		values: [...PALETTE_IDS, "custom"],
		valueLabels: [
			"paletteKalem",
			"paletteOcean",
			"paletteForest",
			"paletteSunset",
			"paletteViolet",
			"paletteGraphite",
			"paletteRose",
			"paletteSand",
			"paletteNord",
			"paletteMidnight",
			"paletteCustom",
		],
		keywords: ["renk paleti", "palette", "renk", "color", "colour", "vurgu", "accent", "tema"],
		assistant: "write",
	},
	paletteCustom: {
		key: "paletteCustom",
		category: "appearance",
		label: null,
		type: "custom",
		parse: parsePaletteCustom,
		keywords: [],
		assistant: "hidden",
	},
	language: {
		key: "language",
		category: "appearance",
		label: "language",
		type: "enum",
		values: [null, "tr", "en"],
		valueLabels: ["languageSystem", null, null],
		keywords: ["dil", "language", "türkçe", "turkish", "ingilizce", "english", "arayüz"],
		assistant: "write",
	},
	zoom: {
		key: "zoom",
		category: "appearance",
		label: "zoom",
		type: "number",
		min: MIN_ZOOM,
		max: MAX_ZOOM,
		step: ZOOM_STEP,
		keywords: ["yakınlaştır", "zoom", "büyüt", "küçült", "yazı boyutu", "font size", "ölçek"],
		assistant: "write",
	},
	fullWidth: {
		key: "fullWidth",
		category: "appearance",
		label: "fullWidth",
		type: "boolean",
		keywords: ["tam genişlik", "full width", "geniş", "wide", "sayfa genişliği"],
		assistant: "write",
	},
	lineNumbers: {
		key: "lineNumbers",
		category: "appearance",
		label: "lineNumbersDocuments",
		type: "boolean",
		keywords: [
			"satır numarası",
			"satır numaraları",
			"line numbers",
			"satır",
			"line",
			"numara",
			"belge",
		],
		assistant: "write",
	},
	// Set by the first start's question (or View → Set Kalem Up For…), which applies its presets.
	role: {
		key: "role",
		category: "appearance",
		label: null,
		type: "enum",
		values: ["", "writer", "analyst", "developer"],
		valueLabels: ["roleNone", "roleWriter", "roleAnalyst", "roleDeveloper"],
		keywords: ["rol", "role"],
		assistant: "read",
	},
	typewriterScroll: {
		key: "typewriterScroll",
		category: "appearance",
		label: "typewriterScroll",
		type: "boolean",
		keywords: ["daktilo", "typewriter", "odak", "focus", "ortala", "center", "kaydırma", "scroll"],
		assistant: "write",
	},
	tabsInTitleBar: {
		key: "tabsInTitleBar",
		category: "appearance",
		label: "tabsInTitleBar",
		type: "boolean",
		keywords: [
			"başlık çubuğu",
			"title bar",
			"sekme",
			"tab",
			"pencere",
			"window",
			"çerçeve",
			"frame",
		],
		assistant: "write",
	},
	ribbonSimple: {
		key: "ribbonSimple",
		category: "appearance",
		label: "ribbonSimple",
		type: "boolean",
		keywords: [
			"şerit",
			"ribbon",
			"sade",
			"simple",
			"simplified",
			"basit",
			"araç çubuğu",
			"toolbar",
		],
		assistant: "write",
	},
	codeLineNumbers: {
		key: "codeLineNumbers",
		category: "appearance",
		label: "lineNumbersCode",
		type: "boolean",
		keywords: [
			"satır numarası",
			"satır numaraları",
			"line numbers",
			"kod",
			"code",
			"metin dosyası",
			"text file",
			"kaynak",
			"source",
		],
		assistant: "write",
	},
	lineSpacing: {
		key: "lineSpacing",
		category: "typography",
		label: "typoLineSpacing",
		type: "number",
		...TYPOGRAPHY_RANGES.lineSpacing,
		keywords: [
			"satır aralığı",
			"satır arası",
			"line spacing",
			"line height",
			"aralık",
			"satır yüksekliği",
		],
		assistant: "write",
	},
	paragraphSpacing: {
		key: "paragraphSpacing",
		category: "typography",
		label: "typoParagraphSpacing",
		type: "number",
		...TYPOGRAPHY_RANGES.paragraphSpacing,
		keywords: ["paragraf aralığı", "paragraf arası", "paragraph spacing", "boşluk", "spacing"],
		assistant: "write",
	},
	headingSpacing: {
		key: "headingSpacing",
		category: "typography",
		label: "typoHeadingSpacing",
		type: "number",
		...TYPOGRAPHY_RANGES.headingSpacing,
		keywords: ["başlık", "başlık üstü", "heading spacing", "heading", "boşluk"],
		assistant: "write",
	},
	listSpacing: {
		key: "listSpacing",
		category: "typography",
		label: "typoListSpacing",
		type: "number",
		...TYPOGRAPHY_RANGES.listSpacing,
		keywords: ["liste", "madde", "list spacing", "list", "boşluk"],
		assistant: "write",
	},
	documentFont: {
		key: "documentFont",
		category: "typography",
		label: "typoFont",
		type: "enum",
		values: DOCUMENT_FONTS,
		valueLabels: [
			"typoFontDefault",
			"typoFontSans",
			"typoFontSerif",
			"typoFontWord",
			"typoFontMono",
		],
		keywords: ["yazı tipi", "font", "typeface", "serif", "calibri", "yazı"],
		assistant: "write",
	},
	documentFontSize: {
		key: "documentFontSize",
		category: "typography",
		label: "typoFontSize",
		type: "number",
		...TYPOGRAPHY_RANGES.documentFontSize,
		keywords: ["yazı boyutu", "punto", "font size", "text size", "büyüklük"],
		assistant: "write",
	},
	pageWidth: {
		key: "pageWidth",
		category: "typography",
		label: "typoPageWidth",
		type: "number",
		...TYPOGRAPHY_RANGES.pageWidth,
		keywords: ["sayfa genişliği", "metin genişliği", "page width", "text width", "genişlik"],
		assistant: "write",
	},
	autoSave: {
		key: "autoSave",
		category: "editor",
		label: "autoSave",
		type: "boolean",
		keywords: ["otomatik kaydet", "auto save", "kaydet", "save"],
		assistant: "write",
	},
	spellCheck: {
		key: "spellCheck",
		category: "editor",
		label: "spellCheck",
		type: "boolean",
		keywords: ["yazım denetimi", "spell check", "imla", "spelling"],
		assistant: "write",
	},
	navigation: {
		key: "navigation",
		category: "panels",
		label: "settingsLeftDock",
		type: "boolean",
		keywords: ["gezinti", "navigation", "sol panel", "left", "kenar çubuğu", "sidebar"],
		assistant: "write",
	},
	sidePane: dockPane("sidePane"),
	navigationWidth: {
		key: "navigationWidth",
		category: "panels",
		label: "settingsLeftWidth",
		type: "number",
		min: MIN_NAVIGATION_WIDTH,
		max: MAX_NAVIGATION_WIDTH,
		step: 1,
		keywords: ["genişlik", "width", "sol", "left"],
		assistant: "write",
	},
	panePlaces: {
		key: "panePlaces",
		category: "panels",
		label: null,
		type: "custom",
		parse: parsePanePlaces,
		keywords: ["panel", "pane", "taşı", "move", "dock", "yerleşim", "layout", "jira", "confluence"],
		assistant: "write",
	},
	rightDock: {
		key: "rightDock",
		category: "panels",
		label: "settingsRightDock",
		type: "boolean",
		keywords: ["sağ panel", "right", "dock"],
		assistant: "write",
	},
	rightPane: dockPane("rightPane"),
	rightWidth: dockSize("rightWidth", "settingsRightWidth", ["genişlik", "width", "sağ", "right"]),
	bottomDock: {
		key: "bottomDock",
		category: "panels",
		label: "settingsBottomDock",
		type: "boolean",
		keywords: ["alt panel", "bottom", "dock"],
		assistant: "write",
	},
	bottomPane: dockPane("bottomPane"),
	bottomHeight: dockSize("bottomHeight", "settingsBottomHeight", [
		"yükseklik",
		"height",
		"alt",
		"bottom",
	]),
	assistant: {
		key: "assistant",
		category: "assistant",
		label: "settingsAssistantPane",
		type: "boolean",
		keywords: ["asistan", "assistant", "yapay zeka", "ai", "claude", "copilot", "panel"],
		assistant: "write",
	},
	assistantDocument: {
		key: "assistantDocument",
		category: "assistant",
		label: "settingsAssistantDocument",
		type: "boolean",
		keywords: ["belgeyi paylaş", "share document", "bağlam", "context"],
		assistant: "write",
	},
	assistantEditReview: {
		key: "assistantEditReview",
		category: "assistant",
		label: "settingsEditReview",
		type: "boolean",
		keywords: [
			"kabul",
			"accept",
			"reddet",
			"reject",
			"geri al",
			"değişiklik",
			"change",
			"öneri",
			"suggestion",
			"track changes",
		],
		assistant: "read",
	},
	assistantPlace: {
		key: "assistantPlace",
		category: "assistant",
		label: "settingsAssistantPlace",
		type: "enum",
		values: ["right", "left", "bottom"],
		valueLabels: ["placeRight", "placeLeft", "placeBottom"],
		keywords: [
			"asistan",
			"assistant",
			"panel",
			"taşı",
			"move",
			"sol",
			"sağ",
			"alt",
			"left",
			"right",
			"bottom",
			"yer",
		],
		assistant: "write",
	},
	assistantHeight: {
		key: "assistantHeight",
		category: "assistant",
		label: "settingsAssistantHeight",
		type: "number",
		min: MIN_DOCK_SIZE,
		max: MAX_DOCK_SIZE,
		step: 1,
		keywords: ["yükseklik", "height", "asistan", "assistant"],
		assistant: "write",
	},
	assistantWidth: {
		key: "assistantWidth",
		category: "assistant",
		label: "settingsAssistantWidth",
		type: "number",
		min: MIN_ASSISTANT_WIDTH,
		max: MAX_ASSISTANT_WIDTH,
		step: 1,
		keywords: ["genişlik", "width", "asistan", "assistant"],
		assistant: "write",
	},
	claudePath: {
		key: "claudePath",
		category: "assistant",
		label: null,
		type: "string",
		maxLength: 4096,
		keywords: [],
		assistant: "hidden",
	},
	copilotPath: {
		key: "copilotPath",
		category: "assistant",
		label: null,
		type: "string",
		maxLength: 4096,
		keywords: [],
		assistant: "hidden",
	},
	assistantPermissions: {
		key: "assistantPermissions",
		category: "assistant",
		label: null,
		type: "custom",
		parse: parsePermissions,
		keywords: ["izin", "permission", "onay", "approval", "her zaman"],
		// The assistant may never widen what it is allowed.
		assistant: "hidden",
	},
	assistantToolPolicies: {
		key: "assistantToolPolicies",
		category: "assistant",
		label: null,
		type: "custom",
		parse: parseToolPolicies,
		keywords: [
			"araç",
			"araçlar",
			"tool",
			"tools",
			"onay",
			"approval",
			"kapalı",
			"off",
			"jira",
			"confluence",
		],
		// The assistant may never widen what it is allowed.
		assistant: "hidden",
	},
	assistantApprovals: {
		key: "assistantApprovals",
		category: "assistant",
		label: "settingsAssistantApprovals",
		type: "enum",
		values: ["ask", "edits", "all"],
		valueLabels: ["approvalsAsk", "approvalsEdits", "approvalsAll"],
		keywords: [
			"onay",
			"approval",
			"izin",
			"permission",
			"bypass",
			"otomatik",
			"auto",
			"tümünü onayla",
			"approve all",
			"terminal",
			"komut",
			"command",
		],
		// The assistant may never widen what it is allowed.
		assistant: "hidden",
	},
	copilotTools: {
		key: "copilotTools",
		category: "assistant",
		label: "settingsCopilotTools",
		type: "enum",
		values: ["auto", "mcp", "block"],
		valueLabels: ["copilotToolsAuto", "copilotToolsMcp", "copilotToolsBlock"],
		keywords: ["copilot", "mcp", "araç", "tool", "blok", "block"],
		assistant: "read",
	},
	assistantModes: {
		key: "assistantModes",
		category: "modes",
		label: null,
		type: "custom",
		parse: parseModeSettings,
		keywords: [
			"mod",
			"mode",
			"adım",
			"step",
			"inceleme",
			"review",
			"lint",
			"kapsam",
			"scope",
			"otomatik",
			"automatic",
			"analiz",
			"prompt",
		],
		assistant: "read",
	},
	assistantCustomModes: {
		key: "assistantCustomModes",
		category: "modes",
		label: null,
		type: "custom",
		parse: parseCustomModes,
		keywords: ["özel mod", "custom mode", "mcp", "araç", "tool", "prompt", "sunucu", "server"],
		// It can run programs on this computer (an MCP server's command): never the assistant's to change.
		assistant: "hidden",
	},
	assistantMcpServers: {
		key: "assistantMcpServers",
		category: "assistant",
		label: null,
		type: "custom",
		parse: parseMcpServers,
		keywords: ["mcp", "sunucu", "server", "araç", "tool", "dbhub", "github", "context7"],
		// It runs programs on this computer: changed only by the user, or with the mode_mcp tools.
		assistant: "hidden",
	},
	specProfile: {
		key: "specProfile",
		category: "templates",
		label: "settingsSpecProfile",
		type: "enum",
		values: [...SPEC_PROFILE_CHOICES],
		valueLabels: ["specProfileAuto", "specProfileSpecKit", "specProfileKiro", "specProfileKalem"],
		keywords: ["spec", "spec kit", "kiro", "tasks.md", "ajan", "agent", "görev", "task", "prompt"],
		assistant: "write",
	},
	defaultTemplate: {
		key: "defaultTemplate",
		category: "templates",
		label: null,
		type: "string",
		maxLength: 4096,
		keywords: ["şablon", "template", "analiz", "analysis", "varsayılan", "default"],
		assistant: "read",
	},
	confluenceSpace: {
		key: "confluenceSpace",
		category: "connections",
		label: null,
		type: "string",
		maxLength: 255,
		keywords: [],
		assistant: "read",
	},
	restoreSession: {
		key: "restoreSession",
		category: "system",
		label: "restoreSession",
		type: "boolean",
		keywords: [
			"oturum",
			"session",
			"kaldığım yer",
			"geri yükle",
			"restore",
			"sekmeler",
			"tabs",
			"notepad",
			"açılış",
			"startup",
		],
		assistant: "write",
	},
	notesAligned: {
		key: "notesAligned",
		category: "editor",
		label: "notesAligned",
		type: "boolean",
		keywords: ["not", "notlarım", "notes", "kenar", "margin", "hizala", "align", "satır", "line"],
		assistant: "write",
	},
	localNotes: {
		key: "localNotes",
		category: "editor",
		label: "localNotes",
		type: "boolean",
		keywords: [
			"not",
			"notlarım",
			"notes",
			"yorum",
			"comment",
			"açıklama",
			"balon",
			"balloon",
			"işaret",
		],
		assistant: "write",
	},
	confluenceReviewBeforeSave: {
		key: "confluenceReviewBeforeSave",
		category: "editor",
		label: "confluenceReviewBeforeSave",
		type: "boolean",
		keywords: [
			"değişiklik",
			"fark",
			"diff",
			"changes",
			"confluence",
			"kaydet",
			"save",
			"karşılaştır",
			"compare",
		],
		assistant: "write",
	},
	confluenceFavorites: {
		key: "confluenceFavorites",
		category: "connections",
		label: null,
		type: "custom",
		parse: parseConfluenceFavorites,
		keywords: [],
		assistant: "hidden",
	},
	jiraFavorites: {
		key: "jiraFavorites",
		category: "connections",
		label: null,
		type: "custom",
		parse: parseJiraFavorites,
		keywords: [],
		assistant: "hidden",
	},
	jiraIssueLayout: {
		key: "jiraIssueLayout",
		category: "connections",
		label: null,
		type: "custom",
		parse: parseIssueLayout,
		keywords: [],
		assistant: "hidden",
	},
	pinnedFiles: {
		key: "pinnedFiles",
		category: "system",
		label: null,
		type: "custom",
		parse: parsePinnedFiles,
		keywords: [],
		assistant: "hidden",
	},
	pageSize: {
		key: "pageSize",
		category: "page",
		label: "pageSize",
		type: "enum",
		values: PAGE_SIZES,
		keywords: [
			"kağıt",
			"kâğıt",
			"paper",
			"sayfa boyutu",
			"page size",
			"a4",
			"letter",
			"pdf",
			"yazdır",
		],
		assistant: "write",
	},
	landscape: {
		key: "landscape",
		category: "page",
		label: "orientation",
		type: "enum",
		values: [false, true],
		valueLabels: ["portrait", "landscape"],
		keywords: ["yönlendirme", "orientation", "yatay", "landscape", "dikey", "portrait"],
		assistant: "write",
	},
	margins: {
		key: "margins",
		category: "page",
		label: "margins",
		type: "enum",
		values: PAGE_MARGINS,
		valueLabels: ["marginsNormal", "marginsNarrow", "marginsWide"],
		keywords: ["kenar boşluğu", "margin", "dar", "narrow", "geniş", "wide"],
		assistant: "write",
	},
	pageNumbers: {
		key: "pageNumbers",
		category: "page",
		label: "pageNumbers",
		type: "boolean",
		keywords: ["sayfa numarası", "page number", "pdf"],
		assistant: "write",
	},
	checkUpdates: {
		key: "checkUpdates",
		category: "system",
		label: "settingsUpdates",
		type: "boolean",
		keywords: ["güncelleme", "update", "sürüm", "version"],
		assistant: "write",
	},
	tray: {
		key: "tray",
		category: "system",
		label: "settingsTray",
		type: "boolean",
		keywords: ["tepsi", "tray", "bildirim alanı", "notification", "hızlı not", "quick note"],
		assistant: "write",
	},
	gitTrustedFolders: {
		key: "gitTrustedFolders",
		category: "system",
		label: null,
		type: "custom",
		parse: parseTrustedFolders,
		keywords: [],
		// Trusting a repository lets its git settings run programs: only the user decides.
		assistant: "hidden",
	},
	gitAutoFetch: {
		key: "gitAutoFetch",
		category: "system",
		label: "settingsGitFetch",
		type: "boolean",
		keywords: ["git", "fetch", "getir", "depo", "repository"],
		assistant: "write",
	},
};

/** The categories' names in the interface. */
export const CATEGORY_LABELS: Readonly<Record<SettingCategory, StringKey>> = {
	appearance: "settingsCatAppearance",
	typography: "settingsCatTypography",
	editor: "settingsCatEditor",
	panels: "settingsCatPanels",
	assistant: "settingsCatAssistant",
	modes: "settingsCatModes",
	connections: "settingsCatConnections",
	page: "settingsCatPage",
	templates: "settingsCatTemplates",
	system: "settingsCatSystem",
};

/** A kind of change the assistant may be allowed, as the user reads it. */
export function permissionLabel(t: Strings, permission: string): string {
	const category = permission.startsWith("settings:") ? permission.slice(9) : null;
	if (category !== null && Object.hasOwn(CATEGORY_LABELS, category)) {
		return format(t.permissionSettings, t[CATEGORY_LABELS[category as SettingCategory]]);
	}
	if (permission === "view") return t.permissionView;
	if (permission === "commands") return t.permissionCommands;
	if (permission === "document") return t.permissionDocument;
	if (permission === "prompts") return t.permissionPrompts;
	return permission;
}

/** Every setting's description, in the order of the type. */
export const SETTING_DEFS: readonly SettingDef[] = Object.values(SETTINGS_SCHEMA) as SettingDef[];

export const settingDef = (key: keyof Settings): SettingDef => SETTINGS_SCHEMA[key];

export const isSettingKey = (value: unknown): value is keyof Settings =>
	typeof value === "string" && Object.hasOwn(SETTINGS_SCHEMA, value);

const sameValue = (a: unknown, b: unknown): boolean => a === b;

/** One stored value made valid: as it is, or else its default. */
export function parseSetting<K extends keyof Settings>(key: K, raw: unknown): Settings[K] {
	const def: SettingDef = SETTINGS_SCHEMA[key];
	const fallback = DEFAULT_SETTINGS[key];
	switch (def.type) {
		case "boolean":
			return (typeof raw === "boolean" ? raw : fallback) as Settings[K];
		case "enum":
			return (
				(def.values as readonly unknown[]).some((value) => sameValue(value, raw)) ? raw : fallback
			) as Settings[K];
		case "number": {
			if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
			// Rounded again: 23 × 0.05 is 1.1500000000000001.
			const snapped = Number((Math.round(raw / def.step) * def.step).toFixed(6));
			return Math.min(def.max, Math.max(def.min, snapped)) as Settings[K];
		}
		case "string":
			return (typeof raw === "string" ? raw.slice(0, def.maxLength) : fallback) as Settings[K];
		case "custom":
			return def.parse(raw) as Settings[K];
	}
}

/**
 * Settings from before the assistant had servers of its own get the ones
 * it starts with; Kalem's modes whose servers were chosen then use them too
 * where they would by default.
 */
function withDefaultServers(stored: Record<string, unknown>): Record<string, unknown> {
	const modes = stored.assistantModes;
	if (typeof modes !== "object" || modes === null || Array.isArray(modes)) {
		return { ...stored, assistantMcpServers: DEFAULT_SETTINGS.assistantMcpServers };
	}
	return {
		...stored,
		assistantMcpServers: DEFAULT_SETTINGS.assistantMcpServers,
		assistantModes: Object.fromEntries(
			Object.entries(modes).map(([name, mode]) => {
				const chosen = (mode as { mcp?: unknown } | null)?.mcp;
				if (!isMode(name) || !Array.isArray(chosen)) return [name, mode];
				return [name, { ...(mode as object), mcp: [...DEFAULT_MODE_SERVERS[name], ...chosen] }];
			}),
		),
	};
}

/** Every setting of a stored record made valid, field by field. */
export function parseSettings(raw: unknown): Settings {
	const stored =
		typeof raw === "object" && raw !== null && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	// Modes kept servers of their own before the assistant had them: they move to the assistant.
	const record = liftModeServers(
		"assistantMcpServers" in stored ? stored : withDefaultServers(stored),
	);
	const settings: Record<string, unknown> = {};
	for (const def of SETTING_DEFS) settings[def.key] = parseSetting(def.key, record[def.key]);
	return settings as unknown as Settings;
}

/** A value's name in the interface. */
export function valueLabel(t: Strings, def: SettingDef, value: unknown): string {
	if (def.type === "enum") {
		const at = (def.values as readonly unknown[]).findIndex((item) => sameValue(item, value));
		const key = at === -1 ? undefined : def.valueLabels?.[at];
		if (key !== undefined && key !== null) return t[key];
		if (def.key === "language") return value === "tr" ? "Türkçe" : "English";
	}
	if (def.type === "boolean") return value === true ? t.settingsOn : t.settingsOff;
	return String(value);
}

/** Lower case in both Turkish and English, without the dots and accents that differ between them. */
export function foldSearch(text: string): string {
	return text
		.toLocaleLowerCase("tr")
		.replace(/ı/g, "i")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

/** The words a setting is found by: its name, its values' names, its keywords. */
export function searchText(t: Strings, def: SettingDef): string {
	const words = [
		def.key,
		...(def.label === null ? [] : [t[def.label]]),
		...(def.type === "enum" ? def.values.map((value) => valueLabel(t, def, value)) : []),
		...def.keywords,
	];
	return foldSearch(words.join(" "));
}

/** Whether every word of the query is in `text` (as `foldSearch` gives it). */
export function matchesQuery(text: string, query: string): boolean {
	const words = foldSearch(query)
		.split(/\s+/)
		.filter((word) => word !== "");
	return words.every((word) => text.includes(word));
}

/**
 * Whether every word of the query starts with one of the text's words
 * (four letters or more), or is in it. Turkish adds its endings to the
 * word: "yakınlaştırma" is "yakınlaştır" with one, "temayı" is "tema".
 * Looser than {@link matchesQuery}, so it is tried only when that finds
 * nothing ("yazım" would find "yazı boyutu" too).
 */
export function matchesStems(text: string, query: string): boolean {
	const words = foldSearch(query)
		.split(/\s+/)
		.filter((word) => word !== "");
	const stems = text.split(/[^\p{L}\p{N}]+/u).filter((stem) => stem.length >= 4);
	return words.every((word) => text.includes(word) || stems.some((stem) => word.startsWith(stem)));
}

/** The settings a query finds, the ones whose name has it first; hidden ones are left out unless asked. */
export function findSettings(
	t: Strings,
	query: string,
	options: { readonly includeHidden?: boolean } = {},
): SettingDef[] {
	const folded = foldSearch(query).trim();
	const candidates = SETTING_DEFS.filter(
		(def) => options.includeHidden === true || def.assistant !== "hidden",
	);
	if (folded === "") return candidates;
	const exact = candidates.filter((def) => matchesQuery(searchText(t, def), folded));
	// The assistant asked for "yakınlaştırma" and was told there is no such setting.
	const found =
		exact.length > 0 ? exact : candidates.filter((def) => matchesStems(searchText(t, def), folded));
	const named = (def: SettingDef): number =>
		def.label !== null && foldSearch(t[def.label]).includes(folded) ? 0 : 1;
	return found.sort((a, b) => named(a) - named(b));
}

/** The settings a category's "Reset" puts back: those the window shows on rows, and where the panes dock. */
export function resettable(category: SettingCategory): (keyof Settings)[] {
	return SETTING_DEFS.filter(
		(def) =>
			def.category === category &&
			def.assistant !== "hidden" &&
			(def.label !== null || def.key === "panePlaces"),
	).map((def) => def.key);
}

/** The settings that put a category back as it was when the app was installed. */
export function resetPatch(category: SettingCategory): Partial<Settings> {
	const patch: Record<string, unknown> = {};
	for (const key of resettable(category)) patch[key] = DEFAULT_SETTINGS[key];
	return patch as Partial<Settings>;
}
