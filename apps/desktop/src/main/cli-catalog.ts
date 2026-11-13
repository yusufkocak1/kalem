/**
 * What the CLIs themselves say the user's account has, without asking a
 * model anything:
 * - Claude Code answers an `initialize` control request (as the Agent SDK
 *   asks it) with the models the account may use and its slash commands,
 *   the plugins' included.
 * - The Copilot CLI, started as a server (`--headless --stdio`, as the
 *   Copilot SDK starts it), answers `models.list` with the account's models.
 * Each answer is kept a while: a CLI takes a few seconds to start.
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { InitializeCommand, ModelOption } from "../shared/models.js";
import {
	claudeInitializeCommands,
	claudeInitializeModels,
	copilotRpcModels,
	RpcReader,
	rpcFrame,
} from "../shared/models.js";
import type { CliLaunch } from "./cli.js";
import { environment } from "./cli.js";

/** How long a CLI may take to answer, and how long its answer is used. */
const WAIT = 30_000;
const LIFETIME = 10 * 60_000;
/** An empty answer is asked again sooner: the user may sign in meanwhile. */
const EMPTY_LIFETIME = 60_000;

export interface ClaudeAccount {
	readonly models: readonly ModelOption[];
	readonly commands: readonly InitializeCommand[];
}

const EMPTY: ClaudeAccount = { models: [], commands: [] };

/** Starts a CLI for a question of its own; stopped once answered, or after `WAIT`. */
function start(launch: CliLaunch, args: readonly string[]): ChildProcess {
	return spawn(launch.command, [...launch.prefix, ...args], {
		cwd: homedir(),
		env: environment(launch),
		windowsHide: true,
		stdio: ["pipe", "pipe", "ignore"],
	});
}

/** Claude Code's `initialize` answer; rejects when it gives none. */
export function askClaude(launch: CliLaunch): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = start(launch, [
			"-p",
			"--input-format",
			"stream-json",
			"--output-format",
			"stream-json",
			"--verbose",
		]);
		const id = `kalem-${Date.now().toString(36)}`;
		let rest = "";
		const finish = (answer: unknown, error?: Error): void => {
			clearTimeout(timer);
			child.stdin?.end();
			child.kill();
			if (error === undefined) resolve(answer);
			else reject(error);
		};
		const timer = setTimeout(() => finish(null, new Error("Claude Code did not answer")), WAIT);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			rest += chunk;
			const lines = rest.split("\n");
			rest = lines.pop() ?? "";
			for (const line of lines) {
				let data: Record<string, unknown>;
				try {
					data = JSON.parse(line) as Record<string, unknown>;
				} catch {
					continue;
				}
				if (data.type !== "control_response") continue;
				const response = (data.response ?? {}) as Record<string, unknown>;
				if (response.request_id !== undefined && response.request_id !== id) continue;
				if (response.subtype === "error") {
					finish(null, new Error(String(response.error ?? "initialize failed")));
				} else finish(response.response ?? response);
				return;
			}
		});
		child.on("error", (error) => finish(null, error));
		child.on("close", () => finish(null, new Error("Claude Code exited")));
		child.stdin?.on("error", () => {});
		child.stdin?.write(
			`${JSON.stringify({ type: "control_request", request_id: id, request: { subtype: "initialize" } })}\n`,
		);
	});
}

/** The Copilot CLI's `models.list` answer; rejects when it gives none. */
export function askCopilot(launch: CliLaunch): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = start(launch, ["--headless", "--no-auto-update", "--stdio"]);
		const reader = new RpcReader();
		const finish = (answer: unknown, error?: Error): void => {
			clearTimeout(timer);
			child.stdin?.end();
			child.kill();
			if (error === undefined) resolve(answer);
			else reject(error);
		};
		const timer = setTimeout(() => finish(null, new Error("Copilot did not answer")), WAIT);
		const send = (id: number, method: string): void => {
			child.stdin?.write(rpcFrame({ jsonrpc: "2.0", id, method, params: {} }));
		};
		child.stdout?.on("data", (chunk: Buffer) => {
			for (const raw of reader.push(new Uint8Array(chunk))) {
				const message = (raw ?? {}) as Record<string, unknown>;
				// The handshake first (an older CLI does not know it: its error is fine), then the list.
				if (message.id === 1) send(2, "models.list");
				else if (message.id === 2) {
					if (message.error !== undefined) {
						const error = (message.error ?? {}) as Record<string, unknown>;
						finish(null, new Error(String(error.message ?? "models.list failed")));
					} else finish(message.result);
				}
			}
		});
		child.on("error", (error) => finish(null, error));
		child.on("close", () => finish(null, new Error("Copilot exited")));
		child.stdin?.on("error", () => {});
		send(1, "connect");
	});
}

interface Kept<T> {
	readonly key: string;
	readonly until: number;
	readonly value: Promise<T>;
}

/** The CLIs' answers about the account, kept a while for each CLI's path. */
export class CliCatalog {
	#claude: Kept<ClaudeAccount> | null = null;
	#copilot: Kept<ModelOption[]> | null = null;

	claude(launch: CliLaunch): Promise<ClaudeAccount> {
		const kept = this.#claude;
		if (kept !== null && kept.key === launch.path && kept.until > Date.now()) return kept.value;
		const value = askClaude(launch)
			.then((response) => ({
				models: claudeInitializeModels(response),
				commands: claudeInitializeCommands(response),
			}))
			.catch(() => EMPTY);
		this.#claude = { key: launch.path, until: Date.now() + LIFETIME, value };
		void value.then((found) => {
			if (found.models.length === 0 && this.#claude?.value === value)
				this.#claude = { ...this.#claude, until: Date.now() + EMPTY_LIFETIME };
		});
		return value;
	}

	copilot(launch: CliLaunch): Promise<ModelOption[]> {
		const kept = this.#copilot;
		if (kept !== null && kept.key === launch.path && kept.until > Date.now()) return kept.value;
		const value = askCopilot(launch)
			.then(copilotRpcModels)
			.catch(() => []);
		this.#copilot = { key: launch.path, until: Date.now() + LIFETIME, value };
		void value.then((found) => {
			if (found.length === 0 && this.#copilot?.value === value)
				this.#copilot = { ...this.#copilot, until: Date.now() + EMPTY_LIFETIME };
		});
		return value;
	}
}
