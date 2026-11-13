/**
 * The assistant's services that are programs on this computer: the Claude
 * Code CLI (`claude`) and the GitHub Copilot CLI (`copilot`). Finds them
 * and runs one question at a time, passing the reply on as it comes. Each
 * brings its own login, so Kalem keeps no key for them.
 */
import type { ChildProcess } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, win32 } from "node:path";
import type { WebContents } from "electron";
import type { ClaudeEvent } from "../shared/claude.js";
import { ClaudeStreamReader, LineSplitter } from "../shared/claude.js";
import type { CliProgram, Host, ScanRoot } from "./cli-find.js";
import {
	Budget,
	cliCandidates,
	isAppFolder,
	localHost,
	ownRoots,
	places,
	placesNear,
	sameKey,
	scan,
	sharedRoots,
} from "./cli-find.js";
import { errorMessage } from "./windows.js";

export type { CliProgram } from "./cli-find.js";

/** Whether a CLI was found, and where. */
export type CliStatus =
	| { readonly found: true; readonly path: string; readonly version: string }
	| { readonly found: false };

/** How to start a CLI: the program, and arguments that come before its own. */
export interface CliLaunch {
	readonly command: string;
	readonly prefix: readonly string[];
	/** The file the user knows as `claude` or `copilot`. */
	readonly path: string;
}

/**
 * What an npm `.cmd` link starts: a script, which is run with Node, or
 * (as Claude Code's package has it now) the program itself. Starting the
 * link would need a shell, which would read the arguments (the question's
 * instructions) as commands, and which a company's policy may forbid.
 * npm writes the link's own folder as `%dp0%`, pnpm and Yarn as `%~dp0`.
 */
export function shimTarget(shim: string, content: string): string | null {
	// The link's folder, read the Windows way whatever the platform the tests run on.
	const folder = shim.replace(/[\\/][^\\/]*$/, "");
	for (const match of content.matchAll(/"%(?:dp0%|~dp0)\\?([^"%]+?\.(?:[cm]?js|exe))"/gi)) {
		const target = match[1];
		// The Node next to the link is what runs the script, not what the link is for.
		if (target === undefined || /(?:^|[\\/])node\.exe$/i.test(target)) continue;
		return win32.normalize(`${folder}\\${target}`);
	}
	return null;
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/**
 * The Node a script is run with: the one in the folder its package was
 * installed into, else one found on this computer, else whatever `node`
 * the `PATH` gives.
 */
async function nodeFor(script: string): Promise<string> {
	const name = process.platform === "win32" ? "node.exe" : "node";
	const near = [dirname(script)];
	const at = script.search(/[\\/]node_modules[\\/]/i);
	if (at !== -1) {
		// npm's folder: Node is in it on Windows, and in the `bin` beside its `lib` elsewhere.
		const prefix = script.slice(0, at);
		near.push(prefix, join(prefix, "bin"), join(dirname(prefix), "bin"));
	}
	const candidates = [
		...near.map((dir) => join(dir, name)),
		...cliCandidates("node", process.platform, process.env, homedir()).filter(
			(path) => basename(path) === name,
		),
	];
	for (const candidate of candidates) {
		if (await isFile(candidate)) return candidate;
	}
	return "node";
}

async function launchFor(path: string): Promise<CliLaunch | null> {
	if (/\.(cmd|bat)$/i.test(path)) {
		const target = shimTarget(path, await readFile(path, "utf8").catch(() => ""));
		if (target === null || !(await isFile(target))) return null;
		if (/\.exe$/i.test(target)) return { command: target, prefix: [], path };
		// npm puts a node.exe next to the link when it installed one there.
		return { command: await nodeFor(path), prefix: [target], path };
	}
	if (/\.[cm]?js$/i.test(path)) return { command: await nodeFor(path), prefix: [path], path };
	// A PowerShell script would need its shell, as a `.cmd` would.
	if (/\.ps1$/i.test(path)) return null;
	return { command: path, prefix: [], path };
}

/** `PATH` with the CLI's own folder and the usual ones, for a CLI that starts `node`. */
export function environment(launch: CliLaunch): NodeJS.ProcessEnv {
	const extra = [dirname(launch.path)];
	if (isAbsolute(launch.command)) extra.push(dirname(launch.command));
	if (process.platform !== "win32") extra.push("/opt/homebrew/bin", "/usr/local/bin");
	const key =
		process.platform === "win32"
			? // kalem-locale-ok: environment variable names are ASCII
				(Object.keys(process.env).find((name) => name.toUpperCase() === "PATH") ?? "Path")
			: "PATH";
	const path = [...new Set(extra), process.env[key] ?? ""]
		.filter((part) => part !== "")
		.join(delimiter);
	return { ...process.env, [key]: path };
}

function version(launch: CliLaunch): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			launch.command,
			[...launch.prefix, "--version"],
			{ timeout: 20_000, windowsHide: true, env: environment(launch) },
			(error, stdout) => {
				if (error) reject(error);
				else resolve(stdout.trim().split("\n")[0] ?? "");
			},
		);
	});
}

/** What the CLI prints for `--help`; empty when it cannot tell. */
function help(launch: CliLaunch): Promise<string> {
	return new Promise((resolve) => {
		execFile(
			launch.command,
			[...launch.prefix, "--help"],
			{ timeout: 20_000, windowsHide: true, env: environment(launch), maxBuffer: 4 * 1024 * 1024 },
			(_error, stdout) => resolve(typeof stdout === "string" ? stdout : ""),
		);
	});
}

/** A program that answered, or why the file is not one; null when there is no such file. */
type Started =
	| { readonly launch: CliLaunch; readonly version: string }
	| { readonly error: string };

async function start(path: string, host: Host): Promise<Started | null> {
	if (!(await host.isFile(path))) return null;
	// A desktop app of the same name would open its window when asked for its version.
	if (!/\.(cmd|bat|[cm]?js)$/i.test(path) && isAppFolder(await host.list(dirname(path)))) {
		return { error: "a desktop app, not the command-line program" };
	}
	const launch = await launchFor(path);
	if (launch === null) return { error: "what this link starts could not be read" };
	try {
		return { launch, version: await version(launch) };
	} catch (error) {
		return { error: errorMessage(error).replace(/\s+/g, " ").slice(0, 300) };
	}
}

/** How often the user's folders are gone through unasked for a program that is not found. */
const SEARCH_EVERY = 7 * 24 * 60 * 60 * 1000;

/**
 * When each program was last looked for folder by folder, and what was
 * found. That takes seconds of reading the disk, so it is not done at
 * every start of the app on a computer that simply does not have the
 * program; what it found is offered again until then.
 */
export class SearchLog {
	readonly #file: string;
	readonly #now: () => number;

	constructor(file: string, now: () => number = Date.now) {
		this.#file = file;
		this.#now = now;
	}

	async #read(): Promise<Record<string, { at: number; found: string[] }>> {
		const searches: Record<string, { at: number; found: string[] }> = {};
		try {
			const kept: unknown = JSON.parse(await readFile(this.#file, "utf8"));
			if (typeof kept !== "object" || kept === null) return searches;
			for (const [name, value] of Object.entries(kept)) {
				const { at, found } = (value ?? {}) as { at?: unknown; found?: unknown };
				if (typeof at !== "number" || !Array.isArray(found)) continue;
				searches[name] = {
					at,
					found: found.filter((path): path is string => typeof path === "string"),
				};
			}
		} catch {}
		return searches;
	}

	/** Whether it is time to go through the folders again. */
	async due(program: CliProgram): Promise<boolean> {
		const last = (await this.#read())[program]?.at;
		const since = last === undefined ? Number.POSITIVE_INFINITY : this.#now() - last;
		// A clock set back does not put the search off for ever.
		return since < 0 || since >= SEARCH_EVERY;
	}

	/** What the last search found. */
	async found(program: CliProgram): Promise<string[]> {
		return (await this.#read())[program]?.found ?? [];
	}

	async note(program: CliProgram, found: readonly string[]): Promise<void> {
		try {
			const searches = { ...(await this.#read()), [program]: { at: this.#now(), found } };
			await mkdir(dirname(this.#file), { recursive: true });
			const temp = `${this.#file}.tmp`;
			await writeFile(temp, JSON.stringify(searches, null, "\t"));
			await rename(temp, this.#file);
		} catch {
			// Not kept: the folders are gone through again next time.
		}
	}
}

export interface CliOptions {
	/** The program the user picked (or an earlier search kept); empty to look for it. */
	configured(): string;
	/**
	 * Keeps a program that took more than a look to find (it was seen
	 * running, or the user chose it from a search), so the next start has
	 * it at once.
	 */
	remember?(path: string): void;
	/** When the folders were last gone through; without it they are only gone through when asked. */
	readonly searches?: SearchLog;
	/** The computer to look on; this one unless a test says otherwise. */
	readonly host?: Host;
}

/** How long going through the user's own folders may take when nobody asked, in ms. */
const UNASKED_SEARCH = 10_000;
/** How long each half of a search the user asked for may take, in ms. */
const ASKED_SEARCH = 40_000;
/** At most this many installations found in folders are offered. */
const MOST_OFFERED = 4;

/**
 * The installation a file belongs to: npm's folder for a file in its
 * `node_modules`, else the file's own folder. npm's link, the package's
 * program and the one built for this computer are one installation.
 */
function installationOf(path: string): string {
	const at = path.search(/[\\/]node_modules[\\/]/i);
	return at === -1 ? dirname(path) : path.slice(0, at);
}

/** A CLI found on this computer (or picked by the user). */
export class LocalCli {
	readonly program: CliProgram;
	readonly #options: CliOptions;
	#found: { launch: CliLaunch; version: string } | null = null;
	/** What the last search looked at and what each file there answered. */
	#notes: string[] = [];
	#looked = 0;
	/** The installations that going through folders found, each one's files. */
	#offered: string[][] = [];

	constructor(program: CliProgram, options: CliOptions) {
		this.program = program;
		this.#options = options;
	}

	/** Its `--help` text, asked once per program found. */
	#help: { path: string; text: Promise<string> } | null = null;

	help(): Promise<string> {
		const launch = this.#found?.launch;
		if (launch === undefined) return Promise.resolve("");
		if (this.#help?.path !== launch.path) this.#help = { path: launch.path, text: help(launch) };
		return this.#help.text;
	}

	get launch(): CliLaunch | null {
		return this.#found?.launch ?? null;
	}

	status(): CliStatus {
		const found = this.#found;
		return found === null
			? { found: false }
			: { found: true, path: found.launch.path, version: found.version };
	}

	/**
	 * Files that may be the CLI, found by going through folders. None was
	 * started: a file of that name in a folder nobody chose (a download,
	 * say) is the user's to judge. `use` starts one.
	 */
	offered(): string[] {
		return this.#found === null ? this.#offered.flatMap((files) => files.slice(0, 1)) : [];
	}

	/**
	 * What the last search did, for a person to send on when a program that
	 * is on the computer was not found: the files that exist where it was
	 * looked for, and what each answered.
	 */
	report(): string {
		const host = this.#host();
		const found = this.#found;
		return [
			`${this.program} · ${host.platform} ${host.arch}`,
			found === null ? "not found" : `found: ${found.launch.path} (${found.version})`,
			`places looked at: ${this.#looked}`,
			...this.#notes,
			...this.#offered.flat().map((path) => `offered: ${path}`),
		].join("\n");
	}

	#host(): Host {
		return this.#options.host ?? localHost();
	}

	#note(line: string): void {
		if (this.#notes.length < 300) this.#notes.push(line);
	}

	/** Tries one file; it is then the one used. */
	async #try(path: string, source: string, host: Host): Promise<boolean> {
		this.#looked += 1;
		const started = await start(path, host);
		if (started === null) return false;
		if ("error" in started) {
			this.#note(`${source}: ${path} → ${started.error}`);
			return false;
		}
		this.#found = started;
		this.#note(`${source}: ${path} → ${started.version}`);
		return true;
	}

	/** Tries a file the search has not tried yet. */
	async #tryNew(path: string, source: string, host: Host, tried: Set<string>): Promise<boolean> {
		const key = sameKey(path, host.platform);
		if (tried.has(key)) return false;
		tried.add(key);
		return this.#try(path, source, host);
	}

	#keep(): void {
		const path = this.#found?.launch.path;
		if (path !== undefined) this.#options.remember?.(path);
	}

	/**
	 * Whether the file starts the CLI, or a program in the folder does (a
	 * folder of Node's or npm's, a `node_modules`, the package's own); it
	 * is then the one used.
	 */
	async check(path: string): Promise<boolean> {
		const host = this.#host();
		const tried = new Set<string>();
		for await (const near of placesNear(this.program, path, host)) {
			if (await this.#tryNew(near, "given", host, tried)) return true;
		}
		return false;
	}

	/** Starts an offered file, or another of its installation; it is then the one used, and kept. */
	async use(path: string): Promise<boolean> {
		const host = this.#host();
		const files = this.#offered.find((each) => each[0] === path);
		if (files === undefined) return false;
		for (const file of files) {
			if (await this.#try(file, "offered", host)) {
				this.#keep();
				return true;
			}
		}
		return false;
	}

	#override(host: Host): string {
		return (this.program === "claude" ? host.env.KALEM_CLAUDE : host.env.KALEM_COPILOT) ?? "";
	}

	/** Where the user said it is, then every place it is usually in. */
	async #quick(host: Host, tried: Set<string>): Promise<boolean> {
		this.#found = null;
		this.#notes = [];
		this.#looked = 0;
		this.#offered = [];
		const override = this.#override(host);
		// An override is the only place looked at (tests rely on this).
		if (override !== "") return this.#tryNew(override, "override", host, tried);
		const configured = this.#options.configured();
		if (configured !== "" && (await this.#tryNew(configured, "kept", host, tried))) return true;
		for await (const place of places(this.program, host)) {
			if (await this.#tryNew(place.path, place.source, host, tried)) {
				// A program seen running is gone from there when its editor closes.
				if (place.source === "running" || place.source === "shell") this.#keep();
				return true;
			}
		}
		return false;
	}

	/** Adds a file to what is offered, with its installation's other files; false when there is no room. */
	async #offer(path: string, host: Host, tried: Set<string>): Promise<boolean> {
		// A file the search started already did not answer.
		if (tried.has(sameKey(path, host.platform)) || !(await host.isFile(path))) return true;
		const installation = sameKey(installationOf(path), host.platform);
		const files = this.#offered.find(
			(each) => sameKey(installationOf(each[0] ?? ""), host.platform) === installation,
		);
		if (files !== undefined) {
			if (!files.includes(path)) files.push(path);
			return true;
		}
		if (this.#offered.length >= MOST_OFFERED) return false;
		this.#offered.push([path]);
		return true;
	}

	/** Goes through folders for files that may be the CLI; they are offered, not started. */
	async #gather(
		host: Host,
		roots: readonly ScanRoot[],
		budget: Budget,
		tried: Set<string>,
	): Promise<void> {
		this.#note(`folder by folder: ${roots.map((root) => root.path).join(", ") || "nowhere"}`);
		for await (const path of scan(this.program, host, roots, budget)) {
			if (!(await this.#offer(path, host, tried))) return;
		}
		if (!budget.alive()) this.#note("folder by folder: stopped when its time was up");
	}

	/**
	 * Looks for the CLI where the user put it, then where it is usually
	 * installed. On Windows, where a company's installs end up in unusual
	 * places, the user's own folders and the installed programs' are gone
	 * through now and then as well, and what is there is offered.
	 */
	async locate(): Promise<CliStatus> {
		const host = this.#host();
		const tried = new Set<string>();
		if ((await this.#quick(host, tried)) || this.#override(host) !== "") return this.status();
		const searches = this.#options.searches;
		if (host.platform !== "win32" || searches === undefined) return this.status();
		if (await searches.due(this.program)) {
			await this.#gather(host, ownRoots(host), new Budget(UNASKED_SEARCH), tried);
			await searches.note(this.program, this.#offered.flat());
		} else {
			for (const path of await searches.found(this.program)) await this.#offer(path, host, tried);
		}
		return this.status();
	}

	/**
	 * The search the user asks for: the usual places again, then this
	 * computer's folders one by one, the user's own first and then the
	 * rest of its disks. What is found there is offered.
	 */
	async search(): Promise<CliStatus> {
		const host = this.#host();
		const tried = new Set<string>();
		if ((await this.#quick(host, tried)) || this.#override(host) !== "") return this.status();
		const own = new Budget(ASKED_SEARCH);
		await this.#gather(host, ownRoots(host), own, tried);
		if (this.#offered.length < MOST_OFFERED) {
			await this.#gather(host, await sharedRoots(host), new Budget(ASKED_SEARCH, own.seen), tried);
		}
		await this.#options.searches?.note(this.program, this.#offered.flat());
		return this.status();
	}
}

/** Turns a CLI's output into the reply's events. */
export interface OutputReader {
	push(chunk: string): ClaudeEvent[];
	end(): ClaudeEvent[];
	/** Whether the output itself said the turn ended (with `done` or `error`). */
	readonly finished: boolean;
	/** Whether any of the reply's text came. */
	readonly answered: boolean;
}

/** Claude Code's `stream-json` lines. */
export function claudeOutput(): OutputReader {
	const reader = new ClaudeStreamReader();
	const lines = new LineSplitter();
	let answered = false;
	const feed = (input: readonly string[]): ClaudeEvent[] =>
		input
			.flatMap((line) => reader.feed(line))
			.map((event) => {
				if (event.kind === "text") answered = true;
				return event;
			});
	return {
		push: (chunk) => feed(lines.push(chunk)),
		end: () => feed(lines.end()),
		get finished() {
			return reader.finished;
		},
		get answered() {
			return answered;
		},
	};
}

/** Plain text, as `copilot -s` writes its answer. */
export function textOutput(): OutputReader {
	let answered = false;
	return {
		push(chunk) {
			if (chunk === "") return [];
			answered = true;
			return [{ kind: "text", text: chunk }];
		},
		end: () => [],
		finished: false,
		get answered() {
			return answered;
		},
	};
}

/**
 * Runs one question, with the question on standard input; resolves once
 * the CLI has exited, whatever happened. A CLI whose output does not say
 * when it ends has answered when it exits without an error.
 */
export function runCli(
	launch: CliLaunch,
	cwd: string,
	args: readonly string[],
	prompt: string,
	output: OutputReader,
	send: (event: ClaudeEvent) => void,
	sender: WebContents,
	started: (child: ChildProcess) => void,
	/** More environment variables for this run. */
	extraEnv: Readonly<Record<string, string>> = {},
): Promise<void> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(launch.command, [...launch.prefix, ...args], {
				cwd,
				env: { ...environment(launch), ...extraEnv },
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (error) {
			send({ kind: "error", message: errorMessage(error) });
			resolve();
			return;
		}
		started(child);
		const stop = (): void => {
			child.kill();
		};
		sender.once("destroyed", stop);

		let failed = false;
		let stderr = "";
		const pass = (events: readonly ClaudeEvent[]): void => {
			for (const event of events) {
				if (event.kind === "error") failed = true;
				send(event);
			}
		};
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => pass(output.push(chunk)));
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-4000);
		});
		child.on("error", (error) => {
			failed = true;
			send({ kind: "error", message: errorMessage(error) });
		});
		child.on("close", (code, signal) => {
			sender.removeListener("destroyed", stop);
			pass(output.end());
			if (!output.finished && !failed) {
				// Stopped by the user, or done, or failed before it could answer.
				if (signal !== null || (code === 0 && output.answered)) send({ kind: "done" });
				else {
					const message = stderr.trim() || `${basename(launch.path)} exited with code ${code}`;
					send({ kind: "error", message });
				}
			}
			resolve();
		});
		child.stdin?.on("error", () => {});
		child.stdin?.end(prompt, "utf8");
	});
}
