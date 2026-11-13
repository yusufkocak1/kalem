/**
 * The tools that let the assistant connect a mode to MCP servers when the
 * user asks ("connect DBHub to the Code mode"): list what each mode has and
 * the ready-made servers, and add, change or remove one. A server runs a
 * program on this computer, so every change is shown in full and asked
 * about every time, whatever the user allowed before or set in Settings.
 * The model never reads how a server runs (its tokens); it may write what
 * the user gives it.
 */
import { format } from "../shared/i18n.js";
import type { McpPreset } from "../shared/mcp-presets.js";
import { MCP_PRESETS, presetServer } from "../shared/mcp-presets.js";
import type { McpServer } from "../shared/mcp-servers.js";
import { MAX_SERVERS, parseMcpServer, serverName } from "../shared/mcp-servers.js";
import type { Mode } from "../shared/mode-config.js";
import { MODES, resolveMode, storeMode } from "../shared/mode-config.js";
import { customModeOf, MODE_LABELS } from "../shared/modes.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string).trim() : "";

/** A mode the model named: Kalem's by id or name, or the user's by id or name. */
interface ModeRef {
	readonly label: string;
	readonly servers: readonly McpServer[];
	/** Keeps the mode's servers. */
	save(ctx: ToolContext, servers: readonly McpServer[]): void;
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
		servers: own.mcp,
		save: (context, servers) =>
			context.changeSettings({
				assistantCustomModes: context
					.settings()
					.assistantCustomModes.map((mode) =>
						mode.id === own.id ? { ...mode, mcp: [...servers] } : mode,
					),
			}),
	};
}

function builtinRef(ctx: ToolContext, mode: Mode): ModeRef {
	const resolved = resolveMode(mode, ctx.settings().assistantModes);
	return {
		label: ctx.t[MODE_LABELS[mode]],
		servers: resolved.mcp,
		save: (context, servers) => {
			const all = { ...context.settings().assistantModes };
			const stored = storeMode({
				...resolveMode(mode, all),
				mcp: servers,
			});
			if (Object.keys(stored).length === 0) delete all[mode];
			else all[mode] = stored;
			context.changeSettings({ assistantModes: all });
		},
	};
}

/** A server as the model may know it: what it is for, not how it runs. */
const serverLine = (server: McpServer): string =>
	`  - ${server.name}${server.enabled ? "" : " (off)"}${server.tools.length === 0 ? " — all tools" : ` — tools: ${server.tools.join(", ")}`}${server.preset === "" ? "" : ` — from ${server.preset}`}${server.purpose === "" ? "" : `\n    for: ${server.purpose}`}`;

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
		`${ctx.t.mcpTools}: ${server.tools.length === 0 ? ctx.t.mcpToolsAll : server.tools.join(", ")}`,
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
			description: "What it is for and when to use it; the model is told in that mode.",
		},
		enabled: { type: "boolean" },
	},
} as const;

const MODE_TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "mode_mcp_list",
			description:
				"Lists the assistant's modes with the MCP servers connected to each (name, tools, what it is for; never how it runs), and the ready-made servers mode_mcp_change can add.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		risk: "read",
		available: () => true,
		async run(_input, ctx) {
			const settings = ctx.settings();
			const modes = [
				...MODES.map((mode) => ({
					id: mode,
					label: ctx.t[MODE_LABELS[mode]],
					servers: resolveMode(mode, settings.assistantModes).mcp,
				})),
				...settings.assistantCustomModes.map((mode) => ({
					id: mode.id,
					label: mode.name,
					servers: mode.mcp,
				})),
			];
			return [
				"Modes and their MCP servers:",
				...modes.map(
					(mode) =>
						`- ${mode.id} (${mode.label})${mode.servers.length === 0 ? ": none" : `:\n${mode.servers.map(serverLine).join("\n")}`}`,
				),
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
				"Connects a mode to an MCP server, changes one, or removes it; the user sees the whole change and is asked every time. add: from a ready-made server (preset) with what the user gave (a path, a token, other tools), or one of the user's own (server with name and command or url). update: the named server's fields. remove: the named server. Call mode_mcp_list first. Ask the user for what a ready-made server needs filled in (words in angle brackets) instead of leaving it.",
			parameters: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["add", "update", "remove"] },
					mode: {
						type: "string",
						description: "The mode's id (ask, write, review, prompt, code, app, custom-…) or name.",
					},
					name: { type: "string", description: "update / remove: the server's name in that mode." },
					preset: { type: "string", description: "add: a ready-made server's id." },
					server: SERVER_FIELDS,
					reason: { type: "string", description: "Why, in a few words, in the user's language." },
				},
				required: ["action", "mode"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const action = text(input, "action");
			const mode = modeOf(ctx, text(input, "mode"));
			if (mode === null) {
				return `There is no mode named "${text(input, "mode")}"; see mode_mcp_list.`;
			}
			const given = record(input.server);
			const servers = [...mode.servers];
			let next: McpServer[];
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
				if (servers.length >= MAX_SERVERS) return `A mode takes at most ${MAX_SERVERS} servers.`;
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
					return `${mode.label} already has a server named ${server.name}: update it, or give another name.`;
				}
				next = [...servers, server];
				title = format(ctx.t.approvalMcpAdd, server.name, mode.label);
				lines = runLines(ctx, server);
			} else if (action === "update" || action === "remove") {
				const name = text(input, "name");
				const at = servers.findIndex((each) => each.name === name);
				const current = servers[at];
				if (current === undefined) {
					return `${mode.label} has no server named "${name}"; see mode_mcp_list.`;
				}
				if (action === "remove") {
					next = servers.filter((_, i) => i !== at);
					title = format(ctx.t.approvalMcpRemove, name, mode.label);
					lines = runLines(ctx, current);
				} else {
					const wantedName = typeof given.name === "string" ? serverName(given.name) : current.name;
					const server = parseMcpServer({ ...withChanges(current, given), name: wantedName });
					if (server === null) {
						return "That change leaves a server that cannot be used: it needs a command (stdio) or an address starting with http(s) (http), and a name that is not kalem.";
					}
					if (servers.some((each, i) => i !== at && each.name === server.name)) {
						return `${mode.label} already has a server named ${server.name}.`;
					}
					next = servers.map((each, i) => (i === at ? server : each));
					title = format(ctx.t.approvalMcpUpdate, name, mode.label);
					lines = runLines(ctx, server);
				}
			} else {
				return 'action is one of "add", "update", "remove".';
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
			mode.save(ctx, next);
			ctx.step({ tool: "mode_mcp_change", detail: title });
			const left = lines.filter((line) => /<[^>]+>/.test(line));
			return [
				`Done: ${title}. It is used from the next question in that mode, with Claude Code or the Copilot CLI.`,
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
