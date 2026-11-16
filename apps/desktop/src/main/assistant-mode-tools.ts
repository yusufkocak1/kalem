/**
 * The tools that let the assistant set up its MCP servers when the user
 * asks ("add DBHub and use it in the Code mode"): list the servers, which
 * modes use each, and the ready-made ones; add, change or remove a server;
 * and turn one on or off in a mode. A server runs a program on this
 * computer, so every change is shown in full and asked about every time,
 * whatever the user allowed before or set in Settings. The model never
 * reads how a server runs (its tokens); it may write what the user gives it.
 *
 * And the tool the model changes modes with (`use_mode`) while the user's
 * choice is automatic: it works the question in the modes it names and the
 * picker stays where it is.
 */
import type { Settings } from "../shared/bridge.js";
import { format } from "../shared/i18n.js";
import type { McpPreset } from "../shared/mcp-presets.js";
import { MCP_PRESETS, presetServer } from "../shared/mcp-presets.js";
import { runtimeOf } from "../shared/mcp-runtimes.js";
import type { McpServer } from "../shared/mcp-servers.js";
import { MAX_SERVERS, parseMcpServer, serverName } from "../shared/mcp-servers.js";
import type { Mode } from "../shared/mode-config.js";
import { MODES, resolveMode, storeMode } from "../shared/mode-config.js";
import {
	autoModes,
	customModeOf,
	MODE_LABELS,
	modePrompt,
	modesUsingServers,
	renameServerRefs,
	USE_MODE,
} from "../shared/modes.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";
import { findProgram } from "./mcp-probe.js";

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string).trim() : "";

/** A mode the model named: Kalem's by id or name, or the user's by id or name. */
interface ModeRef {
	readonly label: string;
	/** The names of the servers it uses. */
	readonly names: readonly string[];
	/** The settings that keep the names it uses. */
	patch(ctx: ToolContext, names: readonly string[]): Partial<Settings>;
}

function modeOf(ctx: ToolContext, raw: string): ModeRef | null {
	const wanted = raw.trim().toLocaleLowerCase("tr");
	const settings = ctx.settings();
	const builtin = MODES.find(
		(mode) =>
			mode === wanted ||
			ctx.t[MODE_LABELS[mode]].toLocaleLowerCase("tr") === wanted ||
			ctx.t[MODE_LABELS[mode]].toLocaleLowerCase("tr").startsWith(`${wanted} `),
	);
	if (builtin !== undefined) return builtinRef(ctx, builtin);
	const custom = settings.assistantCustomModes;
	const own =
		customModeOf(raw.trim(), custom) ??
		custom.find((mode) => mode.name.toLocaleLowerCase("tr") === wanted) ??
		null;
	if (own === null) return null;
	return {
		label: own.name,
		names: own.mcp,
		patch: (context, names) => ({
			assistantCustomModes: context
				.settings()
				.assistantCustomModes.map((mode) =>
					mode.id === own.id ? { ...mode, mcp: [...names] } : mode,
				),
		}),
	};
}

function builtinRef(ctx: ToolContext, mode: Mode): ModeRef {
	return {
		label: ctx.t[MODE_LABELS[mode]],
		names: resolveMode(mode, ctx.settings().assistantModes).mcp,
		patch: (context, names) => {
			const all = { ...context.settings().assistantModes };
			const stored = storeMode({ ...resolveMode(mode, all), mcp: [...names] });
			if (Object.keys(stored).length === 0) delete all[mode];
			else all[mode] = stored;
			return { assistantModes: all };
		},
	};
}

/** A server as the model may know it: what it is for, not how it runs. */
const serverLine = (server: McpServer): string =>
	`  - ${server.name}${server.enabled ? "" : " (off)"}${server.tools.length === 0 ? " — all tools" : ` — tools: ${server.tools.join(", ")}`}${server.preset === "" ? "" : ` — from ${server.preset}`}${server.purpose === "" ? "" : `\n    for: ${server.purpose}`}`;

/** A server whose command is not on this computer: what to install, for the user. */
async function missingLine(server: McpServer): Promise<string> {
	if (server.transport !== "stdio" || (await findProgram(server.command)) !== null) return "";
	const runtime = runtimeOf(server.command);
	return `\n    NOT INSTALLED: its command ${server.command} is not on this computer, so it cannot start. ${
		runtime === null
			? "Tell the user to install the program it runs with, or to write its full path in Settings › Assistant › MCP servers."
			: `It comes with ${runtime.label} (${runtime.link}); tell the user to install it (${runtime.install.map((step) => `${step.system}: ${step.command}`).join("; ")}) and to restart Kalem.`
	}`;
}

const presetLine = (ctx: ToolContext, preset: McpPreset): string => {
	const placeholders = [
		...preset.server.args,
		...Object.entries(preset.server.env).map(([key, value]) => `${key}=${value}`),
		preset.server.url,
		...Object.entries(preset.server.headers).map(([key, value]) => `${key}: ${value}`),
	].filter((item) => /<[^>]+>/.test(item));
	return `- ${preset.id} (${preset.label}): ${ctx.t[preset.description]}${placeholders.length === 0 ? "" : ` To fill in: ${placeholders.join(" · ")}`}`;
};

/** A secret's value on the card the user approves: its start, enough to know it. */
const masked = (value: string): string =>
	/^<[^>]+>$/.test(value) || value.length <= 6 ? value : `${value.slice(0, 4)}…`;

/** How a server runs, a line each, as the user approves it. */
function runLines(ctx: ToolContext, server: McpServer): string[] {
	const lines =
		server.transport === "http"
			? [
					`${ctx.t.mcpUrl}: ${server.url}`,
					...Object.entries(server.headers).map(
						([key, value]) =>
							`${key}: ${/authorization|token|key|secret/i.test(key) ? masked(value) : value}`,
					),
				]
			: [
					`${ctx.t.mcpCommand}: ${[server.command, ...server.args].join(" ")}`,
					...Object.entries(server.env).map(([key, value]) => `${key}=${masked(value)}`),
				];
	return [
		...lines,
		`${ctx.t.mcpTools}: ${server.tools.length === 0 ? ctx.t.mcpToolsEvery : server.tools.join(", ")}`,
		...(server.purpose === "" ? [] : [`${ctx.t.mcpPurpose}: ${server.purpose}`]),
		...(server.enabled ? [] : [ctx.t.mcpServerOff]),
	];
}

const strings = (raw: unknown): string[] | undefined =>
	Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : undefined;

const pairs = (raw: unknown): Record<string, string> | undefined => {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
	return Object.fromEntries(
		Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);
};

/** The fields the model gave for a server, over what it was. */
function withChanges(base: McpServer, given: Record<string, unknown>): McpServer {
	const args = strings(given.args);
	const tools = strings(given.tools);
	const env = pairs(given.env);
	const headers = pairs(given.headers);
	return {
		...base,
		...(given.transport === "http" || given.transport === "stdio"
			? { transport: given.transport }
			: {}),
		...(typeof given.command === "string" ? { command: given.command } : {}),
		...(args === undefined ? {} : { args }),
		// Values given are added to what is there: a token is set without retyping the rest.
		...(env === undefined ? {} : { env: { ...base.env, ...env } }),
		...(typeof given.url === "string" ? { url: given.url } : {}),
		...(headers === undefined ? {} : { headers: { ...base.headers, ...headers } }),
		...(tools === undefined ? {} : { tools }),
		...(typeof given.purpose === "string" ? { purpose: given.purpose } : {}),
		...(typeof given.enabled === "boolean" ? { enabled: given.enabled } : {}),
	};
}

const SERVER_FIELDS = {
	type: "object",
	description:
		"The server's fields to set; leave out what stays. env and headers are added to what it has.",
	properties: {
		name: { type: "string" },
		transport: { type: "string", enum: ["stdio", "http"] },
		command: { type: "string" },
		args: { type: "array", items: { type: "string" } },
		env: { type: "object", additionalProperties: { type: "string" } },
		url: { type: "string" },
		headers: { type: "object", additionalProperties: { type: "string" } },
		tools: {
			type: "array",
			items: { type: "string" },
			description: "The only tools it may use; empty for all of them.",
		},
		purpose: {
			type: "string",
			description: "What it is for and when to use it; the model is told in the modes that use it.",
		},
		enabled: { type: "boolean" },
	},
} as const;

/** The id of a mode the model named, among those that are on: by id, or by its name. */
function autoModeId(ctx: ToolContext, raw: string): string | null {
	const wanted = raw.trim().toLocaleLowerCase("tr");
	const settings = ctx.settings();
	const ids = autoModes(settings.assistantModes, settings.assistantCustomModes).map(
		(mode) => mode.id,
	);
	return (
		ids.find((id) => id.toLocaleLowerCase("tr") === wanted) ??
		ids.find((id) => {
			const own = customModeOf(id, settings.assistantCustomModes);
			const name = own === null ? ctx.t[MODE_LABELS[id as Mode]] : own.name;
			return name.toLocaleLowerCase("tr") === wanted;
		}) ??
		null
	);
}

const MODE_TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: USE_MODE,
			description:
				"Works this question in the modes you name, when the mode chosen automatically from the question's words does not fit the work or misses a part of it: returns the steps of each mode, to follow in the order given, for this question only. The mode the user sees does not change. Call it before you start the work.",
			parameters: {
				type: "object",
				properties: {
					modes: {
						type: "array",
						items: { type: "string" },
						description:
							"The ids of the modes the work needs, in the order to work in (ask, write, review, prompt, code, app, or custom-… for one of the user's).",
					},
					reason: { type: "string", description: "Why, in a few words, in the user's language." },
				},
				required: ["modes"],
			},
		},
		risk: "read",
		// Only where the choice is automatic: a mode the user picked is theirs to change.
		available: (ctx) => ctx.auto === true,
		async run(input, ctx) {
			const named = (strings(input.modes) ?? []).filter((name) => name.trim() !== "");
			const settings = ctx.settings();
			const all = autoModes(settings.assistantModes, settings.assistantCustomModes);
			const list = `The modes: ${all.map((mode) => mode.id).join(", ")}.`;
			if (named.length === 0) return `Name the modes the work needs. ${list}`;
			const unknown = named.filter((name) => autoModeId(ctx, name) === null);
			if (unknown.length > 0) {
				return `There is no mode named ${unknown.map((name) => `"${name}"`).join(", ")} (or it is turned off). ${list}`;
			}
			const ids = [...new Set(named.map((name) => autoModeId(ctx, name) as string))];
			const labels = ids.map((id) => {
				const own = customModeOf(id, settings.assistantCustomModes);
				return own === null ? ctx.t[MODE_LABELS[id as Mode]] : own.name;
			});
			ctx.step({ tool: USE_MODE, detail: labels.join(" + ") });
			const steps = modePrompt(ids, settings.assistantModes, settings.assistantCustomModes);
			return [
				`This question is now worked in: ${ids.join(", ")}. Follow these instead of the mode you were given before; the tools and MCP servers of these modes are available.`,
				steps === "" ? "No special steps: answer the question as asked." : steps,
			].join("\n\n");
		},
	},
	{
		definition: {
			name: "mode_mcp_list",
			description:
				"Lists the assistant's MCP servers (name, tools, what it is for, the modes that use it; never how it runs), the servers each mode uses, and the ready-made servers mode_mcp_change can add.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		risk: "read",
		available: () => true,
		async run(_input, ctx) {
			const settings = ctx.settings();
			const modes = modesUsingServers(
				ctx.t,
				settings.assistantModes,
				settings.assistantCustomModes,
			);
			const servers = settings.assistantMcpServers;
			return [
				"The assistant's MCP servers (set up once; each mode chooses which it uses):",
				...(servers.length === 0
					? ["  none"]
					: await Promise.all(
							servers.map(async (server) => {
								const using = modes.filter((mode) => mode.mcp.includes(server.name));
								return `${serverLine(server)}\n    used in: ${using.length === 0 ? "no mode" : using.map((mode) => mode.id).join(", ")}${await missingLine(server)}`;
							}),
						)),
				"",
				"Modes and the servers they use:",
				...modes.map((mode) => {
					const names = mode.mcp.filter((name) => servers.some((server) => server.name === name));
					return `- ${mode.id} (${mode.name}): ${names.length === 0 ? "none" : names.join(", ")}`;
				}),
				"",
				"Ready-made servers (preset ids for mode_mcp_change):",
				...MCP_PRESETS.map((preset) => presetLine(ctx, preset)),
				"",
				"Servers work with Claude Code and the Copilot CLI only, from the next question on.",
			].join("\n");
		},
	},
	{
		definition: {
			name: "mode_mcp_change",
			description:
				"Changes the assistant's MCP servers, or which a mode uses; the user sees the whole change and is asked every time. add: a server for the assistant, from a ready-made server (preset) with what the user gave (a path, a token, other tools), or one of the user's own (server with name and command or url); with mode, it is used in that mode too. update: the named server's fields. remove: the named server, from every mode. use / unuse: the named server in a mode (mode required). Call mode_mcp_list first. Ask the user for what a ready-made server needs filled in (words in angle brackets) instead of leaving it.",
			parameters: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["add", "update", "remove", "use", "unuse"] },
					mode: {
						type: "string",
						description:
							"The mode's id (ask, write, review, prompt, code, app, custom-…) or name: for use / unuse, and for add to use it there.",
					},
					name: {
						type: "string",
						description: "update / remove / use / unuse: the server's name.",
					},
					preset: { type: "string", description: "add: a ready-made server's id." },
					server: SERVER_FIELDS,
					reason: { type: "string", description: "Why, in a few words, in the user's language." },
				},
				required: ["action"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const action = text(input, "action");
			const modeName = text(input, "mode");
			const mode = modeName === "" ? null : modeOf(ctx, modeName);
			if (modeName !== "" && mode === null) {
				return `There is no mode named "${modeName}"; see mode_mcp_list.`;
			}
			const given = record(input.server);
			const settings = ctx.settings();
			const servers = [...settings.assistantMcpServers];
			let patch: Partial<Settings>;
			let title: string;
			let lines: string[];
			if (action === "add") {
				const presetId = text(input, "preset");
				const preset = MCP_PRESETS.find((each) => each.id === presetId);
				if (presetId !== "" && preset === undefined) {
					return `There is no ready-made server "${presetId}"; see mode_mcp_list.`;
				}
				if (preset === undefined && typeof given.name !== "string") {
					return "Give a ready-made server (preset) or a server with its name.";
				}
				if (servers.length >= MAX_SERVERS) {
					return `The assistant takes at most ${MAX_SERVERS} servers.`;
				}
				const base: McpServer =
					preset === undefined
						? {
								name: "",
								transport: "stdio",
								command: "",
								args: [],
								env: {},
								url: "",
								headers: {},
								tools: [],
								purpose: "",
								preset: "",
								enabled: true,
							}
						: presetServer(preset, servers);
				const wantedName = typeof given.name === "string" ? serverName(given.name) : base.name;
				const server = parseMcpServer({ ...withChanges(base, given), name: wantedName });
				if (server === null) {
					return "That server cannot be used: give it a name (not kalem), and a command (stdio) or an address starting with http(s) (http).";
				}
				if (servers.some((each) => each.name === server.name)) {
					return `The assistant already has a server named ${server.name}: update it, use it in a mode, or give another name.`;
				}
				patch = {
					assistantMcpServers: [...servers, server],
					...(mode === null ? {} : mode.patch(ctx, [...mode.names, server.name])),
				};
				title =
					mode === null
						? format(ctx.t.approvalMcpAdd, server.name)
						: format(ctx.t.approvalMcpAddTo, server.name, mode.label);
				lines = runLines(ctx, server);
			} else if (["update", "remove", "use", "unuse"].includes(action)) {
				const name = text(input, "name");
				const at = servers.findIndex((each) => each.name === name);
				const current = servers[at];
				if (current === undefined) {
					return `The assistant has no server named "${name}"; see mode_mcp_list.`;
				}
				if (action === "remove") {
					patch = {
						assistantMcpServers: servers.filter((_, i) => i !== at),
						...renameServerRefs(settings.assistantModes, settings.assistantCustomModes, name, null),
					};
					title = format(ctx.t.approvalMcpRemove, name);
					lines = runLines(ctx, current);
				} else if (action === "update") {
					const wantedName = typeof given.name === "string" ? serverName(given.name) : current.name;
					const server = parseMcpServer({ ...withChanges(current, given), name: wantedName });
					if (server === null) {
						return "That change leaves a server that cannot be used: it needs a command (stdio) or an address starting with http(s) (http), and a name that is not kalem.";
					}
					if (servers.some((each, i) => i !== at && each.name === server.name)) {
						return `The assistant already has a server named ${server.name}.`;
					}
					patch = {
						assistantMcpServers: servers.map((each, i) => (i === at ? server : each)),
						...(server.name === name
							? {}
							: renameServerRefs(
									settings.assistantModes,
									settings.assistantCustomModes,
									name,
									server.name,
								)),
					};
					title = format(ctx.t.approvalMcpUpdate, name);
					lines = runLines(ctx, server);
				} else {
					if (mode === null) return `Name the mode to ${action} ${name} in; see mode_mcp_list.`;
					const using = mode.names.includes(name);
					if (action === "use" && using) return `${mode.label} already uses ${name}.`;
					if (action === "unuse" && !using) return `${mode.label} does not use ${name}.`;
					patch = mode.patch(
						ctx,
						action === "use" ? [...mode.names, name] : mode.names.filter((each) => each !== name),
					);
					title = format(
						action === "use" ? ctx.t.approvalMcpUse : ctx.t.approvalMcpUnuse,
						name,
						mode.label,
					);
					lines = runLines(ctx, current);
				}
			} else {
				return 'action is one of "add", "update", "remove", "use", "unuse".';
			}
			const reason = text(input, "reason");
			const answer = await ctx.approve({
				tool: "mode_mcp_change",
				risk: "ui",
				permission: "settings:mcp",
				title,
				lines,
				// It runs programs on this computer: asked every time, whatever was allowed before.
				mustAsk: true,
				...(reason === "" ? {} : { reason: reason.slice(0, 300) }),
			});
			if (!answer.approved) {
				return "The user did not allow it: nothing changed. Do not try again unless they ask.";
			}
			ctx.changeSettings(patch);
			ctx.step({ tool: "mode_mcp_change", detail: title });
			const left = lines.filter((line) => /<[^>]+>/.test(line));
			return [
				`Done: ${title}. It is used from the next question in the modes that use it, with Claude Code or the Copilot CLI.`,
				action === "add" && mode === null
					? "No mode uses it yet: ask the user which modes should (mode_mcp_change use)."
					: "",
				left.length === 0
					? ""
					: `Still to fill in (tell the user, or ask them for it): ${left.join(" · ")}`,
			]
				.filter((line) => line !== "")
				.join("\n");
		},
	},
];

registerTools(MODE_TOOLS);
