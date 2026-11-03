/**
 * Git for the Files pane: clone a repository, and for an open folder that
 * is one, show its branch and run fetch, pull, push, switch branch, new
 * branch and commit. The system's own `git` does the work, so the user's
 * credentials (Git Credential Manager, SSH keys) are used as they are.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type {
	GitAction,
	GitBranch,
	GitChangeKind,
	GitFileChange,
	GitOperation,
	GitStatus,
} from "../shared/bridge.js";
import { isCloneUrl, repositoryName } from "../shared/git-url.js";

export { isCloneUrl, repositoryName };

const TIMEOUT = 2 * 60_000;
const CLONE_TIMEOUT = 30 * 60_000;

export type GitProblem =
	| "missing"
	| "failed"
	| "invalid-url"
	| "invalid-branch"
	| "exists"
	/** A pull whose branches went apart, with no setting to say how to bring them together. */
	| "diverged";

/** Changed files a status carries; a repository with more says how many but lists these. */
const MAX_FILES = 5000;

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

function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	return {
		...process.env,
		...extra,
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
	options: { readonly env?: NodeJS.ProcessEnv; readonly okCodes?: readonly number[] } = {},
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			// Looking never writes: a status would otherwise refresh the index, which the folder watcher sees.
			["--no-optional-locks", ...args],
			{
				cwd,
				timeout,
				windowsHide: true,
				env: environment(options.env),
				maxBuffer: 16 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				const code = (error as { code?: unknown } | null)?.code;
				if (error === null || (typeof code === "number" && options.okCodes?.includes(code))) {
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

/** What an `XY` pair of a changed entry means, the index's letter first. */
function changeKind(xy: string): GitChangeKind {
	if (xy.includes("A")) return "added";
	if (xy.includes("D")) return "deleted";
	if (xy.includes("R") || xy.includes("C")) return "renamed";
	return "modified";
}

/**
 * Reads `git status --porcelain=v2 --branch`, with `-z` (entries end with a
 * NUL, paths are never quoted) or without it (one entry a line).
 */
export function parseStatus(output: string): Omit<GitStatus, "root" | "operation"> {
	let branch: string | null = null;
	let upstream: string | null = null;
	let ahead = 0;
	let behind = 0;
	let changed = 0;
	let conflicts = 0;
	const files: GitFileChange[] = [];
	const nul = output.includes("\0");
	const entries = output.split(nul ? "\0" : /\r?\n/);
	const add = (path: string, kind: GitChangeKind): void => {
		changed++;
		if (kind === "conflict") conflicts++;
		if (files.length < MAX_FILES) files.push({ path, kind });
	};
	for (let i = 0; i < entries.length; i++) {
		const line = entries[i] as string;
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length);
			branch = head === "(detached)" ? null : head;
		} else if (line.startsWith("# branch.upstream ")) {
			upstream = line.slice("# branch.upstream ".length);
		} else if (line.startsWith("# branch.ab ")) {
			const match = /\+(\d+) -(\d+)/.exec(line);
			ahead = Number(match?.[1] ?? 0);
			behind = Number(match?.[2] ?? 0);
		} else if (line.startsWith("1 ")) {
			// 1 XY sub mH mI mW hH hI path
			const fields = line.split(" ");
			add(fields.slice(8).join(" "), changeKind(fields[1] ?? ""));
		} else if (line.startsWith("2 ")) {
			// 2 XY sub mH mI mW hH hI Xscore path, then the old path (after a tab, or as its own entry).
			const fields = line.split(" ");
			const path = fields.slice(9).join(" ");
			add(nul ? path : (path.split("\t")[0] ?? path), "renamed");
			if (nul) i++;
		} else if (line.startsWith("u ")) {
			// u XY sub m1 m2 m3 mW h1 h2 h3 path
			add(line.split(" ").slice(10).join(" "), "conflict");
		} else if (line.startsWith("? ")) {
			add(line.slice(2), "untracked");
		}
	}
	return { branch, upstream, ahead, behind, changed, files, conflicts };
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

/** A merge, rebase or cherry-pick that stopped in the repository whose git folder is `gitDir`. */
async function operation(gitDir: string): Promise<GitOperation | null> {
	if (await exists(join(gitDir, "rebase-merge"))) return "rebase";
	if (await exists(join(gitDir, "rebase-apply"))) return "rebase";
	if (await exists(join(gitDir, "MERGE_HEAD"))) return "merge";
	if (await exists(join(gitDir, "CHERRY_PICK_HEAD"))) return "cherry-pick";
	return null;
}

/** The repository's state; `null` when the folder is not in one (or git is not installed). */
export async function gitStatus(root: string): Promise<GitStatus | null> {
	try {
		// `--git-dir` is relative to the folder before Git 2.31's `--path-format`.
		const where = await runGit(root, ["rev-parse", "--show-toplevel", "--git-dir"], 10_000);
		const [top = "", dir = ""] = where.stdout.trim().split(/\r?\n/);
		const gitDir = isAbsolute(dir) ? dir : join(root, dir);
		const { stdout } = await runGit(
			root,
			["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
			20_000,
		);
		return { root: top, ...parseStatus(stdout), operation: await operation(gitDir) };
	} catch {
		return null;
	}
}

/** A path git printed for this repository, as it came: not an option, not out of the repository. */
function checkPath(path: string): string {
	if (
		path === "" ||
		path.startsWith("-") ||
		path.startsWith("/") ||
		/^[a-zA-Z]:/.test(path) ||
		path.split(/[\\/]/).includes("..")
	) {
		throw new Error(`Not a path of the repository: ${path}`);
	}
	return path;
}

/** How `path` changed since the last commit, as a unified diff; a new file is all added lines. */
export async function gitDiff(root: string, path: string): Promise<string> {
	const status = await gitStatus(root);
	if (status === null) throw new Error("Not a repository");
	const change = status.files.find((file) => file.path === checkPath(path));
	if (change?.kind === "untracked") {
		// Exit code 1: there are differences, which is what is asked for.
		const { stdout } = await runGit(
			status.root,
			["diff", "--no-color", "--no-index", "--", nullDevice(), path],
			TIMEOUT,
			{ okCodes: [1] },
		);
		return stdout;
	}
	const head = await runGit(status.root, ["rev-parse", "--verify", "--quiet", "HEAD"], TIMEOUT, {
		okCodes: [1],
	});
	// Before the first commit, everything is compared with nothing.
	const base = head.stdout.trim() === "" ? emptyTree : "HEAD";
	const { stdout } = await runGit(status.root, ["diff", "--no-color", base, "--", path]);
	return stdout;
}

const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const nullDevice = (): string => (process.platform === "win32" ? "NUL" : "/dev/null");

/**
 * The changes of `paths` (every change without them) for a commit message:
 * the diff, the names of new files with their beginning, and the last
 * commits' subjects to follow their style. Cut to `limit` characters.
 */
export async function commitContext(
	root: string,
	paths: readonly string[] | undefined,
	limit = 60_000,
): Promise<string> {
	const status = await gitStatus(root);
	if (status === null) throw new Error("Not a repository");
	const chosen = new Set((paths ?? status.files.map((file) => file.path)).map(checkPath));
	const files = status.files.filter((file) => chosen.has(file.path));
	const parts: string[] = [];
	const log = await runGit(status.root, ["log", "-8", "--format=%s"], TIMEOUT, {
		okCodes: [128],
	}).catch(() => ({ stdout: "" }));
	if (log.stdout.trim() !== "") parts.push(`Recent commit subjects:\n${log.stdout.trim()}`);
	parts.push(`Files:\n${files.map((file) => `${file.kind}: ${file.path}`).join("\n")}`);
	for (const file of files) {
		const diff = await gitDiff(status.root, file.path).catch(() => "");
		parts.push(diff.length > 8000 ? `${diff.slice(0, 8000)}\n[… diff cut]` : diff);
		if (parts.join("\n").length > limit) break;
	}
	return parts.join("\n\n").slice(0, limit);
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
	const paths = (raw: unknown): string[] | null =>
		Array.isArray(raw) && raw.length > 0 && raw.every((path) => typeof path === "string")
			? (raw as string[]).map(checkPath)
			: null;
	switch (value.kind) {
		case "fetch":
		case "push":
		case "init":
		case "abort":
		case "continue":
			return { kind: value.kind };
		case "pull":
			return value.how === "merge" || value.how === "rebase"
				? { kind: "pull", how: value.how }
				: { kind: "pull" };
		case "discard": {
			const chosen = paths(value.paths);
			if (chosen !== null) return { kind: "discard", paths: chosen };
			break;
		}
		case "checkout":
		case "create-branch":
			if (typeof value.branch === "string" && value.branch.trim() !== "") {
				return { kind: value.kind, branch: value.branch.trim() };
			}
			break;
		case "commit": {
			if (typeof value.message !== "string" || value.message.trim() === "") break;
			const chosen = value.paths === undefined ? null : paths(value.paths);
			if (value.paths !== undefined && chosen === null) break;
			return {
				kind: "commit",
				message: value.message.trim(),
				...(chosen === null ? {} : { paths: chosen }),
			};
		}
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
export async function runGitAction(
	root: string,
	action: GitAction,
	/** Puts a new file that is discarded in the recycle bin. */
	trash: (path: string) => Promise<void> = async () => {
		throw new Error("No recycle bin");
	},
): Promise<string> {
	const out = ({ stdout, stderr }: { stdout: string; stderr: string }): string =>
		gitMessage(stderr, stdout);
	switch (action.kind) {
		case "init":
			return out(await runGit(root, ["init"]));
		case "fetch":
			return out(await runGit(root, ["fetch", "--all", "--prune"]));
		case "pull":
			try {
				return out(
					await runGit(root, [
						"pull",
						"--no-edit",
						...(action.how === "merge"
							? ["--no-rebase"]
							: action.how === "rebase"
								? ["--rebase"]
								: []),
					]),
				);
			} catch (error) {
				// Git 2.27+ will not guess: the user is asked, and the pull is run again with the answer.
				if (
					action.how === undefined &&
					error instanceof GitError &&
					/divergent branches|Need to specify how to reconcile/i.test(error.message)
				) {
					throw new GitError("diverged", error.message);
				}
				throw error;
			}
		case "abort": {
			const status = await gitStatus(root);
			if (status?.operation == null) return "";
			return out(await runGit(root, [status.operation, "--abort"]));
		}
		case "continue": {
			const status = await gitStatus(root);
			if (status?.operation == null) return "";
			// The message git prepared is kept: no editor is opened.
			if (status.operation === "merge") return out(await runGit(root, ["commit", "--no-edit"]));
			return out(
				await runGit(root, [status.operation, "--continue"], TIMEOUT, {
					env: { GIT_EDITOR: "true" },
				}),
			);
		}
		case "discard": {
			const status = await gitStatus(root);
			if (status === null) throw new Error("Not a repository");
			const kinds = new Map(status.files.map((file) => [file.path, file.kind]));
			const fresh = action.paths.filter((path) => {
				const kind = kinds.get(path);
				return kind === "untracked" || kind === "added";
			});
			const known = action.paths.filter((path) => kinds.has(path) && !fresh.includes(path));
			if (known.length > 0) {
				await runGit(status.root, [
					"restore",
					"--source=HEAD",
					"--staged",
					"--worktree",
					"--",
					...known,
				]);
			}
			for (const path of fresh) {
				if (kinds.get(path) === "added") {
					await runGit(status.root, ["rm", "--cached", "--quiet", "--", path]);
				}
				await trash(join(status.root, path));
			}
			return "";
		}
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
		case "commit": {
			if (action.paths === undefined) {
				await runGit(root, ["add", "--all"]);
				return out(await runGit(root, ["commit", "-m", action.message]));
			}
			// Only the files chosen, whatever else is staged; new ones are added first.
			const status = await gitStatus(root);
			if (status === null) throw new Error("Not a repository");
			await runGit(status.root, ["add", "--all", "--", ...action.paths]);
			return out(
				await runGit(status.root, [
					"commit",
					"-m",
					action.message,
					"--only",
					"--",
					...action.paths,
				]),
			);
		}
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

/**
 * Fetches in the background, when the repository has a remote. It never
 * asks for anything: no terminal prompt, no sign-in window (Git
 * Credential Manager); a fetch that needs one simply fails, quietly.
 */
export async function backgroundFetch(root: string): Promise<boolean> {
	try {
		const remotes = await runGit(root, ["remote"], 10_000);
		if (remotes.stdout.trim() === "") return false;
		await runGit(root, ["fetch", "--all", "--prune", "--quiet"], TIMEOUT, {
			env: { GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "" },
		});
		return true;
	} catch {
		return false;
	}
}
