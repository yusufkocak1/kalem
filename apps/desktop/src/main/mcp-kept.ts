/**
 * MCP servers kept running between questions. A server run on this
 * computer lives as long as one answer: the CLI starts it, and stops it
 * when it exits. One the user keeps running is started here instead, once,
 * and stays while the app is open: what it holds (a browser and its
 * sign-in, say) carries over to the next question.
 *
 * Each question's CLI is given a small stdio server in its place (this
 * app's executable run as Node, as Kalem's own tools are) that passes each
 * message to the app over a local endpoint, never through a proxy. The
 * server is greeted once; each CLI that connects is answered with that
 * greeting, and its requests are numbered anew so that two of them (a
 * question and its reviewers) never mix. What the server asks of a client
 * (roots, a model's answer) is declined: it is greeted as a client that
 * offers none.
 *
 * The endpoint listens on 127.0.0.1 only and takes a token made for this
 * app's run; the token is in files only the user can read.
 */
import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "../shared/mcp-servers.js";

const PROTOCOL = "2025-06-18";
/** A server that has not greeted back by then (a first `npx` run downloads it) is given up. */
const START_WAIT = 180_000;
/** A server that does not stop when its input ends is stopped by force after this long. */
const STOP_WAIT = 3_000;
const MAX_BODY = 32 * 1024 * 1024;

type Message = Record<string, unknown>;

/** The stdio server a question's CLI runs in a kept server's place: it passes each message to the app. */
export function keptShimSource(): string {
	return `"use strict";
// A kept MCP server's stand-in for a CLI (MCP over stdio). Made by Kalem: the server runs in the app.
const http = require("node:http");
const crypto = require("node:crypto");
const base = process.env.KALEM_KEPT_URL || "http://127.0.0.1:1";
const token = process.env.KALEM_KEPT_TOKEN || "";
const name = process.env.KALEM_KEPT_SERVER || "";
const session = crypto.randomBytes(12).toString("hex");
function post(path, payload) {
	return new Promise((resolve) => {
		const body = JSON.stringify(payload);
		const request = http.request(
			new URL(path, base),
			{ method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-kalem-server": name, "x-kalem-session": session, "content-length": Buffer.byteLength(body) } },
			(response) => {
				let text = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => (text += chunk));
				response.on("end", () => {
					try {
						resolve(JSON.parse(text));
					} catch {
						resolve({ error: "Kalem did not answer (" + response.statusCode + ")." });
					}
				});
			},
		);
		request.on("error", (error) => resolve({ error: "Kalem cannot be reached: " + error.message + ". Is the app still open?" }));
		request.end(body);
	});
}
async function pass(message) {
	const answer = await post("/message", { message });
	if (answer.message) process.stdout.write(JSON.stringify(answer.message) + "\\n");
	else if (answer.error && message.id !== undefined && message.id !== null && typeof message.method === "string") {
		process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: answer.error } }) + "\\n");
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
		void pass(message);
	}
});
// The CLI is done: what it still waits for is called off, and the server keeps running.
process.stdin.on("end", () => post("/close", {}).finally(() => process.exit(0)));
`;
}

const errorAnswer = (id: unknown, message: string, code = -32000): Message => ({
	jsonrpc: "2.0",
	id,
	error: { code, message },
});

/** One server kept running: its process, spoken to over stdio, greeted once. */
export class KeptServer {
	/** What it was started as: changed, it is started again. */
	readonly key: string;
	readonly #child: ChildProcess;
	readonly #waiting = new Map<number, (message: Message) => void>();
	/** The upstream number of each request a session is waiting on, by its own number. */
	readonly #sessions = new Map<string, Map<string, number>>();
	readonly #ready: Promise<Message>;
	#next = 1;
	#buffer = "";
	#stderr = "";
	#exited = false;

	constructor(server: McpServer, env: NodeJS.ProcessEnv) {
		this.key = keptKey(server);
		this.#child = spawn(server.command, [...server.args], {
			cwd: homedir(),
			env: { ...env, ...server.env },
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
			// npx, uvx and the like are .cmd files on Windows: only a shell starts them.
			shell: process.platform === "win32",
			// Its own process group elsewhere, so that what it started (a browser) stops with it.
			detached: process.platform !== "win32",
		});
		this.#child.on("error", (error) => this.#exit(error.message));
		this.#child.on("close", (code) => this.#exit(`The server stopped (exit code ${code}).`));
		this.#child.stdin?.on("error", () => {});
		this.#child.stderr?.setEncoding("utf8");
		this.#child.stderr?.on("data", (chunk: string) => {
			this.#stderr = (this.#stderr + chunk).slice(-2000);
		});
		this.#child.stdout?.setEncoding("utf8");
		this.#child.stdout?.on("data", (chunk: string) => this.#read(chunk));
		this.#ready = this.#greet();
		// Asked for when a CLI connects; a server that fails to start is told of then.
		this.#ready.catch(() => {});
	}

	/** Whether its process has ended (it is started again on the next question). */
	get exited(): boolean {
		return this.#exited;
	}

	/** Answers one message of a session's (a CLI's); `null` for one that needs no answer. */
	async answer(session: string, message: Message): Promise<Message | null> {
		const { id, method } = message;
		if (typeof method !== "string") return null; // A client's answer: the server asked it nothing.
		const isRequest = id !== undefined && id !== null;
		let greeting: Message;
		try {
			greeting = await this.#ready;
		} catch (error) {
			return isRequest ? errorAnswer(id, (error as Error).message) : null;
		}
		if (!isRequest) {
			if (method === "notifications/initialized") return null;
			if (method === "notifications/cancelled") {
				const params = (message.params ?? {}) as Message;
				const upstream = this.#sessions.get(session)?.get(JSON.stringify(params.requestId));
				if (upstream !== undefined) {
					this.#send({ ...message, params: { ...params, requestId: upstream } });
				}
				return null;
			}
			this.#send(message);
			return null;
		}
		// Greeted once: each CLI gets the same greeting.
		if (method === "initialize") return { jsonrpc: "2.0", id, result: greeting };
		const answer = await this.#request(method, message.params, session, id);
		return {
			jsonrpc: "2.0",
			id,
			...(answer.error !== undefined ? { error: answer.error } : { result: answer.result }),
		};
	}

	/** A session's CLI is gone: what it still waits for is called off. */
	close(session: string): void {
		const open = this.#sessions.get(session);
		this.#sessions.delete(session);
		for (const upstream of open?.values() ?? []) {
			this.#send({
				jsonrpc: "2.0",
				method: "notifications/cancelled",
				params: { requestId: upstream, reason: "The client went away." },
			});
		}
	}

	/** Stops it: its input ends, which stops most servers; else, after a while (or at once), by force. */
	stop(now = false): void {
		if (this.#exited) return;
		this.#child.stdin?.end();
		if (now) this.#kill();
		else setTimeout(() => this.#kill(), STOP_WAIT).unref();
	}

	#kill(): void {
		if (this.#exited) return;
		const pid = this.#child.pid;
		if (pid === undefined) return;
		try {
			if (process.platform === "win32") {
				spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
			} else process.kill(-pid, "SIGTERM");
		} catch {
			this.#child.kill();
		}
	}

	async #greet(): Promise<Message> {
		let timer: NodeJS.Timeout | undefined;
		const late = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(new Error(`The server did not start in ${START_WAIT / 1000} s.${this.#tail()}`)),
				START_WAIT,
			);
			timer.unref();
		});
		try {
			const answer = await Promise.race([
				this.#request("initialize", {
					protocolVersion: PROTOCOL,
					capabilities: {},
					clientInfo: { name: "kalem", version: "1" },
				}),
				late,
			]);
			if (answer.error !== undefined) {
				const error = answer.error as { message?: unknown };
				throw new Error(typeof error.message === "string" ? error.message : "initialize failed");
			}
			this.#send({ jsonrpc: "2.0", method: "notifications/initialized" });
			return (answer.result ?? {}) as Message;
		} catch (error) {
			this.stop(true);
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	#request(method: string, params: unknown, session?: string, id?: unknown): Promise<Message> {
		if (this.#exited) {
			return Promise.resolve(errorAnswer(id, `The server is not running.${this.#tail()}`));
		}
		const upstream = this.#next++;
		const key = JSON.stringify(id);
		if (session !== undefined) {
			let open = this.#sessions.get(session);
			if (open === undefined) {
				open = new Map();
				this.#sessions.set(session, open);
			}
			open.set(key, upstream);
		}
		return new Promise((resolve) => {
			this.#waiting.set(upstream, (answer) => {
				if (session !== undefined) this.#sessions.get(session)?.delete(key);
				resolve(answer);
			});
			this.#send({
				jsonrpc: "2.0",
				id: upstream,
				method,
				...(params === undefined ? {} : { params }),
			});
		});
	}

	#send(message: Message): void {
		if (!this.#exited) this.#child.stdin?.write(`${JSON.stringify(message)}\n`);
	}

	#read(chunk: string): void {
		this.#buffer += chunk;
		let at = this.#buffer.indexOf("\n");
		while (at >= 0) {
			const line = this.#buffer.slice(0, at).trim();
			this.#buffer = this.#buffer.slice(at + 1);
			at = this.#buffer.indexOf("\n");
			if (line === "") continue;
			let message: Message;
			try {
				message = JSON.parse(line) as Message;
			} catch {
				continue; // Some servers print their own lines; only JSON-RPC is read.
			}
			this.#heard(message);
		}
	}

	#heard(message: Message): void {
		const { id, method } = message;
		if (typeof method === "string") {
			// The server asks the client something: only a ping is answered.
			if (id !== undefined && id !== null) {
				this.#send(
					method === "ping"
						? { jsonrpc: "2.0", id, result: {} }
						: errorAnswer(id, `Kalem's client does not offer ${method}.`, -32601),
				);
			}
			return; // Its notifications (progress, logs) go nowhere.
		}
		if (typeof id !== "number") return;
		const waiting = this.#waiting.get(id);
		this.#waiting.delete(id);
		waiting?.(message);
	}

	#exit(reason: string): void {
		if (this.#exited) return;
		this.#exited = true;
		const text = `${reason}${this.#tail()}`;
		for (const [upstream, resolve] of this.#waiting) resolve(errorAnswer(upstream, text));
		this.#waiting.clear();
		this.#sessions.clear();
	}

	#tail(): string {
		const text = this.#stderr.trim().split("\n").slice(-3).join("\n");
		return text === "" ? "" : `\n${text}`;
	}
}

/** What a server is started as: its program, its arguments and its environment. */
export function keptKey(server: McpServer): string {
	return JSON.stringify([server.command, server.args, server.env]);
}

export interface KeptServersOptions {
	/** Where the stand-in's script is written. */
	readonly folder: string;
	/** The executable that runs it as Node: this app's, with `ELECTRON_RUN_AS_NODE`. */
	readonly node: string;
	/** The environment servers start with. */
	readonly env: () => NodeJS.ProcessEnv;
}

/** The servers kept running, by name, and the endpoint the stand-ins reach them at. */
export class KeptServers {
	readonly #options: KeptServersOptions;
	readonly #token = randomBytes(32).toString("hex");
	readonly #kept = new Map<string, KeptServer>();
	#started: Promise<{ port: number; script: string }> | null = null;
	#close: (() => void) | null = null;

	constructor(options: KeptServersOptions) {
		this.#options = options;
	}

	/**
	 * The servers as a question's CLI gets them: one kept running is started
	 * if it is not (or was changed), and given as its stand-in.
	 */
	async bridge(servers: readonly McpServer[]): Promise<McpServer[]> {
		const kept = servers.filter(
			(server) => server.enabled && server.keepAlive && server.transport === "stdio",
		);
		if (kept.length === 0) return [...servers];
		let endpoint: { port: number; script: string };
		try {
			this.#started ??= this.#start().catch((error: unknown) => {
				this.#started = null;
				throw error;
			});
			endpoint = await this.#started;
		} catch {
			// No endpoint: the CLI runs them itself, as it does any other.
			return [...servers];
		}
		return servers.map((server) => {
			if (!kept.includes(server)) return server;
			this.#running(server);
			return {
				...server,
				command: this.#options.node,
				args: [endpoint.script],
				env: {
					ELECTRON_RUN_AS_NODE: "1",
					KALEM_KEPT_URL: `http://127.0.0.1:${endpoint.port}`,
					KALEM_KEPT_TOKEN: this.#token,
					KALEM_KEPT_SERVER: server.name,
				},
			};
		});
	}

	/** Stops the servers that are no longer kept: changed to run per question, turned off or removed. */
	retain(servers: readonly McpServer[]): void {
		const wanted = new Set(
			servers
				.filter((server) => server.enabled && server.keepAlive && server.transport === "stdio")
				.map((server) => server.name),
		);
		for (const [name, server] of this.#kept) {
			if (wanted.has(name)) continue;
			server.stop();
			this.#kept.delete(name);
		}
	}

	/** The app quits: every server stops now. */
	stopAll(): void {
		for (const server of this.#kept.values()) server.stop(true);
		this.#kept.clear();
		this.#close?.();
		this.#close = null;
	}

	/** The names of the servers running now. */
	running(): string[] {
		return [...this.#kept].filter(([, server]) => !server.exited).map(([name]) => name);
	}

	/** The server running as it is set up now: started, or started again when it changed or stopped. */
	#running(server: McpServer): KeptServer {
		const now = this.#kept.get(server.name);
		if (now !== undefined && now.key === keptKey(server) && !now.exited) return now;
		now?.stop();
		const started = new KeptServer(server, this.#options.env());
		this.#kept.set(server.name, started);
		return started;
	}

	async #start(): Promise<{ port: number; script: string }> {
		const server = createServer((request, response) => void this.#answer(request, response));
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		this.#close = () => server.close();
		const { port } = server.address() as AddressInfo;
		await mkdir(this.#options.folder, { recursive: true });
		const script = join(this.#options.folder, "kalem-kept.cjs");
		await writeFile(script, keptShimSource());
		return { port, script };
	}

	async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const reply = (status: number, body: unknown): void => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (
			request.method !== "POST" ||
			(request.url !== "/message" && request.url !== "/close") ||
			!sameSecret(request.headers.authorization ?? "", `Bearer ${this.#token}`)
		) {
			reply(403, { error: "Forbidden" });
			return;
		}
		const name = request.headers["x-kalem-server"];
		const session = request.headers["x-kalem-session"];
		const server = typeof name === "string" ? this.#kept.get(name) : undefined;
		if (server === undefined || typeof session !== "string" || session === "") {
			reply(200, { error: "This server is no longer kept running by Kalem." });
			return;
		}
		if (request.url === "/close") {
			server.close(session);
			reply(200, {});
			return;
		}
		try {
			const { message } = JSON.parse(await bodyOf(request)) as { message?: unknown };
			if (typeof message !== "object" || message === null || Array.isArray(message)) {
				reply(200, {});
				return;
			}
			const answer = await server.answer(session, message as Message);
			reply(200, answer === null ? {} : { message: answer });
		} catch (error) {
			reply(200, { error: error instanceof Error ? error.message : String(error) });
		}
	}
}

/** Reads a request's body, up to a size. */
function bodyOf(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let text = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			text += chunk;
			if (text.length > MAX_BODY) {
				reject(new Error("Too large"));
				request.destroy();
			}
		});
		request.on("end", () => resolve(text));
		request.on("error", reject);
	});
}

function sameSecret(given: string, expected: string): boolean {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
