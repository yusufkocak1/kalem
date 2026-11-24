/**
 * The tools that let the assistant use Kalem itself: know where it is
 * (`app_state`, `kalem_help`, `kalem_tools`), find and change settings,
 * move and show panels, run the app's commands, and read and change the
 * document. Each change is asked of the user first. Every setting can be
 * read and changed; those that widen what the assistant may do, or name a
 * program it runs, are asked about every time, whatever the approval mode.
 */
import type { AssistantCommand, DocumentAction } from "../shared/actions.js";
import {
	ASSISTANT_COMMANDS,
	actionsFromReply,
	applyActions,
	commandLabel,
	isAssistantCommand,
	isDocumentAction,
} from "../shared/actions.js";
import { helpTopics } from "../shared/assistant-prompt.js";
import type { Settings } from "../shared/bridge.js";
import {
	documentLines,
	findHeading,
	outlineOf,
	outlineText,
	searchDocument,
} from "../shared/document-outline.js";
import { format } from "../shared/i18n.js";
import type { PanePlace, ToolPane } from "../shared/panes.js";
import {
	movePane,
	oneOnEachSide,
	PANE_PLACES,
	placesFor,
	revealPane,
	TOOL_PANES,
} from "../shared/panes.js";
import type { SettingDef } from "../shared/settings-schema.js";
import {
	findSettings,
	foldSearch,
	isSettingKey,
	parseSetting,
	SETTINGS_SCHEMA,
	valueLabel,
} from "../shared/settings-schema.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools, toolsFor } from "./assistant-tools.js";

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string) : "";

const firstSentence = (description: string): string => description.split(/(?<=\.)\s/)[0] ?? "";

const PANE_LABEL_KEYS = {
	outline: "outlineTab",
	files: "filesTab",
	confluence: "confluenceTab",
	jira: "jiraTab",
	notes: "notesTitle",
} as const satisfies Record<ToolPane, string>;

const placeLabel = (ctx: ToolContext, place: PanePlace): string =>
	({
		left: ctx.t.placeLeft,
		right: ctx.t.placeRight,
		bottom: ctx.t.placeBottom,
		hidden: ctx.t.placeHidden,
	})[place];

/** Settings changed with tools of their own, which show the change the way it reads best. */
const OWN_TOOL: Partial<Record<keyof Settings, string>> = {
	panePlaces: "pane_move",
	assistantMcpServers: "mode_mcp_change",
	assistantModes: "mode_configure",
	assistantCustomModes: "mode_save / mode_delete",
};

/**
 * Settings that widen what the assistant may do without asking, or name a
 * program Kalem runs: asked every time, never kept as allowed, and not
 * skipped by any approval mode.
 */
export const SENSITIVE_SETTINGS: ReadonlySet<keyof Settings> = new Set<keyof Settings>([
	"assistantPermissions",
	"assistantToolPolicies",
	"assistantApprovals",
	"claudePath",
	"copilotPath",
	"gitTrustedFolders",
]);

/** A structured value as the card shows it: its JSON, cut short. */
const jsonLine = (value: unknown): string => {
	const shown = JSON.stringify(value) ?? "null";
	return shown.length > 400 ? `${shown.slice(0, 400)}…` : shown;
};

/** A setting as the model reads it: its name, where it is, its value and what it takes. */
export function settingLine(ctx: ToolContext, def: SettingDef): string {
	// A mode names the MCP servers it uses; how they run (their tokens) is in a hidden setting.
	// How the MCP servers run (their commands, tokens) is never shown: their names are enough.
	const value =
		def.key === "assistantMcpServers"
			? ctx.settings().assistantMcpServers.map((server) => server.name)
			: ctx.settings()[def.key];
	const label = def.label === null ? def.key : ctx.t[def.label];
	const shown = (raw: unknown): string => JSON.stringify(raw) ?? "null";
	const takes =
		def.type === "enum"
			? `values: ${(def.values as readonly unknown[]).map((item) => `${shown(item)} (${valueLabel(ctx.t, def, item)})`).join(", ")}`
			: def.type === "number"
				? `a number from ${def.min} to ${def.max}`
				: def.type === "boolean"
					? "true or false"
					: OWN_TOOL[def.key] !== undefined
						? `change it with ${OWN_TOOL[def.key]}`
						: def.type === "custom"
							? "a JSON value of the same shape (the whole new value)"
							: "text";
	const access = SENSITIVE_SETTINGS.has(def.key) ? " [the user is asked every time]" : "";
	return `- ${def.key}: "${label}" (${def.category}) = ${shown(value)}; ${takes}${access}`;
}

/** The value the model meant: as given, or named by its label ("Dark", "Koyu"). */
function intended(
	ctx: ToolContext,
	def: SettingDef,
	raw: unknown,
): { ok: true; value: unknown } | { ok: false } {
	if (def.type === "enum") {
		const values = def.values as readonly unknown[];
		if (values.includes(raw)) return { ok: true, value: raw };
		if (typeof raw === "string") {
			const named = values.find(
				(item) =>
					foldSearch(valueLabel(ctx.t, def, item)) === foldSearch(raw) ||
					foldSearch(String(item)) === foldSearch(raw),
			);
			if (named !== undefined) return { ok: true, value: named };
			if (raw === "null" && values.includes(null)) return { ok: true, value: null };
		}
		return { ok: false };
	}
	if (def.type === "boolean") {
		if (typeof raw === "boolean") return { ok: true, value: raw };
		if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
		return { ok: false };
	}
	if (def.type === "number") {
		const value = typeof raw === "string" ? Number(raw) : raw;
		return typeof value === "number" && Number.isFinite(value)
			? { ok: true, value }
			: { ok: false };
	}
	if (def.type === "string")
		return typeof raw === "string" ? { ok: true, value: raw } : { ok: false };
	// A structured setting: its whole new value, given as JSON or as JSON text.
	let value = raw;
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw);
		} catch {
			return { ok: false };
		}
	}
	const parsed = def.parse(value);
	// What the setting's parser drops is not what the model meant: nothing kept means a wrong shape.
	const empty = (item: unknown): boolean =>
		(Array.isArray(item) && item.length === 0) ||
		(typeof item === "object" && item !== null && Object.keys(item).length === 0);
	if (empty(parsed) && !empty(value)) return { ok: false };
	return { ok: true, value: parsed };
}

/** Applies settings the user allowed; language goes through its own flow (a restart). */
export function applySettings(ctx: ToolContext, change: Partial<Settings>, label: string): void {
	// With what it closes on the same side (one panel open on each), so Undo opens that again too.
	const patch = oneOnEachSide(ctx.settings(), change);
	const before: Record<string, unknown> = {};
	for (const key of Object.keys(patch) as (keyof Settings)[]) before[key] = ctx.settings()[key];
	const { language, ...rest } = patch;
	if (Object.keys(rest).length > 0) ctx.changeSettings(rest);
	if (Object.hasOwn(patch, "language")) ctx.changeLanguage(language ?? null);
	ctx.emit({ kind: "changed", label, undo: before });
}

const SELF_TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "kalem_help",
			description:
				"Gives one of Kalem's guides: diagram (the Kalem diagram JSON), markdown (what Kalem shows), menus (where things are in the app), actions (the kalem-actions block), analysis (how a good analysis document is written and reviewed), prompt (how a prompt for a coding agent is put together).",
			parameters: {
				type: "object",
				properties: {
					topic: {
						type: "string",
						enum: ["diagram", "markdown", "menus", "actions", "analysis", "prompt"],
					},
				},
				required: ["topic"],
			},
		},
		risk: "read",
		available: () => true,
		async run(input, ctx) {
			const topics = helpTopics(ctx.t);
			const topic = text(input, "topic");
			ctx.step({ tool: "kalem_help", detail: topic });
			return topics[topic] ?? `No such topic. Topics: ${Object.keys(topics).join(", ")}.`;
		},
	},
	{
		definition: {
			name: "kalem_tools",
			description:
				"Lists the Kalem tools you can use now, each with what it does; give words to narrow the list.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "Words to find in tools' names and descriptions." },
				},
				required: [],
			},
		},
		risk: "read",
		available: () => true,
		async run(input, ctx) {
			const query = foldSearch(text(input, "query"));
			const lines = toolsFor(ctx)
				.filter((tool) =>
					query === ""
						? true
						: query
								.split(/\s+/)
								.some((word) =>
									foldSearch(`${tool.definition.name} ${tool.definition.description}`).includes(
										word,
									),
								),
				)
				.map(
					(tool) =>
						`- ${tool.definition.name}: ${firstSentence(tool.definition.description)}${tool.risk === "read" ? "" : " (asks the user)"}`,
				);
			return lines.length === 0 ? "No tool matches." : lines.join("\n");
		},
	},
	{
		definition: {
			name: "app_state",
			description:
				"Says what is open and set in Kalem now: the document, the panels and where they are, the theme, the language, the connections.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		risk: "read",
		available: () => true,
		async run(_input, ctx) {
			const settings = ctx.settings();
			const panes = TOOL_PANES.map(
				(pane) => `${pane} (${ctx.t[PANE_LABEL_KEYS[pane]]}): ${settings.panePlaces[pane]}`,
			).join(", ");
			const document =
				ctx.document === null
					? 'not shared with you (the user can turn on "Share the document")'
					: `"${ctx.document.name}", ${ctx.document.text.length} characters, ${outlineOf(ctx.document.text).length} headings${ctx.document.selection === "" ? "" : ", text selected"}`;
			return [
				"Kalem desktop app.",
				`Document: ${document}.`,
				`Interface language: ${settings.language ?? "system"}; theme: ${settings.theme}; zoom: ${settings.zoom}%; full width: ${settings.fullWidth}.`,
				`Panels: ${panes}. Docks open: left ${settings.navigation}, right ${settings.rightDock}, bottom ${settings.bottomDock}. Your own (the assistant's) panel: ${settings.assistantPlace}.`,
				`Confluence: ${ctx.confluence === null ? "not connected" : `connected to ${ctx.confluence.site}`}. Jira: ${ctx.jira === null ? "not connected" : `connected to ${ctx.jira.site}`}.`,
				`Workspace: ${ctx.workspace === null ? "none" : ctx.workspace.roots.join(", ")}.`,
				`Auto save: ${settings.autoSave}; spell check: ${settings.spellCheck}; page: ${settings.pageSize}${settings.landscape ? " landscape" : ""}, ${settings.margins} margins.`,
			].join("\n");
		},
	},
];

const SETTING_TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "settings_find",
			description:
				'Finds Kalem\'s settings by words in either language ("dark theme", "koyu", "kenar boşluğu"): each setting\'s key, name, current value and the values it takes. Empty words list them all.',
			parameters: {
				type: "object",
				properties: { query: { type: "string" } },
				required: [],
			},
		},
		risk: "read",
		available: () => true,
		async run(input, ctx) {
			const query = text(input, "query");
			ctx.step({ tool: "settings_find", detail: query });
			const found = findSettings(ctx.t, query, { includeHidden: true });
			if (found.length === 0)
				return `No setting matches "${query}". Call settings_find with no words to see them all.`;
			// Every one when asked for them all, as the description says; the best 20 for words.
			return found
				.slice(0, query.trim() === "" ? found.length : 20)
				.map((def) => settingLine(ctx, def))
				.join("\n");
		},
	},
	{
		definition: {
			name: "settings_get",
			description: "Reads settings by their keys.",
			parameters: {
				type: "object",
				properties: { keys: { type: "array", items: { type: "string" } } },
				required: ["keys"],
			},
		},
		risk: "read",
		available: () => true,
		async run(input, ctx) {
			const keys = Array.isArray(input.keys) ? input.keys : [];
			return keys
				.map((key) =>
					isSettingKey(key)
						? settingLine(ctx, SETTINGS_SCHEMA[key])
						: `- ${String(key)}: no such setting`,
				)
				.join("\n");
		},
	},
	{
		definition: {
			name: "settings_set",
			description:
				"Changes any of Kalem's settings; the user is asked first. Give each change's key (from settings_find) and its new value: one of the values settings_find lists, or for a structured setting (a list, a table) its whole new value as JSON (read it first with settings_get). Settings that change what the assistant may do are asked about every time.",
			parameters: {
				type: "object",
				properties: {
					changes: {
						type: "array",
						items: {
							type: "object",
							properties: { key: { type: "string" }, value: {} },
							required: ["key", "value"],
						},
					},
					reason: { type: "string", description: "Why, in a few words, in the user's language." },
				},
				required: ["changes"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const changes = Array.isArray(input.changes) ? input.changes : [];
			const groups = new Map<string, { patch: Record<string, unknown>; lines: string[] }>();
			const problems: string[] = [];
			for (const raw of changes.slice(0, 20)) {
				const change = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
					string,
					unknown
				>;
				const key = change.key;
				if (!isSettingKey(key)) {
					problems.push(`${String(key)}: no such setting (find it with settings_find)`);
					continue;
				}
				const def: SettingDef = SETTINGS_SCHEMA[key];
				const own = OWN_TOOL[key];
				if (own !== undefined) {
					problems.push(`${key}: change it with ${own}`);
					continue;
				}
				const meant = intended(ctx, def, change.value);
				if (!meant.ok) {
					problems.push(
						`${key}: ${JSON.stringify(change.value)} is not a value it takes (see settings_find)`,
					);
					continue;
				}
				const value = def.type === "custom" ? meant.value : parseSetting(key, meant.value);
				const now = ctx.settings()[key];
				if (value === now || (def.type === "custom" && jsonLine(value) === jsonLine(now))) continue;
				// Each sensitive setting on a card of its own, asked every time.
				const permission = SENSITIVE_SETTINGS.has(key)
					? `settings:sensitive:${key}`
					: `settings:${def.category}`;
				const group = groups.get(permission) ?? { patch: {}, lines: [] };
				group.patch[key] = value;
				const label = def.label === null ? key : ctx.t[def.label];
				group.lines.push(
					def.type === "custom"
						? `${label}: ${jsonLine(now)} → ${jsonLine(value)}`
						: `${label}: ${valueLabel(ctx.t, def, now)} → ${valueLabel(ctx.t, def, value)}`,
				);
				groups.set(permission, group);
			}
			const done: string[] = [];
			const refused: string[] = [];
			for (const [permission, group] of groups) {
				const sensitive = permission.startsWith("settings:sensitive:");
				const answer = await ctx.approve({
					tool: "settings_set",
					risk: "ui",
					permission,
					title: ctx.t.approvalSettings,
					lines: sensitive ? [...group.lines, ctx.t.approvalSettingSensitive] : group.lines,
					...(sensitive ? { mustAsk: true } : {}),
					...(text(input, "reason") === "" ? {} : { reason: text(input, "reason").slice(0, 300) }),
				});
				if (!answer.approved) {
					refused.push(...group.lines);
					continue;
				}
				applySettings(ctx, group.patch as Partial<Settings>, group.lines.join("; "));
				ctx.step({ tool: "settings_set", detail: group.lines.join("; ") });
				done.push(...group.lines);
			}
			return [
				done.length > 0 ? `Changed: ${done.join("; ")}.` : "",
				refused.length > 0
					? `The user did not allow: ${refused.join("; ")}. Do not try again.`
					: "",
				problems.length > 0 ? `Not changed: ${problems.join("; ")}.` : "",
				done.length + refused.length + problems.length === 0
					? "Nothing to change: the settings already have these values."
					: "",
			]
				.filter((line) => line !== "")
				.join("\n");
		},
	},
	{
		definition: {
			name: "pane_move",
			description:
				"Moves one of Kalem's panels (outline: the headings, files, confluence, jira, or assistant: your own panel) to the left, right or bottom dock, or hides it (not the assistant); the user is asked first.",
			parameters: {
				type: "object",
				properties: {
					pane: { type: "string", enum: [...TOOL_PANES, "assistant"] },
					place: { type: "string", enum: [...PANE_PLACES] },
				},
				required: ["pane", "place"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const place = text(input, "place") as PanePlace;
			if (text(input, "pane") === "assistant") {
				if (place !== "left" && place !== "right" && place !== "bottom") {
					return "The assistant's panel goes left, right or bottom; the user closes it themselves.";
				}
				const now = ctx.settings().assistantPlace;
				if (now === place) return "Your panel is already there.";
				const line = `${ctx.t.assistantTitle}: ${placeLabel(ctx, now)} → ${placeLabel(ctx, place)}`;
				const answer = await ctx.approve({
					tool: "pane_move",
					risk: "ui",
					permission: "settings:panels",
					title: ctx.t.approvalPanels,
					lines: [line],
				});
				if (!answer.approved) return "The user did not allow it. Do not try again.";
				applySettings(ctx, { assistantPlace: place }, line);
				ctx.step({ tool: "pane_move", detail: line });
				return `Moved: ${line}.`;
			}
			const pane = text(input, "pane") as ToolPane;
			if (!TOOL_PANES.includes(pane))
				return `No panel named ${pane}: ${TOOL_PANES.join(", ")}, assistant.`;
			if (!PANE_PLACES.includes(place))
				return `No place named ${place}: ${PANE_PLACES.join(", ")}.`;
			if (!placesFor(pane).includes(place))
				return `The ${pane} panel cannot go there: ${placesFor(pane).join(", ")}.`;
			const now = ctx.settings().panePlaces[pane];
			if (now === place) return `The ${pane} panel is already there.`;
			const line = `${ctx.t[PANE_LABEL_KEYS[pane]]}: ${placeLabel(ctx, now)} → ${placeLabel(ctx, place)}`;
			const answer = await ctx.approve({
				tool: "pane_move",
				risk: "ui",
				permission: "settings:panels",
				title: ctx.t.approvalPanels,
				lines: [line],
			});
			if (!answer.approved) return "The user did not allow it. Do not try again.";
			applySettings(ctx, movePane(ctx.settings(), pane, place), line);
			ctx.step({ tool: "pane_move", detail: line });
			return `Moved: ${line}.${(pane === "confluence" && ctx.confluence === null) || (pane === "jira" && ctx.jira === null) ? " It shows once connected." : ""}`;
		},
	},
	{
		definition: {
			name: "pane_show",
			description:
				"Opens one of Kalem's panels (outline, files, confluence, jira) where it docks; the user is asked first.",
			parameters: {
				type: "object",
				properties: { pane: { type: "string", enum: [...TOOL_PANES] } },
				required: ["pane"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const pane = text(input, "pane") as ToolPane;
			if (!TOOL_PANES.includes(pane)) return `No panel named ${pane}: ${TOOL_PANES.join(", ")}.`;
			const line = format(ctx.t.approvalShowPane, ctx.t[PANE_LABEL_KEYS[pane]]);
			const answer = await ctx.approve({
				tool: "pane_show",
				risk: "ui",
				permission: "settings:panels",
				title: ctx.t.approvalPanels,
				lines: [line],
			});
			if (!answer.approved) return "The user did not allow it. Do not try again.";
			applySettings(ctx, revealPane(ctx.settings(), pane), line);
			return `Shown: ${pane}.`;
		},
	},
];

/** Commands that change only what the user sees; the others work on the document or its file. */
const VIEW_COMMANDS: ReadonlySet<AssistantCommand> = new Set([
	"source",
	"read-only",
	"focus",
	"zoom-in",
	"zoom-out",
	"zoom-reset",
	"find",
	"replace",
	"quick-open",
	"search-folder",
	"version-history",
]);

const COMMAND_TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "app_command",
			description: `Runs one of Kalem's commands on the active document; the user is asked first. Commands: ${Object.entries(
				ASSISTANT_COMMANDS,
			)
				.map(([name, what]) => `${name} (${what})`)
				.join(", ")}.`,
			parameters: {
				type: "object",
				properties: { command: { type: "string", enum: Object.keys(ASSISTANT_COMMANDS) } },
				required: ["command"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const command = text(input, "command");
			if (!isAssistantCommand(command)) return `No command named ${command}.`;
			const view = VIEW_COMMANDS.has(command);
			const line = commandLabel(ctx.t, command);
			const answer = await ctx.approve({
				tool: "app_command",
				risk: view ? "ui" : "document",
				permission: view ? "view" : "commands",
				title: ctx.t.approvalCommand,
				lines: [line],
			});
			if (!answer.approved) return "The user did not allow it. Do not try again.";
			const done = await ctx.renderer("app_command", { command });
			ctx.step({ tool: "app_command", detail: command });
			return done.ok
				? `Ran ${command}.${done.text === "" ? "" : ` ${done.text}`}`
				: `Could not run ${command}: ${done.text}`;
		},
	},
];

/** The lines a change takes out and puts in, for the card. */
function changePreview(actions: readonly DocumentAction[]): string {
	const clip = (body: string): string => (body.length > 600 ? `${body.slice(0, 600)}…` : body);
	const prefixed = (body: string, mark: string): string =>
		clip(body)
			.split("\n")
			.map((line) => `${mark} ${line}`)
			.join("\n");
	return actions
		.map((action) =>
			action.type === "replace"
				? `${prefixed(action.find, "-")}\n${prefixed(action.replace, "+")}`
				: action.type === "insert"
					? prefixed(action.text, "+")
					: prefixed(action.text, "+"),
		)
		.join("\n\n")
		.slice(0, 6000);
}

const DOCUMENT_TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "document_outline",
			description:
				"The active document's headings, each with its lines and size: read a long document a part at a time.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		risk: "read",
		available: (ctx) => ctx.document !== null,
		async run(_input, ctx) {
			const document = ctx.document as NonNullable<ToolContext["document"]>;
			ctx.step({ tool: "document_outline", detail: document.name });
			return outlineText(document.text);
		},
	},
	{
		definition: {
			name: "document_read",
			description:
				"Reads the active document's Markdown, exactly as written: a part by its heading, or lines by number. Without either, the whole document.",
			parameters: {
				type: "object",
				properties: {
					heading: { type: "string", description: "A heading's title (from document_outline)." },
					start_line: { type: "integer" },
					end_line: { type: "integer" },
				},
				required: [],
			},
		},
		risk: "read",
		available: (ctx) => ctx.document !== null,
		async run(input, ctx) {
			const document = ctx.document as NonNullable<ToolContext["document"]>;
			const heading = text(input, "heading");
			if (heading !== "") {
				const found = findHeading(document.text, heading);
				if (found === null)
					return `No heading "${heading}". The headings:\n${outlineText(document.text)}`;
				ctx.step({ tool: "document_read", detail: found.title });
				return documentLines(document.text, found.line, found.end);
			}
			const from = typeof input.start_line === "number" ? input.start_line : 1;
			const to = typeof input.end_line === "number" ? input.end_line : Number.MAX_SAFE_INTEGER;
			ctx.step({
				tool: "document_read",
				detail: `${from}-${to === Number.MAX_SAFE_INTEGER ? "" : to}`,
			});
			return documentLines(document.text, from, to).slice(0, 120_000);
		},
	},
	{
		definition: {
			name: "document_search",
			description:
				"Finds the lines of the active document that have the words (case and Turkish letters ignored).",
			parameters: {
				type: "object",
				properties: { query: { type: "string" } },
				required: ["query"],
			},
		},
		risk: "read",
		available: (ctx) => ctx.document !== null,
		async run(input, ctx) {
			const document = ctx.document as NonNullable<ToolContext["document"]>;
			ctx.step({ tool: "document_search", detail: text(input, "query") });
			return searchDocument(document.text, text(input, "query"));
		},
	},
	{
		definition: {
			name: "document_edit",
			description:
				'Changes the active document; the user sees the change and is asked first, and can undo it. Actions as in a kalem-actions block: {"type":"replace","find":"exact text","replace":"new text","all"?:true}, {"type":"insert","at":"cursor"|"start"|"end","text":"Markdown"}, {"type":"document","text":"the whole new document"}. Copy "find" exactly from the document (read it first).',
			parameters: {
				type: "object",
				properties: {
					actions: { type: "array", items: { type: "object" } },
					reason: {
						type: "string",
						description: "What the change does, in a few words, in the user's language.",
					},
				},
				required: ["actions"],
			},
		},
		risk: "document",
		available: (ctx) => ctx.document !== null,
		async run(input, ctx) {
			const document = ctx.document as NonNullable<ToolContext["document"]>;
			const actions = (actionsFromReply(JSON.stringify(input.actions ?? [])) ?? []).filter(
				isDocumentAction,
			);
			if (actions.length === 0)
				return "No action it understands: see the description for their form.";
			const tried = applyActions(document.text, actions);
			if (!tried.ok) {
				return `Action ${tried.index + 1} cannot be applied: its "find" text is ${tried.reason === "missing" ? "not in the document (copy it exactly; read the part again)" : 'in the document more than once (give more of it, or "all": true)'}. Nothing was changed.`;
			}
			// Shown in the document instead, each part for the user to accept or reject.
			if (ctx.settings().assistantEditReview) {
				const shown = await ctx.renderer("document_edit", {
					tabId: document.tabId,
					actions,
					review: true,
				});
				if (!shown.ok) return `Not changed: ${shown.text}`;
				if (shown.document !== undefined) document.text = shown.document;
				ctx.step({ tool: "document_edit", detail: text(input, "reason") || document.name });
				return `The change is in the document (${shown.text}), each part marked for the user to accept or reject there; what they reject goes back as it was. Do not ask them to confirm it, and do not repeat the new text in your answer.`;
			}
			const answer = await ctx.approve({
				tool: "document_edit",
				risk: "document",
				permission: "document",
				title: format(ctx.t.approvalDocument, document.name),
				lines: [format(ctx.t.approvalChanges, actions.length)],
				preview: changePreview(actions),
				...(text(input, "reason") === "" ? {} : { reason: text(input, "reason").slice(0, 300) }),
			});
			if (!answer.approved)
				return "The user did not allow the change. Do not make it another way; ask what they want instead.";
			const done = await ctx.renderer("document_edit", { tabId: document.tabId, actions });
			if (!done.ok) return `Not changed: ${done.text}`;
			if (done.document !== undefined) document.text = done.document;
			ctx.step({ tool: "document_edit", detail: text(input, "reason") || document.name });
			return `Changed the document (${done.text}). Do not repeat the new text in your answer.`;
		},
	},
];

registerTools([...SELF_TOOLS, ...SETTING_TOOLS, ...COMMAND_TOOLS, ...DOCUMENT_TOOLS]);
