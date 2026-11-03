/**
 * Git for the Files pane: clone a repository, and for an open folder that
 * is one, show its branch and run fetch, pull, push, switch branch, new
 * branch and commit. The system's own `git` does the work, so the user's
 * credentials (Git Credential Manager, SSH keys) are used as they are.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { GitAction, GitBranch, GitStatus } from "../shared/bridge.js";
import { isCloneUrl, repositoryName } from "../shared/git-url.js";

export { isCloneUrl, repositoryName };

const TIMEOUT = 2 * 60_000;
const CLONE_TIMEOUT = 30 * 60_000;

export type GitProblem = "missing" | "failed" | "invalid-url" | "invalid-branch" | "exists";

export class GitError extends Error {
	/**
	 * `missing`: git is not installed; `failed`: git said no (the message is
	 * git's); the others are refused before git is asked.
	 */
	readonly problem: GitProblem;

	constructor(problem: GitProblem, message: string) {
		super(message);
		this.problem = problem;
	}
}

function environment(): NodeJS.ProcessEnv {
	return {
		...process.env,
		// Nobody can answer a prompt on a terminal that is not there: fail instead of hanging.
		GIT_TERMINAL_PROMPT: "0",
		// Untranslated, so the parsers below can read it; git's errors still reach the user as is.
		LC_ALL: "C",
		...(process.env.GIT_SSH_COMMAND === undefined
			? { GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" }
			: {}),
	};
}

/** What git printed when it failed, without its `fatal:` / `error:` prefixes. */
export function gitMessage(stderr: string, stdout = ""): string {
	const lines = `${stderr}\n${stdout}`
		.split(/\r?\n/)
		.map((line) => line.replace(/^(fatal|error|hint|remote): ?/i, "").trim())
		.filter((line) => line !== "");
	return lines.slice(0, 6).join("\n");
}

export function runGit(
	cwd: string,
	args: readonly string[],
	timeout = TIMEOUT,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			[...args],
			{ cwd, timeout, windowsHide: true, env: environment(), maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error === null) {
					resolve({ stdout, stderr });
					return;
				}
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					reject(new GitError("missing", "git"));
					return;
				}
				const text = gitMessage(stderr, stdout);
				reject(new GitError("failed", text === "" ? error.message : text));
			},
		);
	});
}

/** Reads `git status --porcelain=v2 --branch`. */
export function parseStatus(output: string): Omit<GitStatus, "root"> {
	let branch: string | null = null;
	let upstream: string | null = null;
	let ahead = 0;
	let behind = 0;
	let changed = 0;
	for (const line of output.split(/\r?\n/)) {
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length);
			branch = head === "(detached)" ? null : head;
		} else if (line.startsWith("# branch.upstream ")) {
			upstream = line.slice("# branch.upstream ".length);
		} else if (line.startsWith("# branch.ab ")) {
			const match = /\+(\d+) -(\d+)/.exec(line);
			ahead = Number(match?.[1] ?? 0);
			behind = Number(match?.[2] ?? 0);
		} else if (line !== "" && !line.startsWith("#")) {
			changed++;
		}
	}
	return { branch, upstream, ahead, behind, changed };
}

/** Reads `git for-each-ref` with {@link BRANCH_FORMAT}. */
export function parseBranches(output: string): GitBranch[] {
	const local = new Map<string, GitBranch>();
	const remote: GitBranch[] = [];
	for (const line of output.split(/\r?\n/)) {
		const [ref, head] = line.split("\t");
		if (ref === undefined || ref === "") continue;
		if (ref.startsWith("refs/heads/")) {
			const name = ref.slice("refs/heads/".length);
			local.set(name, { name, remote: null, current: head === "*" });
		} else if (ref.startsWith("refs/remotes/")) {
			const full = ref.slice("refs/remotes/".length);
			const slash = full.indexOf("/");
			if (slash === -1 || full.endsWith("/HEAD")) continue;
			remote.push({ name: full.slice(slash + 1), remote: full.slice(0, slash), current: false });
		}
	}
	// A remote branch with a local one of the same name is the local one.
	return [...local.values(), ...remote.filter((branch) => !local.has(branch.name))];
}

const BRANCH_FORMAT = "%(refname)\t%(HEAD)";

/** The repository's state; `null` when the folder is not in one (or git is not installed). */
export async function gitStatus(root: string): Promise<GitStatus | null> {
	try {
		const top = await runGit(root, ["rev-parse", "--show-toplevel"], 10_000);
		const { stdout } = await runGit(
			root,
			["status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
			20_000,
		);
		return { root: top.stdout.trim(), ...parseStatus(stdout) };
	} catch {
		return null;
	}
}

export async function gitBranches(root: string): Promise<GitBranch[]> {
	const { stdout } = await runGit(root, [
		"for-each-ref",
		`--format=${BRANCH_FORMAT}`,
		"refs/heads",
		"refs/remotes",
	]);
	return parseBranches(stdout);
}

/** Checks an action that came over IPC. */
export function toGitAction(raw: unknown): GitAction {
	const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	switch (value.kind) {
		case "fetch":
		case "pull":
		case "push":
		case "init":
			return { kind: value.kind };
		case "checkout":
		case "create-branch":
			if (typeof value.branch === "string" && value.branch.trim() !== "") {
				return { kind: value.kind, branch: value.branch.trim() };
			}
			break;
		case "commit":
			if (typeof value.message === "string" && value.message.trim() !== "") {
				return { kind: "commit", message: value.message.trim() };
			}
			break;
	}
	throw new Error("Invalid git action");
}

async function checkBranchName(root: string, branch: string): Promise<void> {
	if (branch.startsWith("-")) throw new GitError("invalid-branch", branch);
	try {
		await runGit(root, ["check-ref-format", "--branch", branch]);
	} catch (error) {
		if (error instanceof GitError && error.problem === "missing") throw error;
		throw new GitError("invalid-branch", branch);
	}
}

/** Runs `action` in `root`; returns git's own words on what it did. */
export async function runGitAction(root: string, action: GitAction): Promise<string> {
	const out = ({ stdout, stderr }: { stdout: string; stderr: string }): string =>
		gitMessage(stderr, stdout);
	switch (action.kind) {
		case "init":
			return out(await runGit(root, ["init"]));
		case "fetch":
			return out(await runGit(root, ["fetch", "--all", "--prune"]));
		case "pull":
			return out(await runGit(root, ["pull", "--no-edit"]));
		case "push": {
			const status = await gitStatus(root);
			// A branch that was never pushed goes to `origin` and follows it from then on.
			if (status !== null && status.branch !== null && status.upstream === null) {
				return out(await runGit(root, ["push", "--set-upstream", "origin", status.branch]));
			}
			return out(await runGit(root, ["push"]));
		}
		case "checkout":
			await checkBranchName(root, action.branch);
			// A remote branch without a local one gets one that follows it.
			return out(await runGit(root, ["switch", action.branch]));
		case "create-branch":
			await checkBranchName(root, action.branch);
			return out(await runGit(root, ["switch", "-c", action.branch]));
		case "commit":
			await runGit(root, ["add", "--all"]);
			return out(await runGit(root, ["commit", "-m", action.message]));
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Clones `url` into a new folder in `parent`; returns the folder. */
export async function cloneRepository(url: string, parent: string): Promise<string> {
	if (!isCloneUrl(url)) throw new GitError("invalid-url", url);
	const target = join(parent, repositoryName(url));
	if (await exists(target)) throw new GitError("exists", target);
	await runGit(parent, ["clone", "--", url.trim(), target], CLONE_TIMEOUT);
	return target;
}
