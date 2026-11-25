/**
 * Programs an extension runs (`kalem.process`): their output goes back in
 * small batches, decoded as asked; stopping one stops what it started too.
 * All of an extension's programs stop with it, and with the app.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export interface SpawnRequest {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string | null;
	readonly env: Readonly<Record<string, string>>;
	readonly shell: boolean;
	readonly encoding: string;
}

export type ProcessEvent =
	| { readonly type: "output"; readonly stream: "stdout" | "stderr"; readonly text: string }
	| { readonly type: "exit"; readonly code: number | null; readonly signal: string | null }
	| { readonly type: "error"; readonly message: string };

export const MAX_PROCESSES = 30;
const FLUSH_MS = 40;
const KILL_GRACE_MS = 4000;

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};

export function parseSpawnRequest(raw: unknown): SpawnRequest {
	const source = record(raw);
	const command = typeof source.command === "string" ? source.command.trim() : "";
	if (command === "" || command.length > 4000) throw new Error("Give a command to run.");
	const args = Array.isArray(source.args) ? source.args.map(String).slice(0, 500) : [];
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(record(source.env))) {
		if (
			/^[A-Za-z_][A-Za-z0-9_.()-]{0,127}$/.test(name) &&
			(typeof value === "string" || typeof value === "number")
		) {
			env[name] = String(value);
		}
	}
	let encoding =
		typeof source.encoding === "string" && source.encoding !== "" ? source.encoding : "utf-8";
	try {
		new TextDecoder(encoding);
	} catch {
		encoding = "utf-8";
	}
	return {
		command,
		args,
		cwd: typeof source.cwd === "string" && source.cwd !== "" ? source.cwd : null,
		env,
		shell: source.shell === true,
		encoding,
	};
}

/** Stops a program and whatever it started. */
export function killTree(child: ChildProcess): void {
	const pid = child.pid;
	if (pid === undefined || child.exitCode !== null) return;
	if (process.platform === "win32") {
		execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
		return;
	}
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		child.kill("SIGTERM");
	}
	setTimeout(() => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
	}, KILL_GRACE_MS).unref();
}

interface Running {
	readonly owner: string;
	readonly child: ChildProcess;
}

export class ExtensionProcesses {
	readonly #running = new Map<string, Running>();
	#count = 0;

	async spawn(
		owner: string,
		request: SpawnRequest,
		emit: (id: string, event: ProcessEvent) => void,
	): Promise<string> {
		if (
			[...this.#running.values()].filter((each) => each.owner === owner).length >= MAX_PROCESSES
		) {
			throw new Error(`An extension may run at most ${MAX_PROCESSES} programs at once.`);
		}
		if (request.cwd !== null) {
			const folder = await stat(request.cwd).catch(() => null);
			if (folder === null || !folder.isDirectory())
				throw new Error(`The folder ${request.cwd} is not there.`);
		}
		const id = `p${++this.#count}`;
		const child = spawn(request.command, [...request.args], {
			cwd: request.cwd ?? undefined,
			env: { ...process.env, ...request.env },
			shell: request.shell,
			windowsHide: true,
			detached: process.platform !== "win32",
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.#running.set(id, { owner, child });

		const pending: { stream: "stdout" | "stderr"; text: string }[] = [];
		let timer: NodeJS.Timeout | null = null;
		const flush = (): void => {
			timer = null;
			for (const chunk of pending.splice(0)) emit(id, { type: "output", ...chunk });
		};
		const listen = (stream: "stdout" | "stderr"): void => {
			const decoder = new TextDecoder(request.encoding);
			child[stream]?.on("data", (data: Buffer) => {
				const text = decoder.decode(data, { stream: true });
				if (text === "") return;
				const last = pending.at(-1);
				if (last !== undefined && last.stream === stream) last.text += text;
				else pending.push({ stream, text });
				timer ??= setTimeout(flush, FLUSH_MS);
			});
		};
		listen("stdout");
		listen("stderr");
		child.on("error", (error) => {
			flush();
			emit(id, { type: "error", message: error.message });
		});
		child.on("close", (code, signal) => {
			if (timer !== null) clearTimeout(timer);
			flush();
			this.#running.delete(id);
			emit(id, { type: "exit", code, signal });
		});
		return id;
	}

	write(owner: string, id: string, text: string): void {
		const running = this.#running.get(id);
		if (running === undefined || running.owner !== owner)
			throw new Error("No such program is running.");
		running.child.stdin?.write(text);
	}

	kill(owner: string, id: string): void {
		const running = this.#running.get(id);
		if (running === undefined || running.owner !== owner) return;
		killTree(running.child);
	}

	killAll(owner?: string): void {
		for (const running of this.#running.values()) {
			if (owner === undefined || running.owner === owner) killTree(running.child);
		}
	}
}
