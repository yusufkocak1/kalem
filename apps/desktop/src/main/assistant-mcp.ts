/**
 * Kalem's own tools for a CLI (Claude Code, GitHub Copilot), as an MCP
 * server: the CLI starts a small stdio server (this app's executable run as
 * Node) that passes the tool list and each call to the app over a local
 * HTTP endpoint. Each question opens a run of its own: the tools it may use,
 * and the window and chat its calls belong to (where the user is asked
 * before a tool changes something). The model then calls
 * `mcp__kalem__settings_set` or `mcp__kalem__jira_get_issue` like any of
 * its tools, instead of trying to reach the sites or the app itself.
 *
 * The endpoint listens on 127.0.0.1 only and takes a token made for this
 * app's run; the token is in files only the user can read, never on a
 * command line.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { ToolDefinition } from "../shared/tool-protocol.js";
import type { ToolResult } from "./assistant-tools.js";

/** The server's name in the CLI: its tools are `mcp__kalem__<tool>`. */
export const MCP_SERVER = "kalem";
export const mcpToolName = (tool: string): string => `mcp__${MCP_SERVER}__${tool}`;

/** The CLI-side server: JSON-RPC lines on standard input and output, the list and each call passed to the app. */
export function mcpServerSource(): string {
	return `"use strict";
// Kalem's tools for a CLI (MCP over stdio). Made by Kalem; the list and each call come from the app.
const http = require("node:http");
const base = process.env.KALEM_TOOLS_URL || "http://127.0.0.1:1";
const token = process.env.KALEM_TOOLS_TOKEN || "";
const run = process.env.KALEM_TOOLS_RUN || "";
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
function post(path, payload) {
	return new Promise((resolve) => {
		const body = JSON.stringify(payload);
		const request = http.request(
			new URL(path, base),
			{ method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-kalem-run": run, "content-length": Buffer.byteLength(body) } },
			(response) => {
				let text = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => (text += chunk));
				response.on("end", () => {
					try {
						resolve(JSON.parse(text));
					} catch {
						resolve({ text: "Kalem did not answer the call (" + response.statusCode + ").", isError: true });
					}
				});
			},
		);
		request.on("error", (error) => resolve({ text: "Kalem cannot be reached: " + error.message + ". Is the app still open?", isError: true }));
		request.end(body);
	});
}
async function handle(message) {
	const { id, method, params } = message;
	if (id === undefined || id === null) return;
	switch (method) {
		case "initialize":
			return send({ id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "kalem", version: "2" } } });
		case "ping":
			return send({ id, result: {} });
		case "tools/list": {
			const answer = await post("/list", {});
			return send({ id, result: { tools: Array.isArray(answer.tools) ? answer.tools : [] } });
		}
		case "tools/call": {
			const answer = await post("/call", { name: params?.name, arguments: params?.arguments ?? {} });
			return send({ id, result: { content: [{ type: "text", text: String(answer.text ?? "") }], isError: answer.isError === true } });
		}
		default:
			return send({ id, error: { code: -32601, message: "Unknown method " + method } });
	}
}
let rest = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	rest += chunk;
	let at;
	while ((at = rest.indexOf("\\n")) !== -1) {
		const line = rest.slice(0, at).trim();
		rest = rest.slice(at + 1);
		if (line === "") continue;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			continue;
		}
		void handle(message);
	}
});
process.stdin.on("end", () => process.exit(0));
`;
}

/** The tools as MCP lists them. */
export const mcpTools = (tools: readonly ToolDefinition[]) =>
	tools.map(({ name, description, parameters }) => ({
		name,
		description,
		inputSchema: parameters,
	}));

/** Reads a request's body, up to a size. */
function bodyOf(request: IncomingMessage, max = 1024 * 1024): Promise<string> {
	return new Promise((resolve, reject) => {
		let text = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			text += chunk;
			if (text.length > max) {
				reject(new Error("Too large"));
				request.destroy();
			}
		});
		request.on("end", () => resolve(text));
		request.on("error", reject);
	});
}

export interface ToolServerOptions {
	/** Where the server's script and the CLIs' configurations are written. */
	readonly folder: string;
	/** The executable that runs the script as Node: this app's, with `ELECTRON_RUN_AS_NODE`. */
	readonly node: string;
}

/** One question's tools, as the CLI is pointed to them. */
export interface McpRun {
	/** Claude Code's `--mcp-config` file. */
	readonly claude: string;
	/** Copilot's `--additional-mcp-config` file (given as `@file`). */
	readonly copilot: string;
	close(): Promise<void>;
}

interface OpenRun {
	readonly tools: () => readonly ToolDefinition[];
	readonly call: (name: string, input: unknown) => Promise<ToolResult>;
}

/** The app's side of the tools: a local endpoint, and the configurations that point the CLIs to it. */
export class AssistantToolServer {
	readonly #options: ToolServerOptions;
	readonly #token = randomBytes(32).toString("hex");
	readonly #runs = new Map<string, OpenRun>();
	#started: Promise<{ port: number; script: string }> | null = null;
	#close: (() => void) | null = null;

	constructor(options: ToolServerOptions) {
		this.#options = options;
	}

	/**
	 * Opens a run: the tools a question's CLI may use, and how its calls
	 * are answered. Close it when the answer has ended.
	 */
	async open(
		tools: () => readonly ToolDefinition[],
		call: (name: string, input: unknown) => Promise<ToolResult>,
		/** The servers of the user's mode, next to Kalem's: Claude Code's and Copilot's entries by name. */
		extra: {
			readonly claude: Record<string, unknown>;
			readonly copilot: Record<string, unknown>;
		} = {
			claude: {},
			copilot: {},
		},
	): Promise<McpRun> {
		this.#started ??= this.#start().catch((error: unknown) => {
			this.#started = null;
			throw error;
		});
		const { port, script } = await this.#started;
		const id = randomBytes(12).toString("hex");
		this.#runs.set(id, { tools, call });
		const { folder, node } = this.#options;
		const env = {
			ELECTRON_RUN_AS_NODE: "1",
			KALEM_TOOLS_URL: `http://127.0.0.1:${port}`,
			KALEM_TOOLS_TOKEN: this.#token,
			KALEM_TOOLS_RUN: id,
		};
		const claude = join(folder, `run-${id}.json`);
		const copilot = join(folder, `copilot-${id}.json`);
		await writePrivate(claude, {
			mcpServers: {
				[MCP_SERVER]: { type: "stdio", command: node, args: [script], env },
				...extra.claude,
			},
		});
		await writePrivate(copilot, {
			mcpServers: {
				[MCP_SERVER]: { type: "local", command: node, args: [script], env, tools: ["*"] },
				...extra.copilot,
			},
		});
		return {
			claude,
			copilot,
			close: async () => {
				this.#runs.delete(id);
				await Promise.all([rm(claude, { force: true }), rm(copilot, { force: true })]);
			},
		};
	}

	close(): void {
		this.#close?.();
	}

	async #start(): Promise<{ port: number; script: string }> {
		const server = createServer((request, response) => void this.#answer(request, response));
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		this.#close = () => server.close();
		const { port } = server.address() as AddressInfo;
		const { folder } = this.#options;
		await mkdir(folder, { recursive: true });
		const script = join(folder, "kalem-tools.cjs");
		await writeFile(script, mcpServerSource());
		return { port, script };
	}

	async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const reply = (status: number, body: unknown): void => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (
			request.method !== "POST" ||
			(request.url !== "/call" && request.url !== "/list") ||
			request.headers.authorization !== `Bearer ${this.#token}`
		) {
			reply(403, { text: "Forbidden", isError: true });
			return;
		}
		const runId = request.headers["x-kalem-run"];
		const run = typeof runId === "string" ? this.#runs.get(runId) : undefined;
		if (run === undefined) {
			reply(200, {
				tools: [],
				text: "This Kalem question has ended; its tools are no longer available.",
				isError: true,
			});
			return;
		}
		try {
			if (request.url === "/list") {
				reply(200, { tools: mcpTools(run.tools()) });
				return;
			}
			const call = JSON.parse(await bodyOf(request)) as { name?: unknown; arguments?: unknown };
			const name = typeof call.name === "string" ? call.name : "";
			reply(200, await run.call(name, call.arguments));
		} catch (error) {
			reply(200, { text: error instanceof Error ? error.message : String(error), isError: true });
		}
	}
}

/** Writes a file only the user can read: it holds the token. */
async function writePrivate(path: string, data: unknown): Promise<void> {
	await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
	// The mode is kept only when the file is made; a file from an earlier run is narrowed too.
	await chmod(path, 0o600).catch(() => {});
}
