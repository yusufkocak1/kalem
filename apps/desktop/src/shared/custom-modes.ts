/**
 * Modes the user makes: a name and an icon, the instructions the model is
 * given, steps of their own, the Kalem tools it may use (all, or a few),
 * and MCP servers of their own (a program run on this computer, or an
 * address) that Claude Code and the Copilot CLI connect to while the mode
 * is on. Pure: the main process writes the CLIs' configurations.
 */
import type { Detail, ReplyLanguage, StoredStep } from "./mode-config.js";
import { DETAILS, REPLY_LANGUAGES } from "./mode-config.js";

/** The icons a mode of the user's may take (Kalem's own icon names). */
export const CUSTOM_ICONS = [
	"assistant",
	"star",
	"target",
	"pencil",
	"check",
	"find",
	"code",
	"send",
	"chats",
	"diagram",
	"table",
	"link",
	"attachments",
	"settings",
	"wand",
	"branch",
] as const;
export type CustomIcon = (typeof CUSTOM_ICONS)[number];

/** An MCP server a mode connects the CLI to. */
export interface McpServer {
	/** Its name for the CLI: tools are called `mcp__<name>__<tool>`. */
	readonly name: string;
	readonly transport: "stdio" | "http";
	/** stdio: the program and its arguments, and what it gets in its environment. */
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	/** http: its address and the headers it is sent (a token, say). */
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	/** The tools it may use; empty for all of them. */
	readonly tools: readonly string[];
	readonly enabled: boolean;
}

export interface CustomMode {
	/** `custom-…`, so it is never one of Kalem's modes. */
	readonly id: string;
	readonly name: string;
	readonly icon: CustomIcon;
	/** What it is for, in a line, as the picker shows it. */
	readonly description: string;
	/** What the model is told in this mode, before its steps. */
	readonly prompt: string;
	readonly steps: readonly StoredStep[];
	/** Kalem's tools it may use: all of them, or only these. */
	readonly tools: "all" | readonly string[];
	readonly mcp: readonly McpServer[];
	readonly keywords: readonly string[];
	readonly detail: Detail;
	readonly language: ReplyLanguage;
	readonly enabled: boolean;
}

export const isCustomModeId = (value: unknown): value is string =>
	typeof value === "string" && /^custom-[a-z0-9-]{1,40}$/.test(value);

/** Kalem's own server's name: a mode's server may not take it. */
const RESERVED_SERVER = "kalem";

const text = (value: unknown, max: number): string =>
	typeof value === "string" ? value.trim().slice(0, max) : "";

const list = (value: unknown, max: number, each = 200): string[] =>
	Array.isArray(value)
		? [...new Set(value.map((item) => text(item, each)).filter((item) => item !== ""))].slice(
				0,
				max,
			)
		: [];

function pairs(value: unknown, keyPattern: RegExp): Record<string, string> {
	const result: Record<string, string> = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
	for (const [key, item] of Object.entries(value).slice(0, 50)) {
		if (keyPattern.test(key) && typeof item === "string") result[key] = item.slice(0, 4000);
	}
	return result;
}

/** A server's name as the CLIs take it: letters, digits, `_` and `-`. */
export const serverName = (name: string): string =>
	name
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);

function parseServer(raw: unknown): McpServer | null {
	if (typeof raw !== "object" || raw === null) return null;
	const server = raw as Record<string, unknown>;
	const name = serverName(text(server.name, 60));
	if (name === "" || name.toLocaleLowerCase("en") === RESERVED_SERVER) return null;
	const transport = server.transport === "http" ? "http" : "stdio";
	const command = text(server.command, 1000);
	const url = text(server.url, 2000);
	if (transport === "stdio" && command === "") return null;
	if (transport === "http" && !/^https?:\/\//i.test(url)) return null;
	return {
		name,
		transport,
		command,
		args: list(server.args, 50, 1000),
		env: pairs(server.env, /^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
		url,
		headers: pairs(server.headers, /^[A-Za-z0-9-]{1,100}$/),
		tools: list(server.tools, 200, 100),
		enabled: server.enabled !== false,
	};
}

/** The user's modes as the settings file holds them, validated: anything else is dropped. */
export function parseCustomModes(raw: unknown): CustomMode[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	return raw
		.flatMap((item): CustomMode[] => {
			if (typeof item !== "object" || item === null) return [];
			const mode = item as Record<string, unknown>;
			const id = text(mode.id, 60);
			const name = text(mode.name, 80);
			if (!isCustomModeId(id) || seen.has(id) || name === "") return [];
			seen.add(id);
			const steps = Array.isArray(mode.steps)
				? mode.steps.flatMap((raw): StoredStep[] => {
						if (typeof raw !== "object" || raw === null) return [];
						const step = raw as Record<string, unknown>;
						const instruction = text(step.instruction, 2000);
						const stepId = text(step.id, 60);
						if (instruction === "" || !/^[a-z0-9][a-z0-9-]*$/.test(stepId)) return [];
						return [
							{
								id: stepId,
								on: step.on !== false,
								title: text(step.title, 120) || instruction.slice(0, 60),
								instruction,
								custom: true,
							},
						];
					})
				: [];
			const names = new Set<string>();
			const servers = (Array.isArray(mode.mcp) ? mode.mcp : []).flatMap((raw) => {
				const server = parseServer(raw);
				if (server === null || names.has(server.name)) return [];
				names.add(server.name);
				return [server];
			});
			return [
				{
					id,
					name,
					icon: CUSTOM_ICONS.includes(mode.icon as CustomIcon) ? (mode.icon as CustomIcon) : "star",
					description: text(mode.description, 200),
					prompt: text(mode.prompt, 8000),
					steps: steps.slice(0, 40),
					tools:
						mode.tools === "all" || !Array.isArray(mode.tools) ? "all" : list(mode.tools, 200, 100),
					mcp: servers.slice(0, 20),
					keywords: list(mode.keywords, 50, 60),
					detail: DETAILS.includes(mode.detail as Detail) ? (mode.detail as Detail) : "normal",
					language: REPLY_LANGUAGES.includes(mode.language as ReplyLanguage)
						? (mode.language as ReplyLanguage)
						: "auto",
					enabled: mode.enabled !== false,
				},
			];
		})
		.slice(0, 30);
}

/** A new mode of the user's: a name, everything else to fill in. */
export function newCustomMode(name: string, taken: readonly CustomMode[]): CustomMode {
	const ids = new Set(taken.map((mode) => mode.id));
	let n = taken.length + 1;
	while (ids.has(`custom-${n}`)) n++;
	return {
		id: `custom-${n}`,
		name,
		icon: "star",
		description: "",
		prompt: "",
		steps: [],
		tools: "all",
		mcp: [],
		keywords: [],
		detail: "normal",
		language: "auto",
		enabled: true,
	};
}

const DETAIL_LINES: Readonly<Record<Detail, string>> = {
	short: "Keep the reply short: the essentials only, no preamble.",
	normal: "",
	detailed: "Be thorough: explain your reasoning and cover the details.",
};

const LANGUAGE_LINES: Readonly<Record<ReplyLanguage, string>> = {
	auto: "",
	tr: "Reply in Turkish.",
	en: "Reply in English.",
};

/** What the model is told in a mode of the user's. */
export function customInstructions(mode: CustomMode): string {
	const steps = mode.steps.filter((step) => step.on && step.instruction !== undefined);
	const servers = mode.mcp.filter((server) => server.enabled);
	return [
		`## Mode: ${mode.name}`,
		mode.prompt,
		steps.length === 0
			? ""
			: [
					"Work in these steps, in order:",
					...steps.map((step, index) => `${index + 1}. ${step.instruction}`),
				].join("\n"),
		servers.length === 0
			? ""
			: `The user connected these MCP servers for this mode; use their tools when they help: ${servers.map((server) => server.name).join(", ")}.`,
		DETAIL_LINES[mode.detail],
		LANGUAGE_LINES[mode.language],
	]
		.filter((part) => part !== "")
		.join("\n\n");
}

/** The Kalem tools a mode of the user's leaves out: every one not chosen. */
export function customExcluded(mode: CustomMode, allTools: readonly string[]): Set<string> {
	if (mode.tools === "all") return new Set();
	const chosen = new Set(mode.tools);
	return new Set(allTools.filter((name) => !chosen.has(name)));
}

/** The mode's servers in Claude Code's `--mcp-config`, by name. */
export function claudeServers(mode: CustomMode): Record<string, unknown> {
	return Object.fromEntries(
		mode.mcp
			.filter((server) => server.enabled)
			.map((server) => [
				server.name,
				server.transport === "http"
					? { type: "http", url: server.url, headers: { ...server.headers } }
					: {
							type: "stdio",
							command: server.command,
							args: [...server.args],
							env: { ...server.env },
						},
			]),
	);
}

/** The mode's servers in the Copilot CLI's `--additional-mcp-config`, by name. */
export function copilotServers(mode: CustomMode): Record<string, unknown> {
	return Object.fromEntries(
		mode.mcp
			.filter((server) => server.enabled)
			.map((server) => {
				const tools = server.tools.length === 0 ? ["*"] : [...server.tools];
				return [
					server.name,
					server.transport === "http"
						? { type: "http", url: server.url, headers: { ...server.headers }, tools }
						: {
								type: "local",
								command: server.command,
								args: [...server.args],
								env: { ...server.env },
								tools,
							},
				];
			}),
	);
}

/** What Claude Code may call of the mode's servers without asking: a server, or its chosen tools. */
export function claudeAllowed(mode: CustomMode): string[] {
	return mode.mcp
		.filter((server) => server.enabled)
		.flatMap((server) =>
			server.tools.length === 0
				? [`mcp__${server.name}`]
				: server.tools.map((tool) => `mcp__${server.name}__${tool}`),
		);
}
