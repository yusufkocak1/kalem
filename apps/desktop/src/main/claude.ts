/**
 * The Claude assistant's main-process side: finds the Claude Code CLI
 * installed on this computer and runs one question at a time through it
 * (`claude -p … --output-format stream-json`), passing the reply on to the
 * window as it comes. The CLI brings its own login, so Kalem keeps no key.
 */
import type { ChildProcess } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { dialog, ipcMain } from "electron";
import type { ClaudeStatus } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { ClaudeEvent } from "../shared/claude.js";
import { ClaudeStreamReader, claudeArgs, LineSplitter, systemPrompt } from "../shared/claude.js";
import type { Strings } from "../shared/i18n.js";
import type { SettingsStore } from "./settings.js";
import type { AppWindow } from "./windows.js";
import { errorMessage } from "./windows.js";

/** How to start the CLI: the program, and arguments that come before Claude's own. */
export interface ClaudeLaunch {
	readonly command: string;
	readonly prefix: readonly string[];
	/** The file the user knows as `claude`. */
	readonly path: string;
}

/**
 * Where `claude` may be, most likely first: `PATH`, then
 * the places its installers use. A GUI app on macOS does not get the shell's
 * `PATH`, so those places matter there.
 */
export function claudeCandidates(
	platform: NodeJS.Platform,
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string[] {
	// An override is the only place looked at (tests rely on this).
	if (env.KALEM_CLAUDE) return [env.KALEM_CLAUDE];
	const windows = platform === "win32";
	const names = windows ? ["claude.exe", "claude.cmd"] : ["claude"];
	const join_ = windows
		? (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}\\${name}`
		: join;
	const dirs = (env.PATH ?? env.Path ?? "")
		.split(windows ? ";" : delimiter)
		.filter((dir) => dir !== "");
	if (windows) {
		dirs.push(`${home}\\.local\\bin`, `${home}\\.claude\\local`);
		if (env.APPDATA) dirs.push(`${env.APPDATA}\\npm`);
		if (env.LOCALAPPDATA) dirs.push(`${env.LOCALAPPDATA}\\Programs\\claude`);
	} else {
		dirs.push(
			join(home, ".local", "bin"),
			join(home, ".claude", "local"),
			join(home, ".npm-global", "bin"),
			join(home, ".bun", "bin"),
			"/opt/homebrew/bin",
			"/usr/local/bin",
			"/usr/bin",
		);
	}
	return [...new Set(dirs.flatMap((dir) => names.map((name) => join_(dir, name))))];
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

async function launchFor(path: string): Promise<ClaudeLaunch | null> {
	if (!(await isFile(path))) return null;
	if (!/\.(cmd|bat)$/i.test(path)) return { command: path, prefix: [], path };
	const script = shimScript(path, await readFile(path, "utf8").catch(() => ""));
	if (script === null || !(await isFile(script))) return null;
	// npm puts a node.exe next to the shim when it installed one there.
	const node = join(dirname(path), "node.exe");
	return { command: (await isFile(node)) ? node : "node", prefix: [script], path };
}

/** `PATH` with the CLI's own folder and the usual ones, for a CLI that starts `node`. */
function environment(launch: ClaudeLaunch): NodeJS.ProcessEnv {
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

function version(launch: ClaudeLaunch): Promise<string> {
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

export interface ClaudeIpcContext {
	readonly store: SettingsStore;
	strings(): Strings;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
}

export function registerClaudeIpc(ctx: ClaudeIpcContext): void {
	let found: { launch: ClaudeLaunch; version: string } | null = null;
	/** Running questions, by window and chat. */
	const running = new Map<string, ChildProcess>();
	/** The folder each conversation ran in. */
	const folders = new Map<string, string>();

	const status = (): ClaudeStatus =>
		found === null
			? { found: false }
			: { found: true, path: found.launch.path, version: found.version };

	const check = async (path: string): Promise<boolean> => {
		const launch = await launchFor(path);
		if (launch === null) return false;
		try {
			found = { launch, version: await version(launch) };
			return true;
		} catch {
			return false;
		}
	};

	const locate = async (): Promise<ClaudeStatus> => {
		found = null;
		const configured = ctx.store.settings.claudePath;
		if (configured !== "" && (await check(configured))) return status();
		for (const path of claudeCandidates(process.platform, process.env, homedir())) {
			if (await check(path)) return status();
		}
		return status();
	};

	ipcMain.handle(CHANNEL.claudeStatus, async (_event, refresh: unknown) =>
		found !== null && refresh !== true ? status() : locate(),
	);

	ipcMain.handle(CHANNEL.claudeLocate, async (event) => {
		const win = ctx.senderOf(event);
		const t = ctx.strings();
		const result = await dialog.showOpenDialog(win.window, {
			title: t.claudeLocateTitle,
			properties: ["openFile", "dontAddToRecent"],
			...(process.platform === "win32"
				? { filters: [{ name: "Claude Code", extensions: ["exe", "cmd"] }] }
				: {}),
		});
		const path = result.filePaths[0];
		if (result.canceled || path === undefined) return status();
		if (!(await check(path))) {
			await dialog.showMessageBox(win.window, {
				type: "warning",
				message: t.claudeLocateFailed,
				detail: path,
			});
			return status();
		}
		ctx.store.updateSettings({ claudePath: path });
		return status();
	});

	ipcMain.handle(CHANNEL.claudeAsk, async (event, raw: unknown) => {
		const win = ctx.senderOf(event);
		const request = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const chatId = request.chatId;
		const prompt = request.prompt;
		if (typeof chatId !== "string" || typeof prompt !== "string" || prompt.trim() === "") {
			throw new Error("Invalid question");
		}
		const sessionId =
			typeof request.sessionId === "string" && /^[\w-]{1,100}$/.test(request.sessionId)
				? request.sessionId
				: null;
		const tab = typeof request.tabId === "string" ? win.tabs.get(request.tabId) : undefined;
		// Claude Code keeps a conversation with the folder it ran in, and resumes
		// it only from there; a new one runs next to the active document.
		const folder =
			(sessionId === null ? undefined : folders.get(sessionId)) ??
			(tab !== undefined && tab.path !== null && tab.remote === null
				? dirname(tab.path)
				: homedir());

		const sender = event.sender;
		const send = (claudeEvent: ClaudeEvent): void => {
			if (claudeEvent.kind === "session") folders.set(claudeEvent.id, folder);
			if (!sender.isDestroyed()) sender.send(CHANNEL.claudeEvent, chatId, claudeEvent);
		};
		if (found === null) await locate();
		if (found === null) {
			send({ kind: "error", message: ctx.strings().claudeNotFound });
			return;
		}
		const key = `${sender.id}:${chatId}`;
		running.get(key)?.kill();
		const args = claudeArgs({ sessionId, systemPrompt: systemPrompt(ctx.strings()) });
		await run(found.launch, folder, args, prompt, send, sender, (child) => {
			running.set(key, child);
		});
		running.delete(key);
	});

	ipcMain.handle(CHANNEL.claudeStop, (event, chatId: unknown) => {
		if (typeof chatId !== "string") return;
		const key = `${event.sender.id}:${chatId}`;
		running.get(key)?.kill();
		running.delete(key);
	});
}

/** Runs one question; resolves once the CLI has exited, whatever happened. */
function run(
	launch: ClaudeLaunch,
	cwd: string,
	args: readonly string[],
	prompt: string,
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

		const reader = new ClaudeStreamReader();
		const lines = new LineSplitter();
		let failed = false;
		let stderr = "";
		const handle = (line: string): void => {
			for (const claudeEvent of reader.feed(line)) {
				if (claudeEvent.kind === "error") failed = true;
				send(claudeEvent);
			}
		};
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			for (const line of lines.push(chunk)) handle(line);
		});
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
			for (const line of lines.end()) handle(line);
			if (!reader.finished && !failed) {
				// Stopped by the user, or the CLI failed before it could answer.
				if (signal !== null) send({ kind: "done" });
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
