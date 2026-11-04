/**
 * The assistant's services that are programs on this computer: the Claude
 * Code CLI (`claude`) and the GitHub Copilot CLI (`copilot`). Finds them
 * and runs one question at a time, passing the reply on as it comes. Each
 * brings its own login, so Kalem keeps no key for them.
 */
import type { ChildProcess } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import type { WebContents } from "electron";
import type { ClaudeEvent } from "../shared/claude.js";
import { ClaudeStreamReader, LineSplitter } from "../shared/claude.js";
import { errorMessage } from "./windows.js";

export type CliProgram = "claude" | "copilot";

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
 * Where a CLI may be, most likely first: `PATH`, then the places its
 * installers use. A GUI app on macOS does not get the shell's `PATH`, so
 * those places matter there.
 */
export function cliCandidates(
	program: CliProgram | "npm",
	platform: NodeJS.Platform,
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string[] {
	// An override is the only place looked at (tests rely on this).
	const override =
		program === "claude" ? env.KALEM_CLAUDE : program === "copilot" ? env.KALEM_COPILOT : undefined;
	if (override) return [override];
	const windows = platform === "win32";
	const names = windows ? [`${program}.exe`, `${program}.cmd`] : [program];
	const join_ = windows
		? (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}\\${name}`
		: join;
	const dirs = (env.PATH ?? env.Path ?? "")
		.split(windows ? ";" : delimiter)
		.filter((dir) => dir !== "");
	if (windows) {
		dirs.push(`${home}\\.local\\bin`, `${home}\\.${program}\\local`);
		if (env.APPDATA) dirs.push(`${env.APPDATA}\\npm`);
		if (env.LOCALAPPDATA) {
			dirs.push(
				`${env.LOCALAPPDATA}\\Programs\\${program}`,
				// WinGet puts its command-line programs' links here.
				`${env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links`,
			);
		}
	} else {
		dirs.push(
			join(home, ".local", "bin"),
			join(home, `.${program}`, "local"),
			join(home, ".npm-global", "bin"),
			join(home, ".bun", "bin"),
			"/opt/homebrew/bin",
			"/usr/local/bin",
			"/usr/bin",
		);
	}
	return [...new Set(dirs.flatMap((dir) => names.map((name) => join_(dir, name))))];
}

/** The npm package each CLI is installed from with `npm install -g`. */
export const NPM_PACKAGES: Readonly<Record<CliProgram, string>> = {
	claude: "@anthropic-ai/claude-code",
	copilot: "@github/copilot",
};

/**
 * The folder npm puts global programs' links in, from what `npm root -g`
 * prints: `<prefix>/lib/node_modules` gives `<prefix>/bin`, and on Windows
 * `<prefix>\node_modules` gives `<prefix>`.
 */
export function npmGlobalBin(root: string, platform: NodeJS.Platform): string {
	if (platform === "win32") return root.replace(/[\\/]+$/, "").replace(/[\\/]node_modules$/i, "");
	const prefix = dirname(dirname(root.replace(/\/+$/, "")));
	return join(prefix, "bin");
}

/** The script a package's `package.json` runs as `program`, relative to the package. */
export function packageBin(manifest: unknown, program: string): string | null {
	if (typeof manifest !== "object" || manifest === null) return null;
	const bin = (manifest as { bin?: unknown }).bin;
	if (typeof bin === "string") return bin;
	if (typeof bin !== "object" || bin === null) return null;
	const script = (bin as Record<string, unknown>)[program];
	return typeof script === "string" ? script : null;
}

/** The last line a command printed, or null when it failed. */
function lastLine(
	command: string,
	args: readonly string[],
	options: { shell?: boolean; env?: NodeJS.ProcessEnv },
): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(command, args, { timeout: 20_000, windowsHide: true, ...options }, (error, stdout) => {
			if (error || typeof stdout !== "string") resolve(null);
			else {
				const lines = stdout.split(/\r?\n/).map((line) => line.trim());
				resolve(lines.filter((line) => line !== "").pop() ?? null);
			}
		});
	});
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/** Where `npm root -g` says global packages are, and the npm that said it. */
export interface NpmRoot {
	readonly root: string;
	/** The npm program that was asked; empty when a login shell was asked. */
	readonly npm: string;
}

/**
 * Asks npm where its global packages are (`npm root -g`): first an npm
 * found on `PATH` or in the usual folders, then, outside Windows, the
 * user's login shell, which knows the `PATH` that nvm and the like set up.
 */
export async function npmGlobalRoot(): Promise<NpmRoot | null> {
	const windows = process.platform === "win32";
	const dirs = cliCandidates("npm", process.platform, process.env, homedir()).filter(
		(path) => !windows || /\.cmd$/i.test(path),
	);
	if (windows && process.env.ProgramFiles)
		dirs.push(`${process.env.ProgramFiles}\\nodejs\\npm.cmd`);
	for (const npm of [...new Set(dirs)]) {
		if (!(await isFile(npm))) continue;
		const env = { ...process.env, PATH: [dirname(npm), process.env.PATH ?? ""].join(delimiter) };
		// A `.cmd` file only runs in a shell; the arguments are fixed, so that is safe.
		const root = windows
			? await lastLine(`"${npm}"`, ["root", "-g"], { shell: true })
			: await lastLine(npm, ["root", "-g"], { env });
		if (root !== null && (await isDirectory(root))) return { root, npm };
	}
	if (!windows) {
		const shell = process.env.SHELL || "/bin/sh";
		const root = await lastLine(shell, ["-ilc", "npm root -g"], {});
		if (root !== null && (await isDirectory(root))) return { root, npm: "" };
	}
	return null;
}

/**
 * Where a CLI installed with `npm install -g` may be: npm's link to it,
 * then its package's script, run with Node.
 */
async function npmLaunches(program: CliProgram, found: NpmRoot): Promise<CliLaunch[]> {
	const windows = process.platform === "win32";
	const bin = npmGlobalBin(found.root, process.platform);
	const launches: CliLaunch[] = [];
	for (const name of windows ? [`${program}.cmd`, `${program}.exe`] : [program]) {
		const launch = await launchFor(join(bin, name));
		if (launch !== null) launches.push(launch);
	}
	const pkg = join(found.root, ...NPM_PACKAGES[program].split("/"));
	const manifest: unknown = await readFile(join(pkg, "package.json"), "utf8")
		.then((text) => JSON.parse(text) as unknown)
		.catch(() => null);
	const script = packageBin(manifest, program);
	if (script !== null && (await isFile(join(pkg, script)))) {
		const nodeName = windows ? "node.exe" : "node";
		const nodes = [found.npm === "" ? "" : join(dirname(found.npm), nodeName), join(bin, nodeName)];
		let node = "node";
		for (const candidate of nodes) {
			if (candidate !== "" && (await isFile(candidate))) {
				node = candidate;
				break;
			}
		}
		launches.push({ command: node, prefix: [join(pkg, script)], path: join(pkg, script) });
	}
	return launches;
}

/**
 * The script an npm `.cmd` shim runs. Starting the shim itself would need
 * a shell, which would read the arguments (the question's instructions) as
 * commands; the script is run with Node instead.
 */
export function shimScript(shim: string, content: string): string | null {
	const match = /"%(?:~?dp0|dp0)%\\([^"]+?\.(?:c|m)?js)"/i.exec(content);
	if (match?.[1] === undefined) return null;
	// The shim's folder, read the Windows way whatever the platform the tests run on.
	return `${shim.replace(/[\\/][^\\/]*$/, "")}\\${match[1]}`;
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

async function launchFor(path: string): Promise<CliLaunch | null> {
	if (!(await isFile(path))) return null;
	if (!/\.(cmd|bat)$/i.test(path)) return { command: path, prefix: [], path };
	const script = shimScript(path, await readFile(path, "utf8").catch(() => ""));
	if (script === null || !(await isFile(script))) return null;
	// npm puts a node.exe next to the shim when it installed one there.
	const node = join(dirname(path), "node.exe");
	return { command: (await isFile(node)) ? node : "node", prefix: [script], path };
}

/** `PATH` with the CLI's own folder and the usual ones, for a CLI that starts `node`. */
function environment(launch: CliLaunch): NodeJS.ProcessEnv {
	const extra = [dirname(launch.path)];
	if (process.platform !== "win32") extra.push("/opt/homebrew/bin", "/usr/local/bin");
	const key =
		process.platform === "win32"
			? // kalem-locale-ok: environment variable names are ASCII
				(Object.keys(process.env).find((name) => name.toUpperCase() === "PATH") ?? "Path")
			: "PATH";
	const path = [...extra, process.env[key] ?? ""].filter((part) => part !== "").join(delimiter);
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

/** A CLI found on this computer (or picked by the user). */
export class LocalCli {
	readonly program: CliProgram;
	readonly #configured: () => string;
	#found: { launch: CliLaunch; version: string } | null = null;

	/** `configured` is the program the user picked; empty to look for it. */
	constructor(program: CliProgram, configured: () => string) {
		this.program = program;
		this.#configured = configured;
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

	/** Whether the file starts the CLI; it is then the one used. */
	async check(path: string): Promise<boolean> {
		const launch = await launchFor(path);
		return launch !== null && (await this.#try(launch));
	}

	async #try(launch: CliLaunch): Promise<boolean> {
		try {
			this.#found = { launch, version: await version(launch) };
			return true;
		} catch {
			return false;
		}
	}

	/** Looks for the CLI where the user put it, then where it is usually installed. */
	async locate(): Promise<CliStatus> {
		this.#found = null;
		const configured = this.#configured();
		if (configured !== "" && (await this.check(configured))) return this.status();
		for (const path of cliCandidates(this.program, process.platform, process.env, homedir())) {
			if (await this.check(path)) return this.status();
		}
		// Installed with npm somewhere the folders above miss: ask npm.
		const override =
			this.program === "claude" ? process.env.KALEM_CLAUDE : process.env.KALEM_COPILOT;
		if (override) return this.status();
		const npm = await npmGlobalRoot();
		if (npm === null) return this.status();
		for (const launch of await npmLaunches(this.program, npm)) {
			if (await this.#try(launch)) return this.status();
		}
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
): Promise<void> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(launch.command, [...launch.prefix, ...args], {
				cwd,
				env: environment(launch),
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
