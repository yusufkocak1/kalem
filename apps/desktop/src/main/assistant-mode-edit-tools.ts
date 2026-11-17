/**
 * The tools that let the assistant shape its modes when the user asks
 * ("add a mode for meeting notes", "turn off the Prompt mode", "make the
 * Review mode reply in English"): list them in full, make or change a mode
 * of the user's, remove one, and change one of Kalem's. Each change is
 * shown and asked about as a settings change is; using MCP servers in a
 * mode runs programs on this computer, so a change to those is asked
 * every time (the MCP servers themselves are set up with mode_mcp_change).
 */
import type { Settings } from "../shared/bridge.js";
import type { CustomMode } from "../shared/custom-modes.js";
import { CUSTOM_ICONS, newCustomMode, parseCustomModes } from "../shared/custom-modes.js";
import { format } from "../shared/i18n.js";
import type {
	Detail,
	Mode,
	ReplyLanguage,
	ResolvedMode,
	SeverityFloor,
} from "../shared/mode-config.js";
import {
	DETAILS,
	isMode,
	MODES,
	newStepId,
	REPLY_LANGUAGES,
	resolveMode,
	SEVERITY_FLOORS,
	storeMode,
} from "../shared/mode-config.js";
import { MODE_LABELS } from "../shared/modes.js";
import { applySettings } from "./assistant-app-tools.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { allTools, registerTools } from "./assistant-tools.js";

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};

const has = (input: Record<string, unknown>, key: string): boolean =>
	Object.hasOwn(input, key) && input[key] !== undefined && input[key] !== null;

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string).trim() : "";

const strings = (raw: unknown): string[] =>
	Array.isArray(raw)
		? raw.filter((item): item is string => typeof item === "string" && item.trim() !== "")
		: typeof raw === "string" && raw.trim() !== ""
			? raw.split(",").map((item) => item.trim())
			: [];

const fold = (value: string): string => value.trim().toLocaleLowerCase("tr");

/** Kalem's mode the model named, by id or name. */
function builtinOf(ctx: ToolContext, raw: string): Mode | null {
	const wanted = fold(raw);
	if (isMode(wanted)) return wanted;
	return MODES.find((mode) => fold(ctx.t[MODE_LABELS[mode]]) === wanted) ?? null;
}

/** The user's mode the model named, by id or name. */
function customOf(ctx: ToolContext, raw: string): CustomMode | null {
	const wanted = fold(raw);
	return (
		ctx
			.settings()
			.assistantCustomModes.find((mode) => mode.id === raw.trim() || fold(mode.name) === wanted) ??
		null
	);
}

const stepLine = (
	step: { id: string; on: boolean; title: string | null; instruction: string },
	index: number,
): string =>
	`    ${index + 1}. [${step.on ? "on" : "off"}] ${step.id}${step.title === null || step.title === "" ? "" : ` "${step.title}"`}: ${step.instruction}`;

function builtinBlock(ctx: ToolContext, mode: Mode): string {
	const resolved = resolveMode(mode, ctx.settings().assistantModes);
	return [
		`- ${mode} ("${ctx.t[MODE_LABELS[mode]]}", Kalem's): ${resolved.enabled ? "on" : "off"}; detail ${resolved.detail}; language ${resolved.language}${mode === "review" ? `; minSeverity ${resolved.minSeverity}; maxFindings ${resolved.maxFindings}; parallel ${resolved.parallel}` : ""}`,
		`    keywords: ${resolved.keywords.join(", ") || "none"}; MCP servers: ${resolved.mcp.join(", ") || "none"}`,
		...(resolved.extra === "" ? [] : [`    extra instructions: ${resolved.extra}`]),
		"    steps:",
		...resolved.steps.map(stepLine),
	].join("\n");
}

function customBlock(mode: CustomMode): string {
	return [
		`- ${mode.id} ("${mode.name}", the user's): ${mode.enabled ? "on" : "off"}; icon ${mode.icon}; detail ${mode.detail}; language ${mode.language}`,
		`    description: ${mode.description || "none"}`,
		`    instructions: ${mode.prompt || "none"}`,
		`    tools: ${mode.tools === "all" ? "all" : mode.tools.join(", ") || "none"}; MCP servers: ${mode.mcp.join(", ") || "none"}; keywords: ${mode.keywords.join(", ") || "none"}`,
		"    steps:",
		...mode.steps.map((step, index) =>
			stepLine({ ...step, title: step.title ?? null, instruction: step.instruction ?? "" }, index),
		),
	].join("\n");
}

/** Steps the model gave: a line each, or `{ title, instruction, on }`. */
function givenSteps(raw: unknown): { title: string; instruction: string; on: boolean }[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((item) => {
		if (typeof item === "string") {
			const instruction = item.trim();
			return instruction === "" ? [] : [{ title: instruction.slice(0, 60), instruction, on: true }];
		}
		const step = record(item);
		const instruction = text(step, "instruction");
		if (instruction === "") return [];
		return [
			{
				title: text(step, "title") || instruction.slice(0, 60),
				instruction,
				on: step.on !== false,
			},
		];
	});
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((item, index) => item === b[index]);

/** Asks about the change and makes it; what the model is told. */
async function change(
	ctx: ToolContext,
	tool: string,
	title: string,
	lines: readonly string[],
	patch: Partial<Settings>,
	options: { readonly mustAsk?: boolean; readonly reason?: string } = {},
): Promise<string> {
	const answer = await ctx.approve({
		tool,
		risk: "ui",
		permission: "settings:modes",
		title,
		lines: [...lines],
		...(options.mustAsk === true ? { mustAsk: true } : {}),
		...(options.reason === undefined || options.reason === ""
			? {}
			: { reason: options.reason.slice(0, 300) }),
	});
	if (!answer.approved)
		return "The user did not allow it: nothing changed. Do not try again unless they ask.";
	applySettings(ctx, patch, title);
	ctx.step({ tool, detail: title });
	return `Done: ${title}. It is used from the next question.`;
}

const STEP_FIELDS = {
	type: "array",
	description: "The mode's steps in order: a line each, or { title, instruction, on }.",
	items: {},
};

const MODE_EDIT_TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "mode_list",
			description:
				"Lists the assistant's modes in full: Kalem's (ask, write, review, prompt, code, app) and the user's own (custom-…), each with whether it is on, its steps (ids and instructions), detail, reply language, keywords, tools and MCP servers. Call it before changing a mode.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		risk: "read",
		available: () => true,
		async run(_input, ctx) {
			ctx.step({ tool: "mode_list", detail: "" });
			const own = ctx.settings().assistantCustomModes;
			return [
				"Kalem's modes (change with mode_configure; they cannot be removed, only turned off):",
				...MODES.map((mode) => builtinBlock(ctx, mode)),
				"",
				"The user's modes (make or change with mode_save, remove with mode_delete):",
				...(own.length === 0 ? ["  none"] : own.map(customBlock)),
				"",
				`Icons a mode of the user's may take: ${CUSTOM_ICONS.join(", ")}. Detail: ${DETAILS.join(", ")}. Language: ${REPLY_LANGUAGES.join(", ")}.`,
			].join("\n");
		},
	},
	{
		definition: {
			name: "mode_save",
			description:
				"Makes a new mode of the user's, or changes one (give `mode`, its id or name, to change it; leave it out to make a new one with `name`). Only the fields given change. The user is asked first. Kalem's own modes are changed with mode_configure.",
			parameters: {
				type: "object",
				properties: {
					mode: { type: "string", description: "To change a mode: its id (custom-…) or name." },
					name: { type: "string" },
					icon: { type: "string", enum: [...CUSTOM_ICONS] },
					description: { type: "string", description: "What it is for, in a line." },
					instructions: { type: "string", description: "What the model is told in this mode." },
					steps: STEP_FIELDS,
					tools: {
						description:
							'"all", or the names of Kalem\'s tools the mode may use (see kalem_tools).',
					},
					mcp: {
						type: "array",
						items: { type: "string" },
						description: "Names of the assistant's MCP servers it uses (see mode_mcp_list).",
					},
					keywords: {
						type: "array",
						items: { type: "string" },
						description: "Words that choose it automatically.",
					},
					detail: { type: "string", enum: [...DETAILS] },
					language: { type: "string", enum: [...REPLY_LANGUAGES] },
					enabled: { type: "boolean" },
					reason: { type: "string", description: "Why, in a few words, in the user's language." },
				},
				required: [],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const settings = ctx.settings();
			const own = settings.assistantCustomModes;
			const named = text(input, "mode");
			const current = named === "" ? null : customOf(ctx, named);
			if (named !== "" && current === null) {
				return builtinOf(ctx, named) !== null
					? `${named} is one of Kalem's modes: change it with mode_configure.`
					: `There is no mode of the user's named "${named}"; see mode_list.`;
			}
			if (current === null) {
				if (text(input, "name") === "") return "Give the new mode a name.";
				if (own.length >= 30) return "The user has 30 modes already: remove one first.";
			}
			const base = current ?? newCustomMode(text(input, "name"), own);
			const problems: string[] = [];
			let tools = base.tools;
			if (has(input, "tools")) {
				if (input.tools === "all") tools = "all";
				else {
					const known = new Set(allTools().map((tool) => tool.definition.name));
					const wanted = strings(input.tools);
					const unknown = wanted.filter((name) => !known.has(name));
					if (unknown.length > 0) problems.push(`no tools named ${unknown.join(", ")}`);
					tools = wanted.filter((name) => known.has(name));
				}
			}
			let mcp = base.mcp;
			if (has(input, "mcp")) {
				const servers = new Set(settings.assistantMcpServers.map((server) => server.name));
				const wanted = strings(input.mcp);
				const unknown = wanted.filter((name) => !servers.has(name));
				if (unknown.length > 0)
					problems.push(
						`no MCP servers named ${unknown.join(", ")} (add them with mode_mcp_change)`,
					);
				mcp = wanted.filter((name) => servers.has(name));
			}
			const icon = text(input, "icon");
			const detail = text(input, "detail");
			const language = text(input, "language");
			if (icon !== "" && !(CUSTOM_ICONS as readonly string[]).includes(icon))
				problems.push(`no icon named ${icon}`);
			if (detail !== "" && !(DETAILS as readonly string[]).includes(detail))
				problems.push(`detail is one of ${DETAILS.join(", ")}`);
			if (language !== "" && !(REPLY_LANGUAGES as readonly string[]).includes(language))
				problems.push(`language is one of ${REPLY_LANGUAGES.join(", ")}`);
			if (problems.length > 0) return `Not changed: ${problems.join("; ")}.`;
			const steps = has(input, "steps")
				? givenSteps(input.steps).map((step, index) => ({
						id: `step-${index + 1}`,
						on: step.on,
						title: step.title,
						instruction: step.instruction,
						custom: true,
					}))
				: base.steps;
			const next = {
				...base,
				...(text(input, "name") === "" ? {} : { name: text(input, "name") }),
				...(icon === "" ? {} : { icon }),
				...(has(input, "description") ? { description: text(input, "description") } : {}),
				...(has(input, "instructions") ? { prompt: text(input, "instructions") } : {}),
				...(has(input, "keywords") ? { keywords: strings(input.keywords) } : {}),
				...(detail === "" ? {} : { detail: detail as Detail }),
				...(language === "" ? {} : { language: language as ReplyLanguage }),
				...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
				steps,
				tools,
				mcp,
			};
			const [parsed] = parseCustomModes([next]);
			if (parsed === undefined) return "That mode cannot be kept: give it a name.";
			const modes =
				current === null
					? [...own, parsed]
					: own.map((mode) => (mode.id === current.id ? parsed : mode));
			const lines = customBlock(parsed)
				.split("\n")
				.map((line) => line.trim());
			const title =
				current === null
					? format(ctx.t.approvalModeAdd, parsed.name)
					: format(ctx.t.approvalModeChange, parsed.name);
			const result = await change(
				ctx,
				"mode_save",
				title,
				lines,
				{ assistantCustomModes: modes },
				{
					// A mode that starts using MCP servers runs programs on this computer.
					mustAsk: !mcp.every((name) => (current?.mcp ?? []).includes(name)),
					reason: text(input, "reason"),
				},
			);
			return result.startsWith("Done")
				? `${result} Its id is ${parsed.id}; the user picks it in the mode menu.`
				: result;
		},
	},
	{
		definition: {
			name: "mode_delete",
			description:
				"Removes a mode of the user's (by id or name); the user is asked first. Kalem's modes cannot be removed: turn them off with mode_configure.",
			parameters: {
				type: "object",
				properties: {
					mode: { type: "string" },
					reason: { type: "string", description: "Why, in a few words, in the user's language." },
				},
				required: ["mode"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const named = text(input, "mode");
			const current = customOf(ctx, named);
			if (current === null) {
				return builtinOf(ctx, named) !== null
					? `${named} is one of Kalem's modes: it cannot be removed, only turned off (mode_configure enabled false).`
					: `There is no mode of the user's named "${named}"; see mode_list.`;
			}
			return change(
				ctx,
				"mode_delete",
				format(ctx.t.approvalModeDelete, current.name),
				[current.description || current.prompt.slice(0, 200)].filter((line) => line !== ""),
				{
					assistantCustomModes: ctx
						.settings()
						.assistantCustomModes.filter((mode) => mode.id !== current.id),
				},
				{ reason: text(input, "reason") },
			);
		},
	},
	{
		definition: {
			name: "mode_configure",
			description:
				"Changes one of Kalem's modes (ask, write, review, prompt, code, app): on or off, detail, reply language, extra instructions, keywords, the review's settings, and its steps: turn steps on or off or rewrite them by id (see mode_list), add steps of the user's, remove those, or put everything back (reset). Only what is given changes; the user is asked first. MCP servers of a mode are changed with mode_mcp_change.",
			parameters: {
				type: "object",
				properties: {
					mode: { type: "string" },
					enabled: { type: "boolean" },
					detail: { type: "string", enum: [...DETAILS] },
					language: { type: "string", enum: [...REPLY_LANGUAGES] },
					extra: { type: "string", description: "More instructions, said after the steps." },
					keywords: { type: "array", items: { type: "string" } },
					minSeverity: { type: "string", enum: [...SEVERITY_FLOORS] },
					maxFindings: {
						type: "integer",
						description: "Review: at most this many findings; 0 for no limit.",
					},
					parallel: { type: "boolean", description: "Review: checks side by side with a CLI." },
					steps: {
						type: "array",
						description: "Changes to steps by id: { id, on?, instruction?, title? }.",
						items: { type: "object" },
					},
					add_steps: STEP_FIELDS,
					remove_steps: {
						type: "array",
						items: { type: "string" },
						description: "Ids of the user's steps to remove (Kalem's are turned off instead).",
					},
					reset: { type: "boolean", description: "Put the mode back as Kalem ships it first." },
					reason: { type: "string", description: "Why, in a few words, in the user's language." },
				},
				required: ["mode"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const named = text(input, "mode");
			const mode = builtinOf(ctx, named);
			if (mode === null) {
				return customOf(ctx, named) !== null
					? `${named} is a mode of the user's: change it with mode_save.`
					: `There is no mode named "${named}"; see mode_list.`;
			}
			const settings = ctx.settings();
			const before = resolveMode(mode, settings.assistantModes);
			const start = input.reset === true ? resolveMode(mode, {}) : before;
			const problems: string[] = [];
			let steps = [...start.steps];
			for (const raw of Array.isArray(input.steps) ? input.steps : []) {
				const given = record(raw);
				const id = text(given, "id");
				const at = steps.findIndex((step) => step.id === id);
				const step = steps[at];
				if (step === undefined) {
					problems.push(`no step ${id || "(no id)"}`);
					continue;
				}
				steps[at] = {
					...step,
					...(typeof given.on === "boolean" ? { on: given.on } : {}),
					...(text(given, "instruction") === "" ? {} : { instruction: text(given, "instruction") }),
					...(text(given, "title") === "" ? {} : { title: text(given, "title") }),
				};
			}
			for (const id of strings(input.remove_steps)) {
				const step = steps.find((each) => each.id === id);
				if (step === undefined) problems.push(`no step ${id}`);
				else if (!step.custom) problems.push(`${id} is Kalem's step: turn it off instead`);
				else steps = steps.filter((each) => each.id !== id);
			}
			for (const added of givenSteps(input.add_steps)) {
				const id = newStepId({ ...start, steps });
				steps.push({
					id,
					on: added.on,
					custom: true,
					title: added.title,
					titleKey: null,
					instruction: added.instruction,
					defaultInstruction: "",
				});
			}
			const detail = text(input, "detail");
			const language = text(input, "language");
			const floor = text(input, "minSeverity");
			if (detail !== "" && !(DETAILS as readonly string[]).includes(detail))
				problems.push(`detail is one of ${DETAILS.join(", ")}`);
			if (language !== "" && !(REPLY_LANGUAGES as readonly string[]).includes(language))
				problems.push(`language is one of ${REPLY_LANGUAGES.join(", ")}`);
			if (floor !== "" && !(SEVERITY_FLOORS as readonly string[]).includes(floor))
				problems.push(`minSeverity is one of ${SEVERITY_FLOORS.join(", ")}`);
			if (problems.length > 0) return `Not changed: ${problems.join("; ")}.`;
			const next: ResolvedMode = {
				...start,
				steps,
				...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
				...(detail === "" ? {} : { detail: detail as Detail }),
				...(language === "" ? {} : { language: language as ReplyLanguage }),
				...(has(input, "extra") ? { extra: text(input, "extra") } : {}),
				...(has(input, "keywords") ? { keywords: strings(input.keywords) } : {}),
				...(floor === "" ? {} : { minSeverity: floor as SeverityFloor }),
				...(typeof input.maxFindings === "number" && input.maxFindings >= 0
					? { maxFindings: Math.round(input.maxFindings) }
					: {}),
				...(typeof input.parallel === "boolean" ? { parallel: input.parallel } : {}),
				// The servers stay as they were: mode_mcp_change asks about those.
				mcp: before.mcp,
			};
			const lines = describe(ctx, before, next);
			if (lines.length === 0) return "Nothing to change: the mode is already so.";
			return change(
				ctx,
				"mode_configure",
				format(ctx.t.approvalModeChange, ctx.t[MODE_LABELS[mode]]),
				lines,
				{ assistantModes: { ...settings.assistantModes, [mode]: storeMode(next) } },
				{ reason: text(input, "reason") },
			);
		},
	},
];

/** What changes in one of Kalem's modes, a line each. */
function describe(ctx: ToolContext, before: ResolvedMode, after: ResolvedMode): string[] {
	const lines: string[] = [];
	const onOff = (on: boolean): string => (on ? ctx.t.modeStateOn : ctx.t.modeStateOff);
	if (before.enabled !== after.enabled)
		lines.push(`${onOff(before.enabled)} → ${onOff(after.enabled)}`);
	for (const key of [
		"detail",
		"language",
		"extra",
		"minSeverity",
		"maxFindings",
		"parallel",
	] as const) {
		if (before[key] !== after[key])
			lines.push(`${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`);
	}
	if (!sameList(before.keywords, after.keywords))
		lines.push(`keywords: ${after.keywords.join(", ") || "none"}`);
	const old = new Map(before.steps.map((step) => [step.id, step]));
	for (const step of after.steps) {
		const was = old.get(step.id);
		const name = step.title ?? (step.titleKey === null ? step.id : ctx.t[step.titleKey]);
		if (was === undefined) lines.push(`+ ${name}: ${step.instruction}`);
		else if (was.on !== step.on) lines.push(`${name}: ${onOff(was.on)} → ${onOff(step.on)}`);
		else if (was.instruction !== step.instruction || was.title !== step.title)
			lines.push(`${name}: ${step.instruction}`);
	}
	for (const step of before.steps) {
		if (!after.steps.some((each) => each.id === step.id)) lines.push(`− ${step.title ?? step.id}`);
	}
	return lines;
}

registerTools(MODE_EDIT_TOOLS);
