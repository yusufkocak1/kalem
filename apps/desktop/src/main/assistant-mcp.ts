/**
 * Kalem's own tools for Claude Code, as an MCP server: the CLI starts a
 * small stdio server (this app's executable run as Node) that passes each
 * tool call to the app over a local HTTP endpoint, where the Confluence
 * search and page read, and the Jira issue read and search, run with the
 * app's connections. The model then calls `mcp__kalem__confluence_search`
 * or `mcp__kalem__jira_get_issue` like any of its tools, instead of trying
 * to reach the sites itself.
 *
 * The endpoint listens on 127.0.0.1 only and takes a token made for this
 * run; the token is in a file only the user can read, never on a command
 * line.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { CONFLUENCE_TOOLS, ConfluenceLookups, isConfluenceTool } from "./assistant-confluence.js";
import { isJiraTool, JIRA_TOOLS, JiraLookups } from "./assistant-jira.js";
import type { ConfluenceClient } from "./confluence-client.js";
import type { JiraClient } from "./jira-client.js";

/** The server's name in the CLI: its tools are `mcp__kalem__<tool>`. */
export const MCP_SERVER = "kalem";
export const mcpToolName = (tool: string): string => `mcp__${MCP_SERVER}__${tool}`;

/** The CLI-side server: JSON-RPC lines on standard input and output, each call passed to the app. */
export function mcpServerSource(tools: readonly unknown[]): string {
	return `"use strict";
// Kalem's tools for Claude Code (MCP over stdio). Made by Kalem; each call goes to the app.
const http = require("node:http");
const TOOLS = ${JSON.stringify(tools)};
const url = new URL(process.env.KALEM_TOOLS_URL || "http://127.0.0.1:1/call");
const token = process.env.KALEM_TOOLS_TOKEN || "";
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
function call(name, args) {
	return new Promise((resolve) => {
		const body = JSON.stringify({ name, arguments: args ?? {} });
		const request = http.request(
			url,
			{ method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token, "content-length": Buffer.byteLength(body) } },
			(response) => {
				let text = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => (text += chunk));
				response.on("end", () => {
					try {
						const answer = JSON.parse(text);
						resolve({ text: String(answer.text ?? ""), isError: answer.isError === true });
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
			return send({ id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "kalem", version: "1" } } });
		case "ping":
			return send({ id, result: {} });
		case "tools/list":
			return send({ id, result: { tools: TOOLS } });
		case "tools/call": {
			const answer = await call(params?.name, params?.arguments);
			return send({ id, result: { content: [{ type: "text", text: answer.text }], isError: answer.isError } });
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
export const MCP_TOOLS = [...CONFLUENCE_TOOLS, ...JIRA_TOOLS].map(
	({ name, description, parameters }) => ({
		name,
		description,
		inputSchema: parameters,
	}),
);

/** Reads a request's body, up to a size. */
function bodyOf(request: IncomingMessage, max = 256 * 1024): Promise<string> {
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
	/** Where the server's script and the CLI's configuration are written. */
	readonly folder: string;
	/** The executable that runs the script as Node: this app's, with `ELECTRON_RUN_AS_NODE`. */
	readonly node: string;
	/** The connected Confluence site; `null` when there is none. */
	confluence(): Promise<ConfluenceClient | null>;
	/** The connected Jira; `null` when there is none. */
	jira(): Promise<JiraClient | null>;
	/** What a call says when there is no connection. */
	notConnected(): string;
	jiraNotConnected(): string;
}

/** The app's side of the tools: a local endpoint, and the configuration that points the CLI to it. */
export class AssistantToolServer {
	readonly #options: ToolServerOptions;
	readonly #token = randomBytes(32).toString("hex");
	#config: Promise<string> | null = null;
	#close: (() => void) | null = null;

	constructor(options: ToolServerOptions) {
		this.#options = options;
	}

	/** The `--mcp-config` file for the CLI; the endpoint starts with the first call. */
	config(): Promise<string> {
		this.#config ??= this.#start().catch((error: unknown) => {
			this.#config = null;
			throw error;
		});
		return this.#config;
	}

	close(): void {
		this.#close?.();
	}

	async #start(): Promise<string> {
		const server = createServer((request, response) => void this.#answer(request, response));
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		this.#close = () => server.close();
		const { port } = server.address() as AddressInfo;
		const { folder, node } = this.#options;
		await mkdir(folder, { recursive: true });
		const script = join(folder, "kalem-tools.cjs");
		await writeFile(script, mcpServerSource(MCP_TOOLS));
		const config = join(folder, "mcp.json");
		await writeFile(
			config,
			JSON.stringify(
				{
					mcpServers: {
						[MCP_SERVER]: {
							type: "stdio",
							command: node,
							args: [script],
							env: {
								ELECTRON_RUN_AS_NODE: "1",
								KALEM_TOOLS_URL: `http://127.0.0.1:${port}/call`,
								KALEM_TOOLS_TOKEN: this.#token,
							},
						},
					},
				},
				null,
				2,
			),
			{ mode: 0o600 },
		);
		// The mode is kept only when the file is made; a file from an earlier run is narrowed too.
		await chmod(config, 0o600).catch(() => {});
		return config;
	}

	async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const reply = (status: number, body: { text: string; isError?: boolean }): void => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (
			request.method !== "POST" ||
			request.url !== "/call" ||
			request.headers.authorization !== `Bearer ${this.#token}`
		) {
			reply(403, { text: "Forbidden", isError: true });
			return;
		}
		try {
			const call = JSON.parse(await bodyOf(request)) as { name?: unknown; arguments?: unknown };
			const name = typeof call.name === "string" ? call.name : "";
			if (isJiraTool(name)) {
				const jira = await this.#options.jira();
				if (jira === null) {
					reply(200, { text: this.#options.jiraNotConnected(), isError: true });
					return;
				}
				reply(200, { text: await new JiraLookups(jira).runTool(name, call.arguments, () => {}) });
				return;
			}
			if (!isConfluenceTool(name)) {
				reply(200, { text: `There is no tool ${name}.`, isError: true });
				return;
			}
			const client = await this.#options.confluence();
			if (client === null) {
				reply(200, { text: this.#options.notConnected(), isError: true });
				return;
			}
			const text = await new ConfluenceLookups(client).runTool(name, call.arguments, () => {});
			reply(200, { text });
		} catch (error) {
			reply(200, { text: error instanceof Error ? error.message : String(error), isError: true });
		}
	}
}
