/**
 * Asks an MCP server which tools it has, the way the CLIs will run it: a
 * program on this computer (newline-delimited JSON-RPC on its standard
 * input and output) or an address (Streamable HTTP, answered in JSON or as
 * events). It is started, asked, and stopped.
 */
import { spawn } from "node:child_process";
import { delimiter } from "node:path";
import type { McpServer, McpToolInfo, McpToolList } from "../shared/mcp-servers.js";
import { parseToolList } from "../shared/mcp-servers.js";

const PROTOCOL = "2025-06-18";
/** A server that has not answered by then is not waited for. */
const WAIT = 30_000;
/** At most this many pages of tools. */
const PAGES = 20;

type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>;
type Notify = (method: string) => Promise<void>;

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** The server's JSON-RPC answer's result, or its error as an exception. */
function resultOf(message: unknown): unknown {
	const { error, result } = message as { error?: { message?: unknown }; result?: unknown };
	if (error !== undefined) {
		throw new Error(typeof error?.message === "string" ? error.message : JSON.stringify(error));
	}
	return result;
}

/** Greets the server, then pages through its tools. */
async function talk(request: Request, notify: Notify): Promise<McpToolInfo[]> {
	await request("initialize", {
		protocolVersion: PROTOCOL,
		capabilities: {},
		clientInfo: { name: "kalem", version: "1" },
	});
	await notify("notifications/initialized");
	const tools: McpToolInfo[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < PAGES; page++) {
		const result = await request("tools/list", cursor === undefined ? {} : { cursor });
		tools.push(...parseToolList(result));
		const next = (result as { nextCursor?: unknown } | null)?.nextCursor;
		if (typeof next !== "string" || next === "") break;
		cursor = next;
	}
	const seen = new Set<string>();
	return tools.filter((tool) => !seen.has(tool.name) && seen.add(tool.name));
}

function stdioTools(server: McpServer, env: NodeJS.ProcessEnv): Promise<McpToolInfo[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(server.command, [...server.args], {
			env: { ...env, ...server.env },
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
			// npx, uvx and the like are .cmd files on Windows: only a shell starts them.
			shell: process.platform === "win32",
		});
		const waiting = new Map<number, { resolve(value: unknown): void; reject(e: Error): void }>();
		let next = 1;
		let buffer = "";
		let stderr = "";
		let done = false;
		const finish = (error: Error | null, tools: McpToolInfo[] = []): void => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			child.kill();
			for (const each of waiting.values()) each.reject(error ?? new Error("closed"));
			if (error === null) resolve(tools);
			else reject(error);
		};
		const timer = setTimeout(
			() => finish(new Error(`No answer in ${WAIT / 1000} s.${tail(stderr)}`)),
			WAIT,
		);
		child.on("error", (error) => finish(error));
		child.on("close", (code) =>
			finish(new Error(`The server stopped (exit code ${code}).${tail(stderr)}`)),
		);
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-2000);
		});
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			buffer += chunk;
			let at = buffer.indexOf("\n");
			while (at >= 0) {
				const line = buffer.slice(0, at).trim();
				buffer = buffer.slice(at + 1);
				at = buffer.indexOf("\n");
				if (line === "") continue;
				let message: { id?: unknown };
				try {
					message = JSON.parse(line) as { id?: unknown };
				} catch {
					continue; // Some servers print their own lines; only JSON-RPC is read.
				}
				const pending = typeof message.id === "number" ? waiting.get(message.id) : undefined;
				if (pending === undefined) continue;
				waiting.delete(message.id as number);
				try {
					pending.resolve(resultOf(message));
				} catch (error) {
					pending.reject(error as Error);
				}
			}
		});
		const send = (message: unknown): void => {
			child.stdin.write(`${JSON.stringify(message)}\n`);
		};
		child.stdin.on("error", () => {});
		const request: Request = (method, params) =>
			new Promise((ok, fail) => {
				const id = next++;
				waiting.set(id, { resolve: ok, reject: fail });
				send({ jsonrpc: "2.0", id, method, params });
			});
		const notify: Notify = async (method) => send({ jsonrpc: "2.0", method });
		talk(request, notify).then(
			(tools) => finish(null, tools),
			(error: unknown) => finish(new Error(`${errorText(error)}${tail(stderr)}`)),
		);
	});
}

const tail = (stderr: string): string => {
	const text = stderr.trim().split("\n").slice(-3).join("\n");
	return text === "" ? "" : `\n${text}`;
};

/** The JSON-RPC answer in an HTTP reply: the body, or the event that carries it. */
export function answerIn(body: string, contentType: string, id: number): unknown {
	if (!contentType.includes("text/event-stream")) return JSON.parse(body);
	for (const event of body.split(/\r?\n\r?\n/)) {
		const data = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		if (data === "") continue;
		try {
			const message = JSON.parse(data) as { id?: unknown };
			if (message.id === id) return message;
		} catch {}
	}
	throw new Error("The server's answer had no result.");
}

async function httpTools(server: McpServer): Promise<McpToolInfo[]> {
	const signal = AbortSignal.timeout(WAIT);
	let session: string | null = null;
	let version: string | null = null;
	let next = 1;
	const post = async (message: Record<string, unknown>): Promise<Response> => {
		const response = await fetch(server.url, {
			method: "POST",
			signal,
			headers: {
				...server.headers,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...(session === null ? {} : { "mcp-session-id": session }),
				...(version === null ? {} : { "mcp-protocol-version": version }),
			},
			body: JSON.stringify({ jsonrpc: "2.0", ...message }),
		});
		if (!response.ok) {
			const text = (await response.text().catch(() => "")).slice(0, 300);
			throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `\n${text}` : ""}`);
		}
		return response;
	};
	const request: Request = async (method, params) => {
		const id = next++;
		const response = await post({ id, method, params });
		session = response.headers.get("mcp-session-id") ?? session;
		const result = resultOf(
			answerIn(await response.text(), response.headers.get("content-type") ?? "", id),
		);
		if (method === "initialize") {
			const agreed = (result as { protocolVersion?: unknown } | null)?.protocolVersion;
			version = typeof agreed === "string" ? agreed : PROTOCOL;
		}
		return result;
	};
	const notify: Notify = async (method) => {
		await (await post({ method })).body?.cancel();
	};
	try {
		return await talk(request, notify);
	} finally {
		if (session !== null) {
			void fetch(server.url, {
				method: "DELETE",
				headers: { ...server.headers, "mcp-session-id": session },
			}).catch(() => {});
		}
	}
}

/** The app's environment, with where npx and uvx usually are on a Mac (an app started from the Dock lacks them). */
function programEnvironment(): NodeJS.ProcessEnv {
	if (process.platform === "win32") return process.env;
	const path = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""]
		.filter((part) => part !== "")
		.join(delimiter);
	return { ...process.env, PATH: path };
}

/** The server's tools, or why they could not be listed. */
export async function listMcpTools(
	server: McpServer,
	env: NodeJS.ProcessEnv = programEnvironment(),
): Promise<McpToolList> {
	try {
		const tools =
			server.transport === "http" ? await httpTools(server) : await stdioTools(server, env);
		return { ok: true, tools };
	} catch (error) {
		return { ok: false, error: errorText(error) };
	}
}
