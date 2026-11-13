/**
 * MCP servers a mode connects Claude Code and the Copilot CLI to: a
 * program run on this computer, or an address. Kalem's own modes and the
 * user's take them alike. Each says when it is for, so the model reaches
 * for it on its own (an i18n key written in code goes into the database,
 * say). Pure: the main process writes the CLIs' configurations.
 */

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
	/** What it is for and when to use it, in the user's words; the model is told. */
	readonly purpose: string;
	/** The ready-made server it was added from (its guide is shown with it); empty for none. */
	readonly preset: string;
	readonly enabled: boolean;
}

/** Kalem's own server's name: a mode's server may not take it. */
export const RESERVED_SERVER = "kalem";

/** At most this many servers in a mode. */
export const MAX_SERVERS = 20;

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

/** A server as the settings file holds it, validated; `null` when it cannot be used. */
export function parseMcpServer(raw: unknown): McpServer | null {
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
		purpose: text(server.purpose, 2000),
		preset: /^[a-z0-9-]{1,40}$/.test(text(server.preset, 40)) ? text(server.preset, 40) : "",
		enabled: server.enabled !== false,
	};
}

/** A mode's servers, validated: one of each name, at most `MAX_SERVERS`. */
export function parseMcpServers(raw: unknown): McpServer[] {
	const names = new Set<string>();
	return (Array.isArray(raw) ? raw : [])
		.flatMap((item) => {
			const server = parseMcpServer(item);
			if (server === null || names.has(server.name)) return [];
			names.add(server.name);
			return [server];
		})
		.slice(0, MAX_SERVERS);
}

/** A new server for a mode: a name not yet taken, everything else to fill in. */
export function newMcpServer(taken: readonly McpServer[]): McpServer {
	const names = new Set(taken.map((server) => server.name));
	let n = taken.length + 1;
	while (names.has(`server-${n}`)) n++;
	return {
		name: `server-${n}`,
		transport: "stdio",
		command: "npx",
		args: [],
		env: {},
		url: "",
		headers: {},
		tools: [],
		purpose: "",
		preset: "",
		enabled: true,
	};
}

const on = (servers: readonly McpServer[]): McpServer[] =>
	servers.filter((server) => server.enabled);

/**
 * What the model is told of a mode's servers: each by name, what it is for,
 * and the tools it may call. With a purpose, the model reaches for the
 * server on its own while it works, not only when asked.
 */
export function mcpInstructions(servers: readonly McpServer[]): string {
	const enabled = on(servers);
	if (enabled.length === 0) return "";
	if (enabled.every((server) => server.purpose === "")) {
		return `The user connected these MCP servers for this mode; use their tools when they help: ${enabled.map((server) => server.name).join(", ")}.`;
	}
	return [
		"The user connected these MCP servers for this mode. Their tools are named mcp__<server>__<tool>. Use them on your own whenever the work calls for what a server is for: do not wait to be asked, and say what you did with them.",
		...enabled.map((server) => {
			const tools = server.tools.length === 0 ? "" : ` (tools: ${server.tools.join(", ")})`;
			return `- ${server.name}${tools}${server.purpose === "" ? "" : `: ${server.purpose}`}`;
		}),
	].join("\n");
}

/** The servers in Claude Code's `--mcp-config`, by name. */
export function claudeServers(servers: readonly McpServer[]): Record<string, unknown> {
	return Object.fromEntries(
		on(servers).map((server) => [
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

/** The servers in the Copilot CLI's `--additional-mcp-config`, by name. */
export function copilotServers(servers: readonly McpServer[]): Record<string, unknown> {
	return Object.fromEntries(
		on(servers).map((server) => {
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

/** What Claude Code may call of the servers without asking: a server, or its chosen tools. */
export function claudeAllowed(servers: readonly McpServer[]): string[] {
	return on(servers).flatMap((server) =>
		server.tools.length === 0
			? [`mcp__${server.name}`]
			: server.tools.map((tool) => `mcp__${server.name}__${tool}`),
	);
}

/** A tool a server says it has, as its `tools/list` answer gives it. */
export interface McpToolInfo {
	readonly name: string;
	readonly description: string;
}

/** A server's tools as asked of it, or why it could not be asked. */
export type McpToolList =
	| { readonly ok: true; readonly tools: readonly McpToolInfo[] }
	| { readonly ok: false; readonly error: string };

/** The tools in a `tools/list` result, one of each name. */
export function parseToolList(result: unknown): McpToolInfo[] {
	const tools = (result as { tools?: unknown } | null)?.tools;
	const seen = new Set<string>();
	return (Array.isArray(tools) ? tools : []).flatMap((tool) => {
		const name = text((tool as { name?: unknown } | null)?.name, 100);
		if (name === "" || seen.has(name)) return [];
		seen.add(name);
		return [{ name, description: text((tool as { description?: unknown }).description, 1000) }];
	});
}

/**
 * The tools a server may use once one is turned on or off in the list it
 * gave: empty (all of them) when every listed tool is on, `null` when none
 * would be left (empty would mean all).
 */
export function toggleTool(
	current: readonly string[],
	listed: readonly string[],
	tool: string,
	on: boolean,
): string[] | null {
	const chosen = new Set(current.length === 0 ? listed : current);
	if (on) chosen.add(tool);
	else chosen.delete(tool);
	if (chosen.size === 0) return null;
	const extra = [...chosen].filter((name) => !listed.includes(name));
	if (extra.length === 0 && listed.every((name) => chosen.has(name))) return [];
	return [...listed.filter((name) => chosen.has(name)), ...extra];
}
