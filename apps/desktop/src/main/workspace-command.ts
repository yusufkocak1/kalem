/**
 * Commands the assistant runs in a workspace folder (`run_command`): tests,
 * a build, `git status`. Each is asked about first, unless the user's
 * approval setting lets everything run; it runs in the platform's shell,
 * with no input, for a limited time, and what it prints goes back to the
 * model, clipped.
 */
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { ToolDefinition } from "../shared/tool-protocol.js";

/** How long a command may run when the model says nothing, and at most. */
export const DEFAULT_COMMAND_SECONDS = 120;
export const MAX_COMMAND_SECONDS = 600;
/** Characters of output kept: its start and its end, where errors and summaries are. */
const MAX_OUTPUT = 30_000;
const MAX_COMMAND = 4000;

export const COMMAND_TOOL: ToolDefinition = {
	name: "run_command",
	description: `Runs a command in the system shell, in a folder of the workspace (tests, a build, a linter, git status…), and returns its exit code and what it printed. The user approves each command unless they allowed commands to run without asking. Give a command that ends on its own and reads no input (no editors, no watch modes, no prompts); it is stopped after \`timeout_seconds\` (default ${DEFAULT_COMMAND_SECONDS}, at most ${MAX_COMMAND_SECONDS}). Do not use it to change files the user did not ask you to change.`,
	parameters: {
		type: "object",
		properties: {
			command: { type: "string", description: "The command line, as typed in a terminal." },
			folder: {
				type: "string",
				description:
					"The folder to run it in, as the workspace shows it; the workspace's first folder when missing.",
			},
			timeout_seconds: { type: "integer", description: "How long it may run." },
			reason: { type: "string", description: "A short line saying why it is run, for the user." },
		},
		required: ["command"],
	},
};

export interface CommandResult {
	/** `null` when it was stopped (by the time limit or a signal). */
	readonly code: number | null;
	readonly output: string;
	readonly timedOut: boolean;
}

/** The output's start and end, when it is longer than `MAX_OUTPUT`. */
export function clipOutput(text: string, max = MAX_OUTPUT): string {
	if (text.length <= max) return text;
	const half = Math.floor(max / 2);
	return `${text.slice(0, half)}\n[… ${text.length - 2 * half} characters left out …]\n${text.slice(-half)}`;
}

/** Stops the command and what it started. */
function stopTree(pid: number | undefined): void {
	if (pid === undefined) return;
	if (process.platform === "win32") {
		execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
		return;
	}
	try {
		// Started in a group of its own: the group goes, the shell's children with it.
		process.kill(-pid, "SIGKILL");
	} catch {
		// Already gone.
	}
}

/** Runs a command line in `cwd`; never rejects, a failure to start is said in the output. */
export async function runCommand(
	command: string,
	cwd: string,
	seconds = DEFAULT_COMMAND_SECONDS,
): Promise<CommandResult> {
	const folder = await stat(cwd).catch(() => null);
	if (folder === null || !folder.isDirectory()) {
		return { code: null, output: `${cwd} is not a folder.`, timedOut: false };
	}
	const limit = Math.min(Math.max(Math.round(seconds), 1), MAX_COMMAND_SECONDS) * 1000;
	return new Promise((resolve) => {
		let output = "";
		let timedOut = false;
		const child = spawn(command, {
			cwd,
			shell: true,
			windowsHide: true,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
			// Nothing to answer a prompt: tools that would ask fail instead of waiting.
			env: { ...process.env, CI: process.env.CI ?? "1", GIT_TERMINAL_PROMPT: "0" },
		});
		const take = (chunk: Buffer): void => {
			// Kept a little over the limit so the end can still be cut from it.
			output += chunk.toString("utf8");
			if (output.length > MAX_OUTPUT * 4) output = clipOutput(output, MAX_OUTPUT * 2);
		};
		child.stdout?.on("data", take);
		child.stderr?.on("data", take);
		const timer = setTimeout(() => {
			timedOut = true;
			stopTree(child.pid);
		}, limit);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ code: null, output: `${output}${error.message}`, timedOut: false });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: timedOut ? null : code, output: clipOutput(output), timedOut });
		});
	});
}

/** The result as the model reads it. */
export function commandReport(command: string, result: CommandResult, seconds: number): string {
	const head = result.timedOut
		? `Stopped after ${seconds} s: \`${command}\` did not end in time.`
		: result.code === null
			? `\`${command}\` could not be run.`
			: `\`${command}\` exited with code ${result.code}.`;
	const body = result.output.trim() === "" ? "(it printed nothing)" : result.output.trimEnd();
	return `${head}\n${body}`;
}

/** The command line the model gave, trimmed and kept to a length the card can show. */
export function commandLine(raw: unknown): string {
	if (typeof raw !== "string") return "";
	return raw.trim().slice(0, MAX_COMMAND);
}
